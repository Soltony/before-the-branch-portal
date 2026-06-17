
'use server';
/**
 * @fileOverview Implements the logic for loan repayments, including automated deductions.
 *
 * - processAutomatedRepayments - A service that finds overdue loans and attempts to deduct payment from customer accounts.
 */

import prisma from '@/lib/prisma';
import { calculateTotalRepayable } from '@/lib/loan-calculator';
import { startOfDay } from 'date-fns';
import { createAuditLog } from '@/lib/audit-log';

async function getBorrowerBalance(borrowerId: string): Promise<number> {
    const provisionedData = await prisma.provisionedData.findFirst({
        where: { borrowerId },
        orderBy: { createdAt: 'desc' },
    });

    if (provisionedData) {
        try {
            const data = JSON.parse(provisionedData.data as string);
            const balanceKey = Object.keys(data).find(k => k.toLowerCase() === 'accountbalance');
            if (balanceKey) {
                return parseFloat(data[balanceKey]) || 0;
            }
        } catch (e) {
            console.error(`Could not parse provisioned data for borrower ${borrowerId}`, e);
            return 0;
        }
    }
    return 0;
}

export async function processAutomatedRepayments(): Promise<{ success: boolean; message: string; processedCount: number }> {
    return {
        success: false,
        message: 'Automated repayments are disabled. Use manual repayment flows only.',
        processedCount: 0,
    };
}
