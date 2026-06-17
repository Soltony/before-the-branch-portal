'use server';

import prisma from '@/lib/prisma';
import { startOfDay } from 'date-fns';
import { calculateInterestWithPayments, normalizePayments } from '@/lib/interest-accrual';
import { calculatePenaltyWithPayments, normalizeInstallmentPayments } from '@/lib/penalty-accrual';
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

export async function runDailyPenaltyAccrualOnce(asOf: Date = new Date()): Promise<{
  success: boolean;
  accrualThroughDate: Date;
  processedLoans: number;
  totalAccrued: number;
  skippedLoans: number;
}> {
  const accrualThroughDate = startOfDay(asOf); // accrue penalty for days strictly before "today"
  const runId = newAuditCorrelationId();

  try {
    const activeTaxConfigs = await prisma.tax.findMany({ where: { status: 'ACTIVE' } });

    const loans = await prisma.loan.findMany({
      where: {
        repaymentStatus: 'Unpaid',
        dueDate: { lt: accrualThroughDate },
      },
      include: {
        payments: { orderBy: { date: 'asc' } },
        installments: true,
        product: {
          include: {
            provider: { include: { ledgerAccounts: true } },
          },
        },
      },
    });

    await createAuditLog({
      actorId: 'system',
      action: 'PENALTY_ACCRUAL_RUN_STARTED',
      entity: 'Service',
      entityId: 'penalty-accrual',
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
    const dueDate = startOfDay(new Date(loan.dueDate));
    const loanStartDate = startOfDay(new Date(loan.disbursedDate));

    const penaltyEndDate = accrualThroughDate;

    const duration = Number((loan.product as any).duration ?? 0);
    const penaltyStartDate = duration === 0 ? startOfDay(new Date(loan.disbursedDate.getTime() + 86400000)) : dueDate;

    const lastThroughRaw = (loan as any).penaltyAccruedThroughDate as Date | null | undefined;
    const lastThrough = lastThroughRaw ? startOfDay(new Date(lastThroughRaw)) : penaltyStartDate;
    if (penaltyEndDate <= lastThrough) {
      skippedLoans++;
      continue;
    }

    const penaltyRules = safeJsonParse<any>((loan.product as any).penaltyRules, []);
    const penaltyRulesEnabled = Boolean((loan.product as any).penaltyRulesEnabled);

    if (!penaltyRulesEnabled || !Array.isArray(penaltyRules) || penaltyRules.length === 0) {
      await prisma.loan.update({
        where: { id: loan.id },
        data: { penaltyAccruedThroughDate: penaltyEndDate } as any,
      });
      skippedLoans++;
      continue;
    }

    // Build running balance for compound penalty base (principal + service fee + interest-through-due-date)
    let interestThroughDueDate = 0;
    const dailyFeeRule = safeJsonParse<any>((loan.product as any).dailyFee, undefined);
    if ((loan.product as any).dailyFeeEnabled && dailyFeeRule && Number(dailyFeeRule.value) > 0) {
      const feeValue = typeof dailyFeeRule.value === 'string' ? Number(dailyFeeRule.value) : Number(dailyFeeRule.value);
      const interestEndDate = dueDate;
      const payments = normalizePayments((loan as any).payments);
      interestThroughDueDate = calculateInterestWithPayments({
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
    }

    const runningBalanceForCompound = Number(loan.loanAmount) + Number(loan.serviceFee) + Number(interestThroughDueDate);

    const penaltyPerInstallment = Boolean((loan.product as any).penaltyPerInstallment);

    const paymentsWithInstallment = normalizeInstallmentPayments((loan as any).payments);

    const { totalPenalty, installmentPenaltyById } = calculatePenaltyWithPayments({
      penaltyStartDate,
      penaltyEndDate,
      penaltyRules,
      penaltyPerInstallment,
      principal: loan.loanAmount,
      runningBalanceForCompound,
      installments: (loan as any).installments?.map((i: any) => ({ id: i.id, dueDate: i.dueDate, amount: i.amount })) ?? [],
      payments: paymentsWithInstallment,
    });

    const alreadyAccrued = Number((loan as any).penaltyAccruedAmount ?? 0);
    const delta = totalPenalty - alreadyAccrued;

    if (delta <= 0.000001) {
      // Keep display fields up to date even if there's no new accrual
      await prisma.$transaction(async (tx) => {
        await tx.loan.update({
          where: { id: loan.id },
          data: { penaltyAccruedThroughDate: penaltyEndDate, penaltyAmount: totalPenalty } as any,
        });

        if (penaltyPerInstallment && installmentPenaltyById) {
          const updates = Object.entries(installmentPenaltyById).map(([id, amt]) =>
            tx.loanInstallment.update({ where: { id }, data: { penaltyAmount: amt } as any })
          );
          if (updates.length) await Promise.all(updates);
        }
      });

      skippedLoans++;
      continue;
    }

    const provider = (loan.product as any).provider;

    const penaltyReceivable = provider.ledgerAccounts.find((a: any) => a.category === 'Penalty' && a.type === 'Receivable');

    // Income is recognized on receipt (payments), not on daily accrual.
    if (!penaltyReceivable) {
      throw new Error(`Penalty receivable ledger account not configured for provider ${provider.id}`);
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
        if (Array.isArray(appliedTo) && appliedTo.includes('penalty')) {
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
          date: penaltyEndDate,
          description: `Daily penalty accrual through ${penaltyEndDate.toISOString().slice(0, 10)} for loan ${loan.id}`,
        },
      });

      const ledgerCreates: Array<{ journalEntryId: string; ledgerAccountId: string; type: string; amount: number }> = [
        { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceivable.id, type: 'Debit', amount: delta },
      ];

      const updates: Array<Promise<any>> = [
        tx.ledgerAccount.update({ where: { id: penaltyReceivable.id }, data: { balance: { increment: delta } } }),
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
          penaltyAccruedAmount: alreadyAccrued + delta,
          penaltyAccruedThroughDate: penaltyEndDate,
          penaltyAmount: totalPenalty,
        } as any,
      });

      if (penaltyPerInstallment && installmentPenaltyById) {
        const updates = Object.entries(installmentPenaltyById).map(([id, amt]) =>
          tx.loanInstallment.update({ where: { id }, data: { penaltyAmount: amt } as any })
        );
        if (updates.length) await Promise.all(updates);
      }
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
      action: 'PENALTY_ACCRUAL_RUN_FINISHED',
      entity: 'Service',
      entityId: 'penalty-accrual',
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
      action: 'PENALTY_ACCRUAL_RUN_FAILED',
      entity: 'Service',
      entityId: 'penalty-accrual',
      details: {
        runId,
        accrualThroughDate: accrualThroughDate.toISOString(),
        error: String(e?.message ?? e),
      },
    });
    throw e;
  }
}
