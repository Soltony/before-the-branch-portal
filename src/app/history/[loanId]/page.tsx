
import { Suspense } from 'react';
import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import type { LoanDetails, Tax } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { LoanDetailClient } from './client';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { redirect } from 'next/navigation';
import { requireMiniAppAuthContext } from '@/lib/miniapp-auth';
import { getAsOfDate } from '@/lib/date-utils';
import { startOfDay } from 'date-fns';
import { getPhoneNumbersForAccount } from '@/lib/account-utils';

export const dynamic = 'force-dynamic';

const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};

async function getLoanDetails(loanId: string, borrowerId: string): Promise<LoanDetails | null> {
    try {
        if (!loanId) return null;

        // Get all phone numbers linked to this account to support phone number changes
        const allPhoneNumbersForAccount = await getPhoneNumbersForAccount(borrowerId);

        const [loan, taxConfigs] = await Promise.all([
            prisma.loan.findFirst({
                where: { id: loanId, borrowerId: { in: allPhoneNumbersForAccount } },
                include: {
                    product: {
                        include: {
                            provider: true
                        }
                    },
                    payments: {
                        orderBy: {
                            date: 'desc'
                        }
                    }
                }
            }),
            prisma.tax.findMany()
        ]);
        

        if (!loan) return null;
        
        const parsedProduct = {
            ...loan.product,
            serviceFee: safeJsonParse(loan.product.serviceFee, { type: 'percentage', value: 0 }),
            dailyFee: safeJsonParse(loan.product.dailyFee, { type: 'percentage', value: 0, calculationBase: 'principal' }),
            penaltyRules: safeJsonParse(loan.product.penaltyRules, []),
        };

        // Determine the as-of date for calculation.
        // If the loan is paid, we use the date of the last payment to avoid showing 
        // post-payment fees/penalties.
        let asOfDate = getAsOfDate();
        if (loan.repaymentStatus === 'Paid' && loan.payments.length > 0) {
            // loan.payments is ordered by date desc
            asOfDate = startOfDay(new Date(loan.payments[0].date));
        }

        // Here we perform the calculation on the server side
        const calculated = calculateTotalRepayable(loan as any, parsedProduct, taxConfigs, asOfDate, true);

        return {
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
            product: parsedProduct,
            payments: loan.payments.map(p => ({
                id: p.id,
                amount: p.amount,
                date: p.date,
                outstandingBalanceBeforePayment: p.outstandingBalanceBeforePayment,
            })),
            // Pass the calculated values to the client
            calculatedRepayment: calculated
        } as unknown as LoanDetails;

    } catch(e) {
        console.error(e);
        return null;
    }
}


export default async function LoanDetailPage({ params }: { params: Promise<{ loanId: string }> }) {
    const ctx = await requireMiniAppAuthContext().catch(() => null);
    if (!ctx) {
        redirect('/loan/connect');
    }

    const p = await params;
    const loanId = p?.loanId;
    const loanDetails = await getLoanDetails(loanId, String(ctx.borrowerId));

    if (!loanDetails) {
        notFound();
    }
    
    return (
        <Suspense fallback={
             <div className="flex flex-col min-h-screen bg-background items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    <h2 className="text-xl font-semibold">Loading Loan Details...</h2>
                </div>
            </div>
        }>
            <LoanDetailClient loanDetails={loanDetails} />
        </Suspense>
    );
}
