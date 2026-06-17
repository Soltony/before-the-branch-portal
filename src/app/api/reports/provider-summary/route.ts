

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, differenceInDays, isValid } from 'date-fns';
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
}

async function getAggregatedLedgerEntries(
    providerId: string,
    timeframe: string,
    from: string | null,
    to: string | null,
    entryType: 'Debit' | 'Credit',
    accountTypes: string[],
    categories: string[],
    branchBorrowerIds?: string[] | null
) {
     const dateRange = getDates(timeframe, from ?? undefined, to ?? undefined);
     const journalEntry: Record<string, unknown> = {
        providerId: providerId,
        ...(dateRange.gte && { date: { gte: dateRange.gte } }),
        ...(dateRange.lte && { date: { lte: dateRange.lte } }),
     };
     if (branchBorrowerIds) {
        applyBranchFilterToNestedLoan(journalEntry, branchBorrowerIds);
     }

     const result = await prisma.ledgerEntry.groupBy({
        by: ['ledgerAccountId'],
        where: {
            journalEntry,
            type: entryType,
            ledgerAccount: {
                type: { in: accountTypes },
                category: { in: categories }
            }
        },
        _sum: {
            amount: true
        }
    });

    const accountIds = result.map(r => r.ledgerAccountId);
    const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: accountIds } } });
    const accountMap = new Map(accounts.map(acc => [acc.id, acc]));

    const aggregated = categories.reduce((acc, cat) => ({...acc, [cat.toLowerCase()]: 0}), {} as Record<string, number>);

    for (const item of result) {
        const account = accountMap.get(item.ledgerAccountId);
        if (account) {
            const key = account.category.toLowerCase();
            if (aggregated.hasOwnProperty(key)) {
                aggregated[key] += item._sum.amount || 0;
            }
        }
    }
    return aggregated;
}

