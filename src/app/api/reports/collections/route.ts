

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, format, isValid } from 'date-fns';
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
    const qRaw = searchParams.get('q');
    const q = qRaw ? qRaw.trim().toLowerCase() : '';
    const dateRange = getDates(timeframe, from ?? undefined, to ?? undefined);

    // Pagination parameters
    const DEFAULT_PAGE_SIZE = 50;
    const MAX_PAGE_SIZE = 200;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
    );

    const whereClause: any = {
        type: 'Debit',
        ledgerAccount: {
            type: 'Received'
        },
        journalEntry: {
            ...(dateRange.gte && { date: { gte: dateRange.gte } }),
            ...(dateRange.lte && { date: { lte: dateRange.lte } }),
            loan: { repaymentStatus: { not: 'REVERSED' } },
        }
    };
    
    const isSuperAdminOrRecon = user.role === 'Super Admin' || user.role === 'Reconciliation';

    // Users with loanProviderId are restricted to their own provider
    // Users without loanProviderId (and with reports permission) can access all providers
    if (user.loanProviderId) {
        providerId = user.loanProviderId;
    }

    if (providerId && providerId !== 'all' && providerId !== 'none') {
        whereClause.journalEntry.providerId = providerId;
    }
    
    if (providerId === 'none') {
        return NextResponse.json({ data: [], total: 0, page: 1, pageSize, totalPages: 0 });
    }

    const branchCode = getBranchCodeFromUser(user);
    const branchBorrowerIds = await resolveBranchBorrowerIds(branchCode);
    if (branchCode != null && branchBorrowerIds?.length === 0) {
        return NextResponse.json({ data: [], total: 0, page: 1, pageSize, totalPages: 0 });
    }
    if (branchBorrowerIds) {
        applyBranchFilterToNestedLoan(whereClause.journalEntry as Record<string, unknown>, branchBorrowerIds);
    }

    try {
        const ledgerEntries = await prisma.ledgerEntry.findMany({
            where: whereClause,
            select: {
                amount: true,
                journalEntry: {
                    select: {
                        date: true,
                        provider: {
                            select: { name: true }
                        }
                    }
                },
                ledgerAccount: {
                    select: { category: true }
                }
            }
        });

        const aggregatedData: Record<string, {
            provider: string;
            principal: number;
            interest: number;
            serviceFee: number;
            penalty: number;
            tax: number;
        }> = {};
        
        for (const entry of ledgerEntries) {
            const dateStr = format(new Date(entry.journalEntry.date), 'yyyy-MM-dd');
            const providerName = entry.journalEntry.provider.name;
            const key = `${providerName}-${dateStr}`;

            if (!aggregatedData[key]) {
                aggregatedData[key] = {
                    provider: providerName,
                    principal: 0,
                    interest: 0,
                    serviceFee: 0,
                    penalty: 0,
                    tax: 0,
                };
            }

            const category = entry.ledgerAccount.category.toLowerCase();
            if (category === 'principal') aggregatedData[key].principal += entry.amount;
            else if (category === 'interest') aggregatedData[key].interest += entry.amount;
            else if (category === 'servicefee') aggregatedData[key].serviceFee += entry.amount;
            else if (category === 'penalty') aggregatedData[key].penalty += entry.amount;
            else if (category === 'tax') aggregatedData[key].tax += entry.amount;
        }
        
        let reportData = Object.entries(aggregatedData).map(([key, value]) => {
             const [provider, date] = key.split(/-(?=\d{4})/); // Split on hyphen only if followed by 4 digits (a year)
             return {
                provider,
                date,
                ...value,
                total: value.principal + value.interest + value.serviceFee + value.penalty + value.tax,
            }
        });

        if (q) {
            reportData = reportData.filter((r) => {
                return (
                    String(r.provider || '').toLowerCase().includes(q) ||
                    String(r.date || '').toLowerCase().includes(q)
                );
            });
        }
        
        reportData.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Apply pagination on aggregated data
        const total = reportData.length;
        const totalPages = Math.ceil(total / pageSize);
        const skip = (page - 1) * pageSize;
        const paginatedData = reportData.slice(skip, skip + pageSize);

        return NextResponse.json({
            data: paginatedData,
            total,
            page,
            pageSize,
            totalPages,
        });

    } catch (error) {
        console.error('Failed to fetch collections report:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
