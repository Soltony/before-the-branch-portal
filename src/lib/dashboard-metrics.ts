import type { PrismaClient } from '@prisma/client';

const CATEGORIES = ['Principal', 'Interest', 'ServiceFee', 'Penalty', 'Tax'] as const;
type Category = (typeof CATEGORIES)[number];

type CategoryAmounts = Record<Lowercase<Category>, number>;

function emptyCategoryAmounts(): CategoryAmounts {
  return {
    principal: 0,
    interest: 0,
    servicefee: 0,
    penalty: 0,
    tax: 0,
  };
}

function categoryKey(category: string): keyof CategoryAmounts {
  return category.toLowerCase() as keyof CategoryAmounts;
}

/**
 * Portfolio metrics scoped to non-REVERSED loans so dashboard totals match loan reports.
 * Ledger account balances include residue from reversed loans; entry-level sums do not.
 */
export async function getPortfolioLedgerMetrics(
  prisma: PrismaClient,
  providerId?: string,
): Promise<{
  totalDisbursed: number;
  receivables: {
    principal: number;
    interest: number;
    serviceFee: number;
    penalty: number;
    tax: number;
  };
  collections: {
    principal: number;
    interest: number;
    serviceFee: number;
    penalty: number;
    tax: number;
  };
}> {
  const activeLoans = await prisma.loan.findMany({
    where: {
      repaymentStatus: { not: 'REVERSED' },
      ...(providerId ? { product: { providerId } } : {}),
    },
    select: { id: true, loanAmount: true },
  });

  const loanIds = activeLoans.map((l) => l.id);
  const totalDisbursed = activeLoans.reduce((sum, l) => sum + l.loanAmount, 0);

  const receivableNet = emptyCategoryAmounts();
  const receivedNet = emptyCategoryAmounts();

  if (loanIds.length === 0) {
    return {
      totalDisbursed: 0,
      receivables: {
        principal: 0,
        interest: 0,
        serviceFee: 0,
        penalty: 0,
        tax: 0,
      },
      collections: {
        principal: 0,
        interest: 0,
        serviceFee: 0,
        penalty: 0,
        tax: 0,
      },
    };
  }

  const accounts = await prisma.ledgerAccount.findMany({
    where: {
      category: { in: [...CATEGORIES] },
      type: { in: ['Receivable', 'Received'] },
      ...(providerId ? { providerId } : {}),
    },
    select: { id: true, type: true, category: true },
  });

  if (accounts.length === 0) {
    return {
      totalDisbursed,
      receivables: {
        principal: 0,
        interest: 0,
        serviceFee: 0,
        penalty: 0,
        tax: 0,
      },
      collections: {
        principal: 0,
        interest: 0,
        serviceFee: 0,
        penalty: 0,
        tax: 0,
      },
    };
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const accountIds = accounts.map((a) => a.id);

  // SQL Server caps ~2100 parameters per query; batch loan IDs.
  const LOAN_ID_BATCH = 500;
  const entries: { amount: number; type: string; ledgerAccountId: string }[] = [];
  for (let i = 0; i < loanIds.length; i += LOAN_ID_BATCH) {
    const batch = loanIds.slice(i, i + LOAN_ID_BATCH);
    const batchEntries = await prisma.ledgerEntry.findMany({
      where: {
        ledgerAccountId: { in: accountIds },
        journalEntry: { loanId: { in: batch } },
      },
      select: { amount: true, type: true, ledgerAccountId: true },
    });
    entries.push(...batchEntries);
  }

  for (const entry of entries) {
    const account = accountById.get(entry.ledgerAccountId);
    if (!account) continue;
    const signed = entry.type === 'Debit' ? entry.amount : -entry.amount;
    const key = categoryKey(account.category);
    if (account.type === 'Receivable') {
      receivableNet[key] += signed;
    } else {
      receivedNet[key] += signed;
    }
  }

  const clampReceivable = (value: number) => Math.max(0, value);

  return {
    totalDisbursed,
    receivables: {
      principal: receivableNet.principal,
      interest: clampReceivable(receivableNet.interest),
      serviceFee: clampReceivable(receivableNet.servicefee),
      penalty: clampReceivable(receivableNet.penalty),
      tax: clampReceivable(receivableNet.tax),
    },
    collections: {
      principal: receivedNet.principal,
      interest: receivedNet.interest,
      serviceFee: receivedNet.servicefee,
      penalty: receivedNet.penalty,
      tax: receivedNet.tax,
    },
  };
}
