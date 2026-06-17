
import type { LoanDetails, LoanProvider, Tax } from '@/lib/types';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { HistoryClient } from '@/components/history/history-client';
import prisma from '@/lib/prisma';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { redirect } from 'next/navigation';
import { requireMiniAppAuthContext } from '@/lib/miniapp-auth';
import { calculateInstallmentPenalty } from '@/lib/installment-penalty';
import { getAsOfDate } from '@/lib/date-utils';
import { ensureInstallmentRollover } from '@/lib/installment-rollover';
import { getPhoneNumbersForAccount } from '@/lib/account-utils';


const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};

async function getProviders(): Promise<LoanProvider[]> {
    const providers = await prisma.loanProvider.findMany({
        orderBy: { displayOrder: 'asc' }
    });
    return providers as LoanProvider[];
}


async function getLoanHistory(borrowerId: string): Promise<LoanDetails[]> {
    try {
        if (!borrowerId) return [];

        // Get all phone numbers linked to this account to support phone number changes
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

        const [loans, taxConfigs] = await Promise.all([
            prisma.loan.findMany({
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
            }),
            prisma.tax.findMany()
        ]);

        return loans.map(loan => {
            const parsedProduct = {
                ...loan.product,
                serviceFee: safeJsonParse(loan.product.serviceFee as string, { type: 'percentage', value: 0 }),
                dailyFee: safeJsonParse(loan.product.dailyFee as string, { type: 'percentage', value: 0, calculationBase: 'principal' }),
                penaltyRules: safeJsonParse(loan.product.penaltyRules as string, []),
            };

            const { total: totalRepayable } = calculateTotalRepayable(loan as any, parsedProduct, taxConfigs, getAsOfDate());

            return {
                id: loan.id,
                providerId: loan.product.providerId,
                providerName: loan.product.provider.name,
                productName: loan.product.name,
                loanAmount: loan.loanAmount,
                serviceFee: loan.serviceFee,
                disbursedDate: loan.disbursedDate,
                dueDate: loan.dueDate,
                repaymentStatus: loan.repaymentStatus as 'Paid' | 'Unpaid',
                repaidAmount: loan.repaidAmount || 0,
                penaltyAmount: loan.penaltyAmount,
                product: parsedProduct,
                totalRepayableAmount: totalRepayable,
                payments: loan.payments.map(p => ({
                    id: p.id,
                    amount: p.amount,
                    date: p.date,
                    outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
                }))
                ,
                installments: loan.installments.map(i => ({
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
                        penaltyRules: (parsedProduct as any).penaltyRules || [],
                        asOfDate: getAsOfDate(),
                    }),
                }))
            } as LoanDetails;
        });
    } catch(e) {
        console.error(e);
        return [];
    }
}

async function getTaxConfigs(): Promise<Tax[]> {
    return await prisma.tax.findMany();
}


export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }>}) {
    const ctx = await requireMiniAppAuthContext().catch(() => null);
    if (!ctx) {
        redirect('/loan/connect');
    }

    const sp = await searchParams;
    const rawBorrowerId = sp?.borrowerId;
    const borrowerId = Array.isArray(rawBorrowerId) ? rawBorrowerId[0] : rawBorrowerId;

    if (!borrowerId || String(borrowerId) !== String(ctx.borrowerId)) {
        const params = new URLSearchParams();
        if (sp && typeof sp === 'object') {
            for (const [k, v] of Object.entries(sp)) {
                if (v == null) continue;
                if (Array.isArray(v)) {
                    for (const vv of v) params.append(k, String(vv));
                } else {
                    params.set(k, String(v));
                }
            }
        }
        params.set('borrowerId', String(ctx.borrowerId));
        redirect(`/history?${params.toString()}`);
    }

    const [loanHistory, providers, taxConfigs] = await Promise.all([
        getLoanHistory(String(ctx.borrowerId)),
        getProviders(),
        getTaxConfigs()
    ]);
    
    return (
        <Suspense fallback={
            <div className="flex flex-col min-h-screen bg-background items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        }>
            <HistoryClient initialLoanHistory={loanHistory} providers={providers} taxConfigs={taxConfigs} />
        </Suspense>
    );
}
