
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { startOfDay, isBefore, isEqual } from 'date-fns';
import type { RepaymentBehavior } from '@prisma/client';
import { createAuditLog } from '@/lib/audit-log';
import { getAsOfDate } from '@/lib/date-utils';

const paymentSchema = z.object({
  loanId: z.string(),
  amount: z.number().positive(),
});

export async function POST(req: NextRequest) {
    let paymentDetailsForLogging: any = {};
    let borrowerIdForLogging: string | null = null;
    try {
        const body = await req.json();
        const { loanId, amount: paymentAmount } = paymentSchema.parse(body);
        paymentDetailsForLogging = { loanId, amount: paymentAmount };
        
        const loanForBorrowerId = await prisma.loan.findUnique({ where: { id: loanId }, select: { borrowerId: true }});
        borrowerIdForLogging = loanForBorrowerId?.borrowerId || null;

        await createAuditLog({ actorId: borrowerIdForLogging || 'unknown', action: 'REPAYMENT_INITIATED', entity: 'LOAN', entityId: loanId, details: paymentDetailsForLogging });

        const [loan, taxConfigs] = await Promise.all([
            prisma.loan.findUnique({
                where: { id: loanId },
                include: { 
                    product: {
                        include: {
                            provider: {
                                include: {
                                    ledgerAccounts: true
                                }
                            }
                        }
                    }
                }
            }),
            prisma.tax.findMany({ where: { status: 'ACTIVE' } })
        ]);


        if (!loan) {
            throw new Error('Loan not found');
        }
        
        const provider = loan.product.provider;
        // Use getAsOfDate() for calculations to match UI display during testing
        const paymentDate = getAsOfDate();
        
        const { total, principal, interest, penalty, serviceFee, tax } = calculateTotalRepayable(
            loan as any,
            loan.product as any,
            (taxConfigs ?? []) as any,
            paymentDate
        );
        const alreadyRepaid = loan.repaidAmount || 0;
        
        const totalDue = total - alreadyRepaid;

        const alreadyPaidPenalty = Math.min(penalty, alreadyRepaid);
        const alreadyPaidServiceFee = Math.min(serviceFee, Math.max(0, alreadyRepaid - penalty));
        const alreadyPaidInterest = Math.min(interest, Math.max(0, alreadyRepaid - penalty - serviceFee));
        const alreadyPaidTax = Math.min(tax, Math.max(0, alreadyRepaid - penalty - serviceFee - interest));
        const alreadyPaidPrincipal = Math.min(principal, Math.max(0, alreadyRepaid - penalty - serviceFee - interest - tax));

        const penaltyDue = Math.max(0, penalty - alreadyPaidPenalty);
        const serviceFeeDue = Math.max(0, serviceFee - alreadyPaidServiceFee);
        const interestDue = Math.max(0, interest - alreadyPaidInterest);
        const taxDue = Math.max(0, tax - alreadyPaidTax);
        const principalDue = Math.max(0, principal - alreadyPaidPrincipal);


        if (paymentAmount > totalDue + 0.01) { // Add tolerance for floating point
             throw new Error('Payment amount exceeds balance due.');
        }
        
        const updatedLoan = await prisma.$transaction(async (tx) => {
            let amountToApply = paymentAmount;
            
            // Ledger Accounts
            const principalReceivable = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Receivable');
            const interestReceivable = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Receivable');
            const penaltyReceivable = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Receivable');
            const serviceFeeReceivable = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Receivable');
            const taxReceivable = provider.ledgerAccounts.find(a => a.category === 'Tax' && a.type === 'Receivable');

            const principalReceived = provider.ledgerAccounts.find(a => a.category === 'Principal' && a.type === 'Received');
            const interestReceived = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Received');
            const penaltyReceived = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Received');
            const serviceFeeReceived = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Received');
            const taxReceived = provider.ledgerAccounts.find(a => a.category === 'Tax' && a.type === 'Received');

            const interestIncome = provider.ledgerAccounts.find(a => a.category === 'Interest' && a.type === 'Income');
            const penaltyIncome = provider.ledgerAccounts.find(a => a.category === 'Penalty' && a.type === 'Income');
            const serviceFeeIncome = provider.ledgerAccounts.find(a => a.category === 'ServiceFee' && a.type === 'Income');
            
            
            if (!principalReceivable || !interestReceivable || !penaltyReceivable || !serviceFeeReceivable || !taxReceivable ||
                !principalReceived || !interestReceived || !penaltyReceived || !serviceFeeReceived || !taxReceived) {
                throw new Error(`One or more ledger accounts not found for provider ${provider.id}`);
            }

            const journalEntry = await tx.journalEntry.create({
                data: {
                    providerId: provider.id,
                    loanId: loan.id,
                    date: paymentDate,
                    description: `Repayment of ${paymentAmount} for loan ${loan.id}`
                }
            });

            // Apply payment according to priority: Penalty -> Service Fee -> Interest -> Tax -> Principal
            const penaltyToPay = Math.min(amountToApply, penaltyDue);
            if (penaltyToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: penaltyReceivable.id }, data: { balance: { decrement: penaltyToPay } } });
                await tx.ledgerAccount.update({ where: { id: penaltyReceived.id }, data: { balance: { increment: penaltyToPay } } });
                if (!penaltyIncome) throw new Error(`Penalty Income ledger account not found for provider ${provider.id}`);
                await tx.ledgerAccount.update({ where: { id: penaltyIncome.id }, data: { balance: { increment: penaltyToPay } } });
                await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceivable.id, type: 'Credit', amount: penaltyToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: penaltyReceived.id, type: 'Debit', amount: penaltyToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: penaltyIncome.id, type: 'Credit', amount: penaltyToPay }
                ]});
                amountToApply -= penaltyToPay;
            }

            const serviceFeeToPay = Math.min(amountToApply, serviceFeeDue);
            if (serviceFeeToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: serviceFeeReceivable.id }, data: { balance: { decrement: serviceFeeToPay } } });
                await tx.ledgerAccount.update({ where: { id: serviceFeeReceived.id }, data: { balance: { increment: serviceFeeToPay } } });
                if (!serviceFeeIncome) throw new Error(`Service Fee Income ledger account not found for provider ${provider.id}`);
                await tx.ledgerAccount.update({ where: { id: serviceFeeIncome.id }, data: { balance: { increment: serviceFeeToPay } } });
                await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceivable.id, type: 'Credit', amount: serviceFeeToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeReceived.id, type: 'Debit', amount: serviceFeeToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: serviceFeeIncome.id, type: 'Credit', amount: serviceFeeToPay }
                ]});
                amountToApply -= serviceFeeToPay;
            }

            const interestToPay = Math.min(amountToApply, interestDue);
             if (interestToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: interestReceivable.id }, data: { balance: { decrement: interestToPay } } });
                await tx.ledgerAccount.update({ where: { id: interestReceived.id }, data: { balance: { increment: interestToPay } } });
                if (!interestIncome) throw new Error(`Interest Income ledger account not found for provider ${provider.id}`);
                await tx.ledgerAccount.update({ where: { id: interestIncome.id }, data: { balance: { increment: interestToPay } } });
                await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: interestReceivable.id, type: 'Credit', amount: interestToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: interestReceived.id, type: 'Debit', amount: interestToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: interestIncome.id, type: 'Credit', amount: interestToPay }
                ]});
                amountToApply -= interestToPay;
            }

            const taxToPay = Math.min(amountToApply, taxDue);
            if (taxToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: taxReceivable.id }, data: { balance: { decrement: taxToPay } } });
                await tx.ledgerAccount.update({ where: { id: taxReceived.id }, data: { balance: { increment: taxToPay } } });
                 await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: taxReceivable.id, type: 'Credit', amount: taxToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: taxReceived.id, type: 'Debit', amount: taxToPay }
                ]});
                amountToApply -= taxToPay;
            }
            
            const principalToPay = Math.min(amountToApply, principalDue);
             if (principalToPay > 0) {
                await tx.ledgerAccount.update({ where: { id: principalReceivable.id }, data: { balance: { decrement: principalToPay } } });
                await tx.ledgerAccount.update({ where: { id: principalReceived.id }, data: { balance: { increment: principalToPay } } });
                 await tx.ledgerEntry.createMany({ data: [
                    { journalEntryId: journalEntry.id, ledgerAccountId: principalReceivable.id, type: 'Credit', amount: principalToPay },
                    { journalEntryId: journalEntry.id, ledgerAccountId: principalReceived.id, type: 'Debit', amount: principalToPay }
                ]});
            }

            // Create payment record
            const newPayment = await tx.payment.create({
                data: {
                    loanId,
                    amount: paymentAmount,
                    date: paymentDate,
                    outstandingBalanceBeforePayment: totalDue,
                    journalEntryId: journalEntry.id,
                }
            });

            const newRepaidAmount = alreadyRepaid + paymentAmount;
            const isFullyPaid = newRepaidAmount >= total;
            let repaymentBehavior: RepaymentBehavior | null = null;
            
            // --- NEW: Set Repayment Behavior on final payment ---
            if (isFullyPaid) {
                const today = startOfDay(new Date());
                const dueDate = startOfDay(loan.dueDate);
                if (isBefore(today, dueDate)) {
                    repaymentBehavior = 'EARLY';
                } else if (isEqual(today, dueDate)) {
                    repaymentBehavior = 'ON_TIME';
                } else {
                    repaymentBehavior = 'LATE';
                }
            }
            // --- END NEW ---

            // Update loan status
            const finalLoan = await tx.loan.update({
                where: { id: loanId },
                data: {
                    repaidAmount: newRepaidAmount,
                    repaymentStatus: isFullyPaid ? 'Paid' : 'Unpaid',
                    ...(repaymentBehavior && { repaymentBehavior: repaymentBehavior }), // Only set if not null
                },
                include: {
                    payments: { orderBy: { date: 'asc' } },
                    product: true,
                }
            });
            
             const logDetails = {
                loanId: loan.id,
                paymentId: newPayment.id,
                amount: paymentAmount,
                repaymentStatus: finalLoan.repaymentStatus,
             };
             await createAuditLog({ actorId: loan.borrowerId, action: 'REPAYMENT_SUCCESS', entity: 'LOAN', entityId: loan.id, details: logDetails });
            
            return finalLoan;
        });

        return NextResponse.json(updatedLoan, { status: 200 });

    } catch (error: any) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = {
            ...paymentDetailsForLogging,
            error: errorMessage,
        };
        await createAuditLog({ actorId: borrowerIdForLogging || 'unknown', action: 'REPAYMENT_FAILED', entity: 'LOAN', entityId: paymentDetailsForLogging.loanId, details: failureLogDetails });
        console.error(JSON.stringify({ ...failureLogDetails, action: 'REPAYMENT_FAILED' }));

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
