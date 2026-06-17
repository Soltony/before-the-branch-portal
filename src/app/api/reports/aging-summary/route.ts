import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { differenceInDays } from 'date-fns';
import { getUserFromSession } from '@/lib/user';
import { applyBranchFilterToLoanWhere, getBranchCodeFromUser } from '@/lib/branch-filter';

// Aging buckets
const BUCKETS = [
  { label: 'Pass', min: 0, max: 29 },
  { label: 'Special Mention', min: 30, max: 89 },
  { label: 'Substandard', min: 90, max: 179 },
  { label: 'Doubtful', min: 180, max: 359 },
  { label: 'Loss', min: 360, max: Infinity },
];

function classifyAging(daysOverdue: number) {
  for (const bucket of BUCKETS) {
    if (daysOverdue >= bucket.min && daysOverdue <= bucket.max) {
      return bucket.label;
    }
  }
  return 'Unknown';
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['reports']?.read) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Optionally filter by providerId
  const { searchParams } = new URL(req.url);
  let providerId = searchParams.get('providerId');

  // Users with loanProviderId are restricted to their own provider
  // Users without loanProviderId (and with reports permission) can access all providers
  if (user.loanProviderId) {
    providerId = user.loanProviderId;
  }

  const branchCode = getBranchCodeFromUser(user);
  const loanWhere: Record<string, unknown> = {
    ...(providerId ? { providerId } : {}),
    status: { not: 'CLOSED' },
  };
  const branchOk = await applyBranchFilterToLoanWhere(loanWhere, branchCode);
  if (!branchOk) {
    return NextResponse.json({ byBorrower: [], byProvider: [] });
  }

  // Get all active loans with overdue principal/interest
  const loans = await prisma.loan.findMany({
    where: loanWhere,
    include: {
      borrower: true,
      provider: true,
      repayments: true,
    },
  });

  // Aggregate by borrower and provider
  const summary: Record<string, any> = {};

  for (const loan of loans) {
    // Find max overdue days for this loan
    let maxOverdue = 0;
    let totalOverdue = 0;
    for (const repayment of loan.repayments) {
      if (!repayment.paidAt && repayment.dueDate < new Date()) {
        const days = differenceInDays(new Date(), repayment.dueDate);
        if (days > maxOverdue) maxOverdue = days;
        totalOverdue += repayment.amount;
      }
    }
    if (totalOverdue === 0) continue; // skip if nothing overdue
    const status = classifyAging(maxOverdue);
    const key = `${loan.provider.id}|${loan.borrower.id}`;
    if (!summary[key]) {
      summary[key] = {
        provider: loan.provider.name,
        borrower: loan.borrower.name,
        Pass: 0,
        'Special Mention': 0,
        Substandard: 0,
        Doubtful: 0,
        Loss: 0,
        totalOverdue: 0,
      };
    }
    summary[key][status] += totalOverdue;
    summary[key].totalOverdue += totalOverdue;
  }

  // Group by provider for summary
  const providerSummary: Record<string, any> = {};
  for (const row of Object.values(summary)) {
    const prov = row.provider;
    if (!providerSummary[prov]) {
      providerSummary[prov] = {
        provider: prov,
        Pass: 0,
        'Special Mention': 0,
        Substandard: 0,
        Doubtful: 0,
        Loss: 0,
        totalOverdue: 0,
      };
    }
    providerSummary[prov].Pass += row.Pass;
    providerSummary[prov]['Special Mention'] += row['Special Mention'];
    providerSummary[prov].Substandard += row.Substandard;
    providerSummary[prov].Doubtful += row.Doubtful;
    providerSummary[prov].Loss += row.Loss;
    providerSummary[prov].totalOverdue += row.totalOverdue;
  }

  return NextResponse.json({
    byBorrower: Object.values(summary),
    byProvider: Object.values(providerSummary),
  });
}
