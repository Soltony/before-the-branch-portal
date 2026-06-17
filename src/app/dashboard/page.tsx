
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import type { LoanDetails, LoanProvider, FeeRule, PenaltyRule, Tax } from '@/lib/types';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { requireMiniAppAuthContext } from '@/lib/miniapp-auth';
import { calculateInstallmentPenalty } from '@/lib/installment-penalty';
import { getAsOfDate } from '@/lib/date-utils';
import { getPhoneNumbersForAccount } from '@/lib/account-utils';
import { ensureInstallmentRollover } from '@/lib/installment-rollover';

// Ensure dashboard always renders dynamically and bypasses cache so rollover runs
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
            ...p,
            products: p.products.map(prod => ({
                ...prod,
                serviceFee: safeJsonParse(prod.serviceFee, { type: 'percentage', value: 0 }) as FeeRule,
                dailyFee: safeJsonParse(prod.dailyFee, { type: 'percentage', value: 0 }) as FeeRule,
                penaltyRules: safeJsonParse(prod.penaltyRules, []) as PenaltyRule[],
            }))
        })) as LoanProvider[];
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getLoanHistory(borrowerId: string): Promise<LoanDetails[]> {
     try {
        if (!borrowerId) return [];
        
        // Get all phone numbers linked to this account to support phone number changes
        const allPhoneNumbersForAccount = await getPhoneNumbersForAccount(borrowerId);
        
        // First, ensure any overdue installments are rolled over (merged)
        // so dashboard sees the combined installment amounts without requiring
        // the user to open the loan detail page.
        const loans = await prisma.loan.findMany({ where: { borrowerId: { in: allPhoneNumbersForAccount } }, select: { id: true } });

        // Use centralized rollover logic: when an installment is overdue,
        // close it and merge its amount into the next installment
        for (const l of loans) {
            await ensureInstallmentRollover(prisma, l.id);
        }

        const refreshedLoans = await prisma.loan.findMany({
            where: { borrowerId: { in: allPhoneNumbersForAccount } },
            include: {
                product: { include: { provider: true } },
                payments: { orderBy: { date: 'asc' } },
                installments: { orderBy: { installmentNumber: 'asc' } }
            },
            orderBy: { disbursedDate: 'desc' }
        });

        return refreshedLoans.map(loan => ({
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
              serviceFee: safeJsonParse(loan.product.serviceFee, { type: 'percentage', value: 0 }),
              dailyFee: safeJsonParse(loan.product.dailyFee, { type: 'percentage', value: 0 }),
              penaltyRules: safeJsonParse(loan.product.penaltyRules, []),
              penaltyPerInstallment: loan.product.penaltyPerInstallment ?? false,
            },
            payments: loan.payments.map(p => ({
                id: p.id,
                amount: p.amount,
                date: p.date,
                outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
            }))
            ,
            installments: loan.installments ? loan.installments.map(i => {
                const penaltyPerInstallment = loan.product.penaltyPerInstallment ?? false;
                // If penaltyPerInstallment is OFF, use loan due date for penalty calculation
                const penaltyDueDate = penaltyPerInstallment ? i.dueDate : loan.dueDate;
                return {
                    id: i.id,
                    installmentNumber: i.installmentNumber,
                    dueDate: i.dueDate,
                    amount: i.amount,
                    paidAmount: i.paidAmount || 0,
                    paidAt: i.paidAt,
                    status: i.status,
                    penaltyAmount: calculateInstallmentPenalty({
                        dueDate: penaltyDueDate,
                        principalOutstanding: Math.max(0, (i.amount || 0) - (i.paidAmount || 0)),
                        penaltyRules: (safeJsonParse(loan.product.penaltyRules as any, []) as any) || [],
                        asOfDate: getAsOfDate(),
                    }),
                    isActive: i.isActive,
                };
            }) : []
        })) as LoanDetails[];
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getTaxConfigs(): Promise<Tax[]> {
    return await prisma.tax.findMany();
}


export default async function DashboardPage({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined }}) {
    const ctx = await requireMiniAppAuthContext().catch(() => null);
    if (!ctx) {
        redirect('/loan/connect');
    }

    const borrowerIdFromUrl = searchParams['borrowerId'] as string | undefined;
    if (!borrowerIdFromUrl || String(borrowerIdFromUrl) !== String(ctx.borrowerId)) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(searchParams || {})) {
            if (v == null) continue;
            if (Array.isArray(v)) {
                for (const vv of v) sp.append(k, String(vv));
            } else {
                sp.set(k, String(v));
            }
        }
        sp.set('borrowerId', String(ctx.borrowerId));
        redirect(`/dashboard?${sp.toString()}`);
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
