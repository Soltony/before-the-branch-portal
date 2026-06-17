'use server';

import prisma from '@/lib/prisma';
import { startOfDay } from 'date-fns';
import { calculateInterestWithPayments, normalizePayments } from '@/lib/interest-accrual';
import { createAuditLog, newAuditCorrelationId } from '@/lib/audit-log';

const safeJsonParse = <T,>(field: any, defaultValue: T): T => {
  if (typeof field === 'string') {
    try {
      return JSON.parse(field) as T;
    } catch {
      return defaultValue;
    }
  }
  return (field ?? defaultValue) as T;
};

export async function runDailyInterestAccrualOnce(asOf: Date = new Date()): Promise<{
  success: boolean;
  accrualThroughDate: Date;
  processedLoans: number;
  totalAccrued: number;
  skippedLoans: number;
}> {
  const accrualThroughDate = startOfDay(asOf); // accrue interest for days strictly before "today"
  const runId = newAuditCorrelationId();

  try {
    const activeTaxConfigs = await prisma.tax.findMany({ where: { status: 'ACTIVE' } });

    const loans = await prisma.loan.findMany({
      where: {
        repaymentStatus: 'Unpaid',
        disbursedDate: { lt: accrualThroughDate },
      },
      include: {
        payments: { orderBy: { date: 'asc' } },
        product: {
          include: {
            provider: { include: { ledgerAccounts: true } },
          },
        },
      },
    });

    await createAuditLog({
      actorId: 'system',
      action: 'INTEREST_ACCRUAL_RUN_STARTED',
      entity: 'Service',
      entityId: 'interest-accrual',
      details: {
        runId,
        accrualThroughDate: accrualThroughDate.toISOString(),
        candidateLoans: loans.length,
      },
    });

    let processedLoans = 0;
    let skippedLoans = 0;
    let totalAccrued = 0;

    for (const loan of loans) {
    const loanStartDate = startOfDay(new Date(loan.disbursedDate));
    const dueDate = startOfDay(new Date(loan.dueDate));
    const interestEndDate = accrualThroughDate > dueDate ? dueDate : accrualThroughDate;

    const lastThroughRaw = (loan as any).interestAccruedThroughDate as Date | null | undefined;
    const lastThrough = lastThroughRaw ? startOfDay(new Date(lastThroughRaw)) : loanStartDate;
    if (interestEndDate <= lastThrough) {
      skippedLoans++;
      continue;
    }

    const dailyFeeRule = safeJsonParse<any>((loan.product as any).dailyFee, undefined);
    if (!loan.product.dailyFeeEnabled || !dailyFeeRule || !dailyFeeRule.value || Number(dailyFeeRule.value) <= 0) {
      // No daily fee => nothing to accrue
      await prisma.loan.update({
        where: { id: loan.id },
        data: { interestAccruedThroughDate: interestEndDate } as any,
      });
      skippedLoans++;
      continue;
    }

    const feeValue = typeof dailyFeeRule.value === 'string' ? Number(dailyFeeRule.value) : Number(dailyFeeRule.value);
    const payments = normalizePayments((loan as any).payments);

    // Compute total interest through interestEndDate, then subtract already accrued.
    // This ensures catch-up works even if the job didn't run for multiple days.
    const totalInterestToDate = calculateInterestWithPayments({
      principal: loan.loanAmount,
      loanStartDate,
      interestEndDate,
      dailyFeeRule: {
        type: dailyFeeRule.type,
        value: feeValue,
        calculationBase: dailyFeeRule.calculationBase,
      },
      serviceFee: loan.serviceFee,
      payments,
    });

    const alreadyAccrued = Number((loan as any).interestAccruedAmount ?? 0);
    const delta = totalInterestToDate - alreadyAccrued;

    // Ignore tiny negative/near-zero drift
    if (delta <= 0.000001) {
      await prisma.loan.update({
        where: { id: loan.id },
        data: { interestAccruedThroughDate: interestEndDate } as any,
      });
      skippedLoans++;
      continue;
    }

    const provider = (loan.product as any).provider;

    const interestReceivable = provider.ledgerAccounts.find((a: any) => a.category === 'Interest' && a.type === 'Receivable');

    // Income is recognized on receipt (payments), not on daily accrual.
    if (!interestReceivable) {
      throw new Error(`Interest receivable ledger account not configured for provider ${provider.id}`);
    }

    const taxReceivable = provider.ledgerAccounts.find((a: any) => a.category === 'Tax' && a.type === 'Receivable');
    const taxDelta = (() => {
      if (!activeTaxConfigs || activeTaxConfigs.length === 0) return 0;
      let totalTax = 0;
      for (const taxConfig of activeTaxConfigs as any[]) {
        const taxRate = Number(taxConfig?.rate ?? 0);
        if (!taxRate || taxRate <= 0) continue;
        let appliedTo: string[] = [];
        try {
          appliedTo = JSON.parse(String(taxConfig?.appliedTo ?? '[]'));
        } catch {
          appliedTo = [];
        }
        if (Array.isArray(appliedTo) && appliedTo.includes('interest')) {
          totalTax += delta * (taxRate / 100);
        }
      }
      return totalTax;
    })();

    await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          providerId: provider.id,
          loanId: loan.id,
          date: interestEndDate,
          description: `Daily interest accrual through ${interestEndDate.toISOString().slice(0, 10)} for loan ${loan.id}`,
        },
      });

      const ledgerCreates: Array<{ journalEntryId: string; ledgerAccountId: string; type: string; amount: number }> = [
        { journalEntryId: journalEntry.id, ledgerAccountId: interestReceivable.id, type: 'Debit', amount: delta },
      ];

      const updates: Array<Promise<any>> = [
        tx.ledgerAccount.update({ where: { id: interestReceivable.id }, data: { balance: { increment: delta } } }),
      ];

      if (taxDelta > 0.000001) {
        if (!taxReceivable) {
          throw new Error(`Tax receivable ledger account not configured for provider ${provider.id}`);
        }
        ledgerCreates.push({ journalEntryId: journalEntry.id, ledgerAccountId: taxReceivable.id, type: 'Debit', amount: taxDelta });
        updates.push(tx.ledgerAccount.update({ where: { id: taxReceivable.id }, data: { balance: { increment: taxDelta } } }));
      }

      await tx.ledgerEntry.createMany({ data: ledgerCreates });
      await Promise.all(updates);

      await tx.loan.update({
        where: { id: loan.id },
        data: {
          interestAccruedAmount: alreadyAccrued + delta,
          interestAccruedThroughDate: interestEndDate,
        } as any,
      });
    });

    processedLoans++;
    totalAccrued += delta;
  }

    const result = {
      success: true,
      accrualThroughDate,
      processedLoans,
      totalAccrued,
      skippedLoans,
    };

    await createAuditLog({
      actorId: 'system',
      action: 'INTEREST_ACCRUAL_RUN_FINISHED',
      entity: 'Service',
      entityId: 'interest-accrual',
      details: {
        runId,
        accrualThroughDate: accrualThroughDate.toISOString(),
        processedLoans,
        skippedLoans,
        totalAccrued,
      },
    });

    return result;
  } catch (e: any) {
    await createAuditLog({
      actorId: 'system',
      action: 'INTEREST_ACCRUAL_RUN_FAILED',
      entity: 'Service',
      entityId: 'interest-accrual',
      details: {
        runId,
        accrualThroughDate: accrualThroughDate.toISOString(),
        error: String(e?.message ?? e),
      },
    });
    throw e;
  }
}
