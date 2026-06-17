
'use server';
/**
 * @fileOverview Repayment-related actions. Automated repayment processing
 * has been removed — only manual repayments are supported. This file
 * retains only the reminder-sending helper.
 */

import prisma from '@/lib/prisma';
import { startOfDay } from 'date-fns';
import sendSms from '@/lib/sms';

// Send due-date reminders for loans that are due today
export async function sendDueDateReminders(): Promise<{ sent: number }> {
    const today = startOfDay(new Date());
    // Find loans due today and unpaid
    const dueLoans = await prisma.loan.findMany({
        where: {
            repaymentStatus: 'Unpaid',
            dueDate: {
                gte: today,
                lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
            }
        }
    });

    let sent = 0;
    for (const loan of dueLoans) {
        try {
            const phone = loan.borrowerId; // borrowerId is phone in this app
            const msg = `Reminder: Loan ${loan.id} of amount ${loan.loanAmount} is due today (${loan.dueDate.toISOString().split('T')[0]}). Please repay to avoid penalties.`;
            const res = await sendSms(String(phone), msg);
            if (res.ok) sent++;
        } catch (e) {
            console.error('[repayment][dueReminder] failed to send sms', { loanId: loan.id, error: e });
        }
    }

    return { sent };
}
