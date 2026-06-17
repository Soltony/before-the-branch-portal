
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import type { LoanDetails, LoanProvider, FeeRule, PenaltyRule, Tax } from '@/lib/types';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { requireMiniAppAuthContext } from '@/lib/miniapp-auth';
import { calculateInstallmentPenalty } from '@/lib/installment-penalty';
import { getAsOfDate } from '@/lib/date-utils';
import { ensureInstallmentRollover } from '@/lib/installment-rollover';
import { getPhoneNumbersForAccount } from '@/lib/account-utils';

// Helper function to safely parse JSON from DB
const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};

async function getProviders(): Promise<LoanProvider[]> {
    try {
        const providers = await prisma.loanProvider.findMany({
            include: {
                products: {
                    where: {
                        status: 'Active'
                    },
                    orderBy: {
                        name: 'asc'
                    }
                }
            },
            orderBy: {
                displayOrder: 'asc'
            }
        });

        return providers.map(p => ({
            id: p.id,
            name: p.name,
            icon: p.icon,
            colorHex: p.colorHex,
            displayOrder: p.displayOrder,
            nplThresholdDays: p.nplThresholdDays,
            accountNumber: p.accountNumber,
            startingCapital: p.startingCapital,
            initialBalance: p.initialBalance,
            allowCrossProviderLoans: p.allowCrossProviderLoans,
            products: p.products.map(prod => ({
                id: prod.id,
                providerId: p.id,
                name: prod.name,
                description: prod.description,
                icon: prod.icon,
                minLoan: prod.minLoan,
                maxLoan: prod.maxLoan,
                duration: prod.duration,
                serviceFee: safeJsonParse(prod.serviceFee, { type: 'percentage', value: 0 }) as FeeRule,
                dailyFee: safeJsonParse(prod.dailyFee, { type: 'percentage', value: 0 }) as FeeRule,
                penaltyRules: safeJsonParse(prod.penaltyRules, []) as PenaltyRule[],
                requiredDocuments: safeJsonParse(prod.requiredDocuments, []) as any,
                status: prod.status as 'Active' | 'Disabled',
                allowConcurrentLoans: prod.allowConcurrentLoans,
            }))
        })) as unknown as LoanProvider[];
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getLoanHistory(borrowerId: string): Promise<LoanDetails[]> {
    try {
        if (!borrowerId) return [];

        // Get all phone numbers linked to this account to support phone number changes
        // This ensures the borrower sees all their loans even after changing their phone number
        const allPhoneNumbersForAccount = await getPhoneNumbersForAccount(borrowerId);

        // Ensure overdue installments are rolled over (merged) so the borrower UI
        // reflects the combined installment amount as soon as a due date passes.
        const loanIds = await prisma.loan.findMany({
            where: { borrowerId: { in: allPhoneNumbersForAccount }, repaymentStatus: 'Unpaid' },
            select: { id: true },
        });

        // Use centralized rollover logic: when an installment is overdue,
        // close it and merge its amount into the next installment
        for (const l of loanIds) {
            await ensureInstallmentRollover(prisma, l.id);
        }

        const loans = await prisma.loan.findMany({
            where: { borrowerId: { in: allPhoneNumbersForAccount } },
            include: {
                product: {
                    include: {
                        provider: true
                    }
                },
                payments: {
                    orderBy: {
                        date: 'asc'
                    }
                },
                installments: {
                    orderBy: { installmentNumber: 'asc' }
                }
            },
            orderBy: {
                disbursedDate: 'desc'
            }
        });

        return loans.map(loan => ({
            id: loan.id,
            borrowerId: loan.borrowerId,
            providerName: loan.product.provider.name,
            productName: loan.product.name,
            loanAmount: loan.loanAmount,
            serviceFee: loan.serviceFee,
            disbursedDate: loan.disbursedDate,
            dueDate: loan.dueDate,
            repaymentStatus: loan.repaymentStatus as 'Paid' | 'Unpaid',
            repaidAmount: loan.repaidAmount || 0,
            penaltyAmount: loan.penaltyAmount,
            product: {
                ...loan.product,
                id: loan.product.id,
                providerId: loan.product.providerId,
                serviceFee: safeJsonParse(loan.product.serviceFee, { type: 'percentage', value: 0 }),
                dailyFee: safeJsonParse(loan.product.dailyFee, { type: 'percentage', value: 0, calculationBase: 'principal' }),
                penaltyRules: safeJsonParse(loan.product.penaltyRules, []),
                requiredDocuments: safeJsonParse(loan.product.requiredDocuments, []) as string[],
            },
            payments: loan.payments.map(p => ({
                id: p.id,
                amount: p.amount,
                date: p.date,
                outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
            }))
            ,
            installments: loan.installments?.map(i => ({
                id: i.id,
                installmentNumber: i.installmentNumber,
                dueDate: i.dueDate,
                amount: i.amount,
                paidAmount: i.paidAmount || 0,
                status: i.status,
                isActive: i.isActive,
                penaltyAmount: calculateInstallmentPenalty({
                    dueDate: i.dueDate,
                    principalOutstanding: Math.max(0, (i.amount || 0) - (i.paidAmount || 0)),
                    penaltyRules: (safeJsonParse(loan.product.penaltyRules, []) as any) || [],
                    asOfDate: getAsOfDate(),
                }),
            })) || []
        })) as unknown as LoanDetails[];
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getTaxConfigs(): Promise<Tax[]> {
    return await prisma.tax.findMany();
}


export default async function LoanPage({ searchParams }: { searchParams: any }) {
    const ctx = await requireMiniAppAuthContext().catch(() => null);
    if (!ctx) {
        redirect('/loan/connect');
    }

    const params = await searchParams;
    const borrowerIdFromUrl = params?.borrowerId as string | undefined;

    if (!borrowerIdFromUrl || String(borrowerIdFromUrl) !== String(ctx.borrowerId)) {
        const sp = new URLSearchParams();
        if (params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
                if (v == null) continue;
                if (Array.isArray(v)) {
                    for (const vv of v) sp.append(k, String(vv));
                } else {
                    sp.set(k, String(v));
                }
            }
        }
        sp.set('borrowerId', String(ctx.borrowerId));
        redirect(`/loan?${sp.toString()}`);
    }

    const borrowerId = String(ctx.borrowerId);
    
    // Get the asOfDate for all calculations - this allows testing by changing ASOF_DATE env var
    const asOfDate = getAsOfDate();
    
    const [providers, loanHistory, taxConfigs] = await Promise.all([
        getProviders(),
        getLoanHistory(borrowerId),
        getTaxConfigs(),
    ]);
    
    return (
        <Suspense fallback={
            <div className="flex flex-col min-h-screen bg-background items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        }>
            <DashboardClient providers={providers} initialLoanHistory={loanHistory} taxConfigs={taxConfigs} asOfDate={asOfDate} />
        </Suspense>
    );
}
