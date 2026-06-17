

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, isValid } from 'date-fns';
import { getUserFromSession } from '@/lib/user';
import {
  applyBranchFilterToNestedLoan,
  getBranchCodeFromUser,
  resolveBranchBorrowerIds,
} from '@/lib/branch-filter';

const getDates = (timeframe: string, from?: string, to?: string) => {
    if (from && to) {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if(isValid(fromDate) && isValid(toDate)) {
            return { gte: startOfDay(fromDate), lte: endOfDay(toDate) };
        }
    }
    const now = new Date();
    switch (timeframe) {
        case 'daily':
            return { gte: startOfDay(now), lte: endOfDay(now) };
        case 'weekly':
            return { gte: startOfWeek(now, { weekStartsOn: 1 }), lte: endOfWeek(now, { weekStartsOn: 1 }) };
        case 'monthly':
            return { gte: startOfMonth(now), lte: endOfMonth(now) };
        case 'quarterly': {
            const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
            const qStart = startOfMonth(new Date(now.getFullYear(), qStartMonth, 1));
            const qEnd = endOfMonth(new Date(now.getFullYear(), qStartMonth + 2, 1));
            return { gte: qStart, lte: qEnd };
        }
        case 'semiAnnually': {
            const year = now.getFullYear();
            if (now.getMonth() < 6) {
                const s = startOfMonth(new Date(year, 0, 1));
                const e = endOfMonth(new Date(year, 5, 1));
                return { gte: s, lte: e };
            } else {
                const s = startOfMonth(new Date(year, 6, 1));
                const e = endOfMonth(new Date(year, 11, 1));
                return { gte: s, lte: e };
            }
        }
        case 'annually':
        case 'yearly':
            return { gte: startOfYear(now), lte: endOfYear(now) };
        case 'overall':
        default:
            return { gte: undefined, lte: undefined };
    }
};

async function getIncomeData(
    providerIdFilter: any,
    dateFilter: any,
    branchBorrowerIds?: string[] | null
) {
    const journalEntry: Record<string, unknown> = {
        ...providerIdFilter.journalEntry,
        ...dateFilter.journalEntry,
    };
    if (branchBorrowerIds) {
        applyBranchFilterToNestedLoan(journalEntry, branchBorrowerIds);
    }

    const whereClause: any = {
        journalEntry,
        ledgerAccount: {
            type: { in: ['Income', 'Received'] },
            category: { in: ['Interest', 'ServiceFee', 'Penalty'] }
        }
    };
    
    const results = await prisma.ledgerEntry.groupBy({
        by: ['type', 'ledgerAccountId'],
        where: whereClause,
        _sum: {
            amount: true
        }
    });

    const accountIds = results.map(r => r.ledgerAccountId);
    const accounts = await prisma.ledgerAccount.findMany({ 
        where: { id: { in: accountIds } },
        select: { id: true, category: true, type: true, providerId: true }
    });
    const accountMap = new Map(accounts.map(acc => [acc.id, acc]));

    const income = {
        accruedInterest: 0, collectedInterest: 0,
        accruedServiceFee: 0, collectedServiceFee: 0,
        accruedPenalty: 0, collectedPenalty: 0,
    };

    for (const res of results) {
        const account = accountMap.get(res.ledgerAccountId);
        if (!account) continue;

        const amount = res._sum.amount || 0;
        const category = account.category;
        
        // Income is a credit to the income account, but a debit to the received account
        if (category === 'Interest') {
            if (account.type === 'Income') income.accruedInterest += amount;
            else if (account.type === 'Received') income.collectedInterest += amount;
        } else if (category === 'ServiceFee') {
            if (account.type === 'Income') income.accruedServiceFee += amount;
            else if (account.type === 'Received') income.collectedServiceFee += amount;
        } else if (category === 'Penalty') {
            if (account.type === 'Income') income.accruedPenalty += amount;
            else if (account.type === 'Received') income.collectedPenalty += amount;
        }
    }
    return income;
}


export async function GET(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['reports']?.read) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let providerId = searchParams.get('providerId');
    const timeframe = searchParams.get('timeframe') || 'overall';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const dateRange = getDates(timeframe, from ?? undefined, to ?? undefined);

    const isSuperAdminOrRecon = user.role === 'Super Admin' || user.role === 'Reconciliation';
    const branchCode = getBranchCodeFromUser(user);
    const branchBorrowerIds = await resolveBranchBorrowerIds(branchCode);
    if (branchCode != null && branchBorrowerIds?.length === 0) {
        return NextResponse.json([]);
    }

    try {
        let providersToQuery;
        // Users with loanProviderId are restricted to their own provider
        // Users without loanProviderId (and with reports permission) can access all providers
        if (user.loanProviderId) {
            providersToQuery = [await prisma.loanProvider.findUnique({ where: { id: user.loanProviderId } })].filter(Boolean);
        } else if (providerId && providerId !== 'all') {
            providersToQuery = [await prisma.loanProvider.findUnique({ where: { id: providerId } })].filter(Boolean);
        } else {
            providersToQuery = await prisma.loanProvider.findMany();
        }

        const reportData = [];

        for (const provider of providersToQuery) {
            if(!provider) continue;
            const providerIdFilter = { journalEntry: { providerId: provider.id } };
            const dateFilter = {
                journalEntry: {
                    ...(dateRange.gte && { date: { gte: dateRange.gte } }),
                    ...(dateRange.lte && { date: { lte: dateRange.lte } }),
                }
            };
            
            const income = await getIncomeData(providerIdFilter, dateFilter, branchBorrowerIds);
            reportData.push({
                provider: provider.name,
                ...income
            });
        }
        
        return NextResponse.json(reportData);

    } catch (error) {
        console.error('Failed to fetch income report:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
