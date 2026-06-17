

import { DashboardClient } from '@/components/admin/dashboard-client';
import { getPortfolioLedgerMetrics } from '@/lib/dashboard-metrics';
import prisma from '@/lib/prisma';
import type { LoanProvider, DashboardData } from '@/lib/types';
import { getUserFromSession } from '@/lib/user';
import { startOfToday, endOfToday, subDays } from 'date-fns';

export const dynamic = 'force-dynamic';

async function getProviderData(providerId?: string): Promise<DashboardData> {
    const today = new Date();
    const startOfTodayDate = startOfToday(today);
    const endOfTodayDate = endOfToday(today);

    const providerFilter = providerId ? { product: { providerId: providerId }} : {};
    const providerWhereClause = providerId ? { id: providerId } : {};
    
    // Base query for ledger entries
    const ledgerEntryWhere = providerId ? { ledgerAccount: { providerId: providerId } } : {};

    const loans = await prisma.loan.findMany({ 
        where: {
            ...providerFilter,
            repaymentStatus: { not: 'REVERSED' },
        },
        select: {
            id: true,
            loanAmount: true,
            repaymentStatus: true,
            dueDate: true,
            borrowerId: true,
            productId: true,
            product: {
                select: {
                    id: true,
                    name: true,
                    providerId: true,
                }
            }
        }
    });
    
    const usersCount = providerId 
        ? await prisma.loan.groupBy({
            by: ['borrowerId'],
                        where: { product: { providerId: providerId }, repaymentStatus: { not: 'REVERSED' } },
          }).then(results => results.length)
        : await prisma.borrower.count();

    const providersData = await prisma.loanProvider.findMany({
        where: providerWhereClause,
    });
    
    const totalStartingCapital = providersData.reduce((acc, p) => acc + p.startingCapital, 0);

    const portfolioLedger = await getPortfolioLedgerMetrics(prisma, providerId);
    const { totalDisbursed, receivables, collections } = portfolioLedger;
    const providerFund = totalStartingCapital - totalDisbursed;

    const allLedgerAccounts = await prisma.ledgerAccount.findMany({
        where: providerId ? { providerId } : {},
    });
    const aggregateLedgerBalance = (type: string, category?: string) =>
        allLedgerAccounts
            .filter((acc) => acc.type === type && (category ? acc.category === category : true))
            .reduce((sum, acc) => sum + acc.balance, 0);

    const income = {
        interest: aggregateLedgerBalance('Income', 'Interest'),
        serviceFee: aggregateLedgerBalance('Income', 'ServiceFee'),
        penalty: aggregateLedgerBalance('Income', 'Penalty'),
    };
    const totalLoans = loans.length;
    const paidLoans = loans.filter(l => l.repaymentStatus === 'Paid').length;
    const repaymentRate = totalLoans > 0 ? (paidLoans / totalLoans) * 100 : 0;
    const atRiskLoans = loans.filter(l => l.repaymentStatus === 'Unpaid' && new Date(l.dueDate) < new Date()).length;

    const dailyDisbursementResult = await prisma.loan.aggregate({
        _sum: { loanAmount: true },
        where: {
            disbursedDate: {
                gte: startOfTodayDate,
                lt: endOfTodayDate,
            },
            repaymentStatus: { not: 'REVERSED' },
            ...(providerFilter && { product: providerFilter.product })
        },
    });

    const dailyRepaymentResult = await prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
            date: {
                gte: startOfTodayDate,
                lt: endOfTodayDate,
            },
             ...(providerFilter && { loan: providerFilter })
        }
    });

    const loanDisbursementData = await Promise.all(
        Array.from({ length: 7 }).map(async (_, i) => {
            const date = subDays(startOfTodayDate, 6 - i);
            const nextDate = subDays(startOfTodayDate, 5 - i);
            const amount = await prisma.loan.aggregate({
                _sum: { loanAmount: true },
                where: {
                    disbursedDate: {
                        gte: date,
                        lt: nextDate,
                    },
                    repaymentStatus: { not: 'REVERSED' },
                    ...(providerFilter && { product: providerFilter.product })
                },
            });
            return {
                name: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                amount: amount._sum.loanAmount || 0,
            };
        })
    );

    const paidCount = loans.filter(l => l.repaymentStatus === 'Paid').length;
    const unpaidCount = loans.filter(l => l.repaymentStatus === 'Unpaid' && new Date(l.dueDate) >= new Date()).length;
    const overdueCount = atRiskLoans;
    const loanStatusData = [
        { name: 'Paid', value: paidCount },
        { name: 'Active (Unpaid)', value: unpaidCount },
        { name: 'Overdue', value: overdueCount },
    ];

    const recentActivity = await prisma.loan.findMany({
        where: {
            ...providerFilter,
            repaymentStatus: { not: 'REVERSED' },
        },
        take: 5,
        orderBy: { disbursedDate: 'desc' },
        select: {
            id: true,
            borrowerId: true,
            loanAmount: true,
            repaymentStatus: true,
            product: {
                select: {
                    name: true,
                }
            }
        }
    }).then(loans => loans.map(l => ({
        id: l.id,
        customer: `Borrower #${l.borrowerId.substring(0,8)}...`,
        product: l.product.name,
        status: l.repaymentStatus,
        amount: l.loanAmount,
    })));

    const allProducts = await prisma.loanProduct.findMany({
        where: providerId ? { providerId: providerId } : {},
        select: {
            id: true,
            name: true,
            providerId: true,
            provider: {
                select: {
                    id: true,
                    name: true,
                }
            },
            _count: { select: { loans: true } }
        }
    });

    const productOverview = await Promise.all(allProducts.map(async p => {
        const active = await prisma.loan.count({ where: { productId: p.id, repaymentStatus: 'Unpaid' } });
        const defaulted = await prisma.loan.count({ where: { productId: p.id, repaymentStatus: 'Unpaid', dueDate: { lt: new Date() } } });
        const total = await prisma.loan.count({ where: { productId: p.id, repaymentStatus: { not: 'REVERSED' } } });
        return {
            name: p.name,
            provider: p.provider.name,
            active,
            defaulted,
            total,
            defaultRate: total > 0 ? (defaulted / total) * 100 : 0
        };
    }));

    return {
        totalLoans,
        totalDisbursed,
        dailyDisbursement: dailyDisbursementResult._sum.loanAmount || 0,
        dailyRepayments: dailyRepaymentResult._sum.amount || 0,
        repaymentRate,
        atRiskLoans,
        totalUsers: usersCount,
        loanDisbursementData,
        loanStatusData,
        recentActivity,
        productOverview,
        initialFund: totalStartingCapital,
        providerFund,
        receivables,
        collections,
        income,
    };
}