export async function GET(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user || !user.permissions?.['reports']?.read) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId');
    const timeframe = searchParams.get('timeframe') || 'daily';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!providerId) {
        return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 });
    }
    
    // Authorization check
    // Users with loanProviderId are restricted to their own provider
    // Users without loanProviderId (and with reports permission) can access any provider
    const isSuperAdminOrRecon = user.role === 'Super Admin' || user.role === 'Reconciliation';
    if (user.loanProviderId && user.loanProviderId !== providerId) {
        return NextResponse.json({ error: 'Forbidden: You can only access reports for your own provider.' }, { status: 403 });
    }

    try {
        const dateRange = getDates(timeframe, from ?? undefined, to ?? undefined);
        const branchCode = getBranchCodeFromUser(user);
        const branchBorrowerIds = await resolveBranchBorrowerIds(branchCode);
        if (branchCode != null && branchBorrowerIds?.length === 0) {
            return NextResponse.json({
                portfolioSummary: { disbursed: 0, repaid: 0, outstanding: 0 },
                collections: {},
                totalCollected: 0,
                incomeStatement: {},
                netRealizedIncome: 0,
                fundUtilization: 0,
                agingReport: [],
            });
        }
        const branchLoanFilter = branchBorrowerIds
            ? { borrowerId: { in: branchBorrowerIds } }
            : {};

        // 1. Portfolio Summary
        const disbursedResult = await prisma.loan.aggregate({
            _sum: { loanAmount: true },
            where: {
                product: { providerId },
                // Failed external disbursements can be reversed internally; those loans are marked REVERSED
                // and should not count as disbursed in reports.
                repaymentStatus: { not: 'REVERSED' },
                ...(dateRange.gte && { disbursedDate: { gte: dateRange.gte } }),
                ...(dateRange.lte && { disbursedDate: { lte: dateRange.lte } }),
                ...branchLoanFilter,
            },
        });

        const repaidResult = await prisma.payment.aggregate({
            _sum: { amount: true },
            where: {
                loan: { product: { providerId }, ...branchLoanFilter },
                ...(dateRange.gte && { date: { gte: dateRange.gte } }),
                ...(dateRange.lte && { date: { lte: dateRange.lte } }),
            },
        });
        
        const outstandingLoans = await prisma.loan.aggregate({
            _sum: { loanAmount: true },
            where: {
                product: { providerId },
                repaymentStatus: 'Unpaid',
                ...branchLoanFilter,
            }
        });
        
        const portfolioSummary = {
            disbursed: disbursedResult._sum.loanAmount || 0,
            repaid: repaidResult._sum.amount || 0,
            outstanding: outstandingLoans._sum.loanAmount || 0,
        };
        
        // 2. Collections Report
        const collections = await getAggregatedLedgerEntries(providerId, timeframe, from, to, 'Debit', ['Received'], ['Principal', 'Interest', 'ServiceFee', 'Penalty'], branchBorrowerIds);
        const totalCollected = Object.values(collections).reduce((sum, val) => sum + val, 0);

        // 3. Income Statement
        const accruedIncome = await getAggregatedLedgerEntries(providerId, timeframe, from, to, 'Credit', ['Income'], ['Interest', 'ServiceFee', 'Penalty'], branchBorrowerIds);
        const collectedIncome = await getAggregatedLedgerEntries(providerId, timeframe, from, to, 'Debit', ['Received'], ['Interest', 'ServiceFee', 'Penalty'], branchBorrowerIds);
        const netRealizedIncome = (collectedIncome.interest || 0) + (collectedIncome.servicefee || 0) + (collectedIncome.penalty || 0);

        // 4. Fund Utilization
        const provider = await prisma.loanProvider.findUnique({ where: { id: providerId } });
        const totalDisbursedEver = (
            await prisma.loan.aggregate({
                _sum: { loanAmount: true },
                where: {
                    product: { providerId },
                    repaymentStatus: { not: 'REVERSED' },
                    ...branchLoanFilter,
                },
            })
        )._sum.loanAmount || 0;
        const fundUtilization = provider && provider.startingCapital > 0 ? (totalDisbursedEver / provider.startingCapital) * 100 : 0;

        // 5. Aging Report (snapshot as of today) - borrower level amounts and provider classification
        const today = startOfDay(new Date());
        const overdueLoans = await prisma.loan.findMany({
            where: {
                product: { providerId },
                repaymentStatus: 'Unpaid',
                dueDate: { lt: today },
                ...branchLoanFilter,
            },
            include: { 
                borrower: { 
                    include: { 
                        provisionedData: { 
                            orderBy: { createdAt: 'desc' }, 
                            take: 1 
                        } 
                    } 
                },
                payments: {
                    select: { amount: true }
                }
            },
        });

        const classifications = [
            { key: 'Pass', min: 0, max: 29 },
            { key: 'Special Mention', min: 30, max: 89 },
            { key: 'Substandard', min: 90, max: 179 },
            { key: 'Doubtful', min: 180, max: 359 },
            { key: 'Loss', min: 360, max: Infinity },
        ];

        const classify = (days: number) => {
            for (const c of classifications) {
                if (days >= c.min && days <= c.max) return c.key;
            }
            return 'Unknown';
        };

        // Initialize provider-level counters
        const providerBuckets = {
            Pass: 0,
            'Special Mention': 0,
            Substandard: 0,
            Doubtful: 0,
            Loss: 0,
        };
        let providerTotalOverdue = 0;

        // Preload phoneAccount active mappings for borrowers to avoid N+1
        const borrowerIds = Array.from(new Set(overdueLoans.map(l => l.borrowerId)));
        const phoneAccounts = borrowerIds.length > 0 ? await prisma.phoneAccount.findMany({ where: { phoneNumber: { in: borrowerIds }, isActive: true } }) : [];
        const phoneMap = new Map(phoneAccounts.map(p => [p.phoneNumber, p.accountNumber]));

        // Preload ledger entries for all overdue loans to avoid N+1
        const overdueLoanIds = overdueLoans.map(l => l.id);
        const allLedgerEntries = overdueLoanIds.length > 0 ? await prisma.ledgerEntry.findMany({
            where: { 
                journalEntry: { 
                    loanId: { in: overdueLoanIds } 
                } 
            },
            include: { 
                ledgerAccount: {
                    select: { category: true }
                },
                journalEntry: { 
                    select: { loanId: true } 
                }
            }
        }) : [];

        // Group ledger entries by loanId for fast lookup
        const ledgerMap = new Map<string, any[]>();
        for (const entry of allLedgerEntries) {
            const loanId = entry.journalEntry?.loanId;
            if (loanId) {
                if (!ledgerMap.has(loanId)) ledgerMap.set(loanId, []);
                ledgerMap.get(loanId)!.push(entry);
            }
        }

        // Helper: extract borrower name from provisionedData payload
        const getBorrowerNameFromProvisioned = (pdRaw: string | undefined | null) => {
            if (!pdRaw) return null;
            try {
                const pd = JSON.parse(pdRaw as string);
                const nameKeys = ['FullName', 'fullName', 'fullname', 'name', 'customerName', 'CustomerName'];
                for (const k of nameKeys) {
                    if (pd[k]) return String(pd[k]);
                }
                // fallback: try first string value
                for (const v of Object.values(pd)) {
                    if (typeof v === 'string' && v.length > 2) return v;
                }
            } catch (e) {
                return null;
            }
            return null;
        };

        // Per-borrower aggregation
        const byBorrower: Record<string, any> = {};

        for (const loan of overdueLoans) {
            const daysOverdue = differenceInDays(today, loan.dueDate);
            const classification = classify(daysOverdue);

            // Determine repaid amount from pre-fetched payments
            let repaid = loan.repaidAmount ?? 0;
            if (!repaid || repaid === 0) {
                repaid = (loan.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
            }

            const overdueAmount = Math.max(0, (loan.loanAmount || 0) - repaid);
            if (overdueAmount <= 0.01) continue;

            // Compute per-component outstanding amounts for this loan from pre-fetched ledger entries
            const entries = ledgerMap.get(loan.id) || [];

            let principalOutstandingForLoan = 0;
            let interestOutstandingForLoan = 0;
            let serviceFeeOutstandingForLoan = 0;
            let penaltyOutstandingForLoan = 0;

            for (const e of entries) {
                const category = (e.ledgerAccount?.category || '').toString();
                // Convention: Debits increase receivable, Credits reduce receivable.
                const signed = e.type === 'Debit' ? (e.amount || 0) : -(e.amount || 0);
                if (category === 'Principal') principalOutstandingForLoan += signed;
                if (category === 'Interest') interestOutstandingForLoan += signed;
                if (category === 'ServiceFee') serviceFeeOutstandingForLoan += signed;
                if (category === 'Penalty') penaltyOutstandingForLoan += signed;
            }

            // Ensure non-negative and fallback to coarse overdue amount if ledger data is not present
            principalOutstandingForLoan = Math.max(0, principalOutstandingForLoan) || 0;
            interestOutstandingForLoan = Math.max(0, interestOutstandingForLoan) || 0;
            serviceFeeOutstandingForLoan = Math.max(0, serviceFeeOutstandingForLoan) || 0;
            penaltyOutstandingForLoan = Math.max(0, penaltyOutstandingForLoan) || 0;

            // If ledger-derived total is zero (no entries), fallback to distributing overdueAmount into principal
            const ledgerTotal = principalOutstandingForLoan + interestOutstandingForLoan + serviceFeeOutstandingForLoan + penaltyOutstandingForLoan;
            if (ledgerTotal === 0) {
                principalOutstandingForLoan = overdueAmount;
            }

            // (provider-level counts are incremented later after borrower aggregation)

            const borrowerKey = loan.borrowerId;
            if (!byBorrower[borrowerKey]) {
                // try to derive borrower name from provisionedData
                const pdRaw = loan.borrower?.provisionedData?.[0]?.data;
                const derivedName = getBorrowerNameFromProvisioned(pdRaw) || null;
                byBorrower[borrowerKey] = {
                    borrowerId: borrowerKey,
                    borrowerName: derivedName || (loan.borrower ? (loan.borrower.id || '') : ''),
                    borrowerAccount: '',
                    provider: provider ? provider.name : '',
                    maxDaysOverdue: daysOverdue,
                    buckets: {
                        Pass: 0,
                        'Special Mention': 0,
                        Substandard: 0,
                        Doubtful: 0,
                        Loss: 0,
                    },
                    totalOverdue: 0,
                    principalOutstanding: 0,
                    interestOutstanding: 0,
                    serviceFeeOutstanding: 0,
                    penaltyOutstanding: 0,
                };
            }
            // update maxDaysOverdue for classification after aggregation
            if (byBorrower[borrowerKey].maxDaysOverdue === undefined || daysOverdue > byBorrower[borrowerKey].maxDaysOverdue) {
                byBorrower[borrowerKey].maxDaysOverdue = daysOverdue;
            }
            byBorrower[borrowerKey].buckets[classification] += overdueAmount;
            byBorrower[borrowerKey].totalOverdue += overdueAmount;
            byBorrower[borrowerKey].principalOutstanding += principalOutstandingForLoan;
            byBorrower[borrowerKey].interestOutstanding += interestOutstandingForLoan;
            byBorrower[borrowerKey].serviceFeeOutstanding += serviceFeeOutstandingForLoan;
            byBorrower[borrowerKey].penaltyOutstanding += penaltyOutstandingForLoan;

            // set borrower account if not yet set: prefer active phoneAccount mapping, fallback to provisionedData
            if (!byBorrower[borrowerKey].borrowerAccount) {
                const fromPhone = phoneMap.get(borrowerKey);
                if (fromPhone) {
                    byBorrower[borrowerKey].borrowerAccount = String(fromPhone);
                } else {
                    const pdRaw = loan.borrower?.provisionedData?.[0]?.data;
                    if (pdRaw) {
                        try {
                            const pd = JSON.parse(pdRaw as string);
                            const candidate = pd.AccountNumber ?? pd.accountNumber ?? pd.account_number ?? pd.accountNo ?? pd.account_no ?? null;
                            if (candidate) byBorrower[borrowerKey].borrowerAccount = String(candidate);
                        } catch (e) {
                            // ignore parse errors
                        }
                    }
                }
            }

            // increment provider-level counts (one loan = one count)
            providerBuckets[classification] = (providerBuckets[classification] || 0) + 1;
            providerTotalOverdue += 1;
        }

        // providerBuckets and providerTotalOverdue were accumulated per loan in the loop above
        // Compute per-borrower classification (based on worst/max days overdue) and classificationAmount
        for (const b of Object.values(byBorrower)) {
            const maxDays = b.maxDaysOverdue ?? 0;
            // expose daysOverdue for UI
            b.daysOverdue = maxDays;
            const borrowerClass = classify(maxDays);
            b.classification = borrowerClass;
            b.classificationAmount = b.buckets?.[borrowerClass] || 0;
            // remove internal helper key
            delete b.maxDaysOverdue;
        }
        return NextResponse.json({
            portfolioSummary,
            collectionsReport: { ...collections, total: totalCollected },
            incomeStatement: { accrued: accruedIncome, collected: collectedIncome, net: netRealizedIncome },
            fundUtilization,
            agingReport: {
                buckets: providerBuckets,
                totalOverdue: providerTotalOverdue,
                byBorrower: Object.values(byBorrower)
            }
        });
    } catch (error) {
        console.error('Failed to fetch provider report data:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
