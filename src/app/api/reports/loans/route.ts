
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, differenceInDays, isValid } from 'date-fns';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import type { Loan, LoanProduct, Payment, ProvisionedData } from '@prisma/client';
import { getUserFromSession } from '@/lib/user';
import { applyBranchFilterToLoanWhere, getBranchCodeFromUser } from '@/lib/branch-filter';

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

type LoanWithRelations = Loan & {
    product: LoanProduct & { provider: { name: string } };
    payments: Payment[];
    borrower: {
        id: string;
        provisionedData: ProvisionedData[];
     };
};

const getBorrowerName = (borrower: { provisionedData: ProvisionedData[] }): string => {
    if (!borrower || !borrower.provisionedData || borrower.provisionedData.length === 0) {
        return 'N/A';
    }
    // Find the latest provisioned data that might have a name
    for (const entry of borrower.provisionedData) {
         try {
            const data = JSON.parse(entry.data as string);
            const fullNameKey = Object.keys(data).find(k => k.toLowerCase() === 'fullname' || k.toLowerCase() === 'full name' || k.toLowerCase() === 'customername');
            if (fullNameKey && data[fullNameKey]) {
                return data[fullNameKey];
            }
        } catch (e) {
            // Ignore parsing errors
        }
    }
    return 'N/A';
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
    const search = searchParams.get('search')?.trim();
    const dateRange = getDates(timeframe, from ?? undefined, to ?? undefined);

    // Pagination parameters
    const DEFAULT_PAGE_SIZE = 50;
    const MAX_PAGE_SIZE = 200;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
    );
    const skip = (page - 1) * pageSize;

    const whereClause: any = {};

    // Failed external disbursements can be reversed internally; those loans are marked REVERSED
    // and should not appear in reporting outputs.
    whereClause.repaymentStatus = { not: 'REVERSED' };

    if (dateRange.gte && dateRange.lte) {
        whereClause.disbursedDate = {
            gte: dateRange.gte,
            lte: dateRange.lte,
        };
    }
    
    const isSuperAdminOrRecon = user.role === 'Super Admin' || user.role === 'Reconciliation';

    // Users with loanProviderId are restricted to their own provider
    // Users without loanProviderId (and with reports permission) can access all providers
    if (user.loanProviderId) {
        providerId = user.loanProviderId;
    }
    
    if (providerId && providerId !== 'all' && providerId !== 'none') {
        whereClause.product = { providerId };
    }

    if (providerId === 'none') {
        return NextResponse.json({ data: [], total: 0, page: 1, pageSize, totalPages: 0 });
    }

    const branchCode = getBranchCodeFromUser(user);

    // Search by account number or phone number
    // SQL Server doesn't support mode: "insensitive", so we use startsWith or contains without mode
    if (search) {
        // Find phone accounts matching the search term (by accountNumber or phoneNumber)
        const matchingPhoneAccounts = await prisma.phoneAccount.findMany({
            where: {
                OR: [
                    { accountNumber: { contains: search } },
                    { phoneNumber: { contains: search } },
                ],
            },
            select: { phoneNumber: true },
            take: 500,
        });
        const matchingBorrowerIds = [...new Set(matchingPhoneAccounts.map(pa => pa.phoneNumber))];
        
        if (matchingBorrowerIds.length === 0) {
            // No matching accounts found, return empty result
            return NextResponse.json({ data: [], total: 0, page: 1, pageSize, totalPages: 0 });
        }
        
        whereClause.borrowerId = { in: matchingBorrowerIds };
    }

    const branchOk = await applyBranchFilterToLoanWhere(whereClause, branchCode);
    if (!branchOk) {
        return NextResponse.json({ data: [], total: 0, page: 1, pageSize, totalPages: 0 });
    }

    try {
        // Get total count for pagination
        const totalCount = await prisma.loan.count({ where: whereClause });
        const totalPages = Math.ceil(totalCount / pageSize);

        const [loans, taxConfigs] = await Promise.all([
            prisma.loan.findMany({
                where: whereClause,
                include: {
                    product: {
                        include: {
                            provider: true,
                        },
                    },
                    payments: true,
                    borrower: {
                       include: {
                            // Include all provisioned data and sort by latest, we'll find the name in code.
                            provisionedData: {
                                orderBy: {
                                    createdAt: 'desc'
                                }
                            }
                        }
                    }
                },
                orderBy: {
                    disbursedDate: 'desc',
                },
                skip,
                take: pageSize,
            }),
            prisma.tax.findMany()
        ]);
        
        const today = new Date();
        const reportData = loans.map(loan => {
            // Determine the as-of date for calculation.
            // If the loan is paid, we use the date of the last payment to correctly
            // calculate the historical fees/penalties that were due at the time of payment.
            let asOfDate = today;
            if (loan.repaymentStatus === 'Paid' && loan.payments.length > 0) {
                // loan.payments is ordered by date desc in the query above
                asOfDate = new Date(loan.payments[0].date);
            }

            const { total, principal, interest, penalty, serviceFee } = calculateTotalRepayable(loan as any, loan.product, taxConfigs, asOfDate, true);
            
            const totalRepaid = (loan.repaidAmount || 0);

            // Correct calculation for outstanding amounts
            const penaltyPaid = Math.min(totalRepaid, penalty);
            const serviceFeePaid = Math.min(Math.max(0, totalRepaid - penalty), serviceFee);
            const interestPaid = Math.min(Math.max(0, totalRepaid - penalty - serviceFee), interest);
            const principalPaid = Math.max(0, totalRepaid - penalty - serviceFee - interest);

            const totalOutstanding = Math.max(0, total - totalRepaid);

            let principalOutstanding = principal - principalPaid;
            let interestOutstanding = interest - interestPaid;
            let serviceFeeOutstanding = serviceFee - serviceFeePaid;
            let penaltyOutstanding = penalty - penaltyPaid;

            let status = 'Current';
            const daysInArrears = differenceInDays(today, loan.dueDate);
            const isOutstandingZero = totalOutstanding <= 0.01;

            if (loan.repaymentStatus === 'Paid' || isOutstandingZero) {
                status = 'Paid';
                // Force components to zero if fully paid to avoid negative values due to calculation differences
                principalOutstanding = 0;
                interestOutstanding = 0;
                serviceFeeOutstanding = 0;
                penaltyOutstanding = 0;
            } else if (loan.repaymentStatus === 'Unpaid' && daysInArrears > 0) {
                status = 'Overdue';
                if (daysInArrears > 60) { // Example for NPL/Defaulted
                    status = 'Defaulted';
                }
            }
            
            const borrowerName = getBorrowerName(loan.borrower);
            
            return {
                provider: loan.product.provider.name,
                loanId: loan.id,
                borrowerId: loan.borrowerId,
                borrowerName: borrowerName !== 'N/A' ? borrowerName : `B-${loan.borrowerId.slice(0, 4)}`,
                principalDisbursed: loan.loanAmount,
                principalOutstanding,
                interestOutstanding,
                serviceFeeOutstanding,
                penaltyOutstanding,
                totalOutstanding,
                status,
                daysInArrears: (status === 'Overdue' || status === 'Defaulted') ? daysInArrears : 0,
            };
        });

        return NextResponse.json({
            data: reportData,
            total: totalCount,
            page,
            pageSize,
            totalPages,
        });

    } catch (error) {
        console.error('Failed to fetch loans report:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