export async function getDashboardData(userId: string): Promise<{
    providers: LoanProvider[];
    overallData: DashboardData;
    providerSpecificData: Record<string, DashboardData>;
}> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            roleId: true,
            loanProviderId: true,
            role: {
                select: {
                    id: true,
                    name: true,
                }
            },
            loanProvider: {
                select: {
                    id: true,
                    name: true,
                    displayOrder: true,
                    startingCapital: true,
                    initialBalance: true,
                }
            }
        }
    });

    const isSuperAdminOrAdmin = user?.role?.name === 'Super Admin' || user?.role?.name === 'Admin';
    
    // For non-admins, get their specific provider or an empty array
    const providers = isSuperAdminOrAdmin
        ? await prisma.loanProvider.findMany({
            select: {
                id: true,
                name: true,
                displayOrder: true,
                startingCapital: true,
                initialBalance: true,
            }
        })
        : (user?.loanProvider ? [user.loanProvider] : []);

    const overallData = await getProviderData(isSuperAdminOrAdmin ? undefined : user?.loanProvider?.id);
    
    let providerSpecificData: Record<string, DashboardData> = {};

    if (isSuperAdminOrAdmin) {
         const specificDataPromises = providers.map(p => getProviderData(p.id));
         const results = await Promise.all(specificDataPromises);
         results.forEach((data, index) => {
             providerSpecificData[providers[index].id] = data;
         });
    } else if (user?.loanProvider) {
        providerSpecificData[user.loanProvider.id] = overallData;
    }


    return {
        providers: providers as LoanProvider[],
        overallData: overallData,
        providerSpecificData: providerSpecificData,
    };
}


export default async function AdminDashboard() {
    const user = await getUserFromSession();
    if (!user) {
        return <div>Not authenticated</div>;
    }
    
    const data = await getDashboardData(user.id);
    if (!data) {
        return <div>Loading dashboard...</div>;
    }
    
    return <DashboardClient dashboardData={data} />;
}
