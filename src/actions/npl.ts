
'use server';
/**
 * @fileOverview Implements logic to identify and flag Non-Performing Loans (NPL).
 *
 * - updateNplStatus: A service to find loans overdue by a certain threshold and flag the borrower as NPL.
 */

import prisma from '@/lib/prisma';
import { subDays } from 'date-fns';
import sendSms from '@/lib/sms';
import { getUserFromSession } from '@/lib/user';

async function updateNplStatusInternal(): Promise<{ success: boolean; message: string; updatedCount: number }> {
    // NPL status update started (log removed to reduce console noise)
    
    // Get all providers and their NPL thresholds
    const providers = await prisma.loanProvider.findMany({
        select: {
            id: true,
            nplThresholdDays: true,
            products: {
                select: {
                    id: true
                }
            }
        }
    });

    if (providers.length === 0) {
        return { success: true, message: 'No providers to process.', updatedCount: 0 };
    }

    let totalUpdatedCount = 0;
    
    for (const provider of providers) {
        const nplThresholdDate = subDays(new Date(), provider.nplThresholdDays);
        const productIds = provider.products.map(p => p.id);

        if (productIds.length === 0) continue;

        // Find all unpaid loans for this provider where the due date has passed the NPL threshold
        const overdueLoans = await prisma.loan.findMany({
            where: {
                productId: { in: productIds },
                repaymentStatus: 'Unpaid',
                disbursedDate: {
                    lt: nplThresholdDate,
                },
            },
            select: {
                borrowerId: true,
            },
        });

        if (overdueLoans.length === 0) {
            continue; // No NPL loans for this provider
        }
        
        const borrowerIdsToFlag = [...new Set(overdueLoans.map(loan => loan.borrowerId))];
        
        try {
            // Find borrowers to flag (exclude those already NPL)
            const borrowersToFlag = await prisma.borrower.findMany({ where: { id: { in: borrowerIdsToFlag }, status: { not: 'NPL' } }, select: { id: true } });
            if (borrowersToFlag.length === 0) continue;

            const idsToUpdate = borrowersToFlag.map(b => b.id);
            const { count } = await prisma.borrower.updateMany({ where: { id: { in: idsToUpdate } }, data: { status: 'NPL' } });
            totalUpdatedCount += count;

            // Send SMS notification to each borrower updated
            for (const b of borrowersToFlag) {
                (async () => {
                    try {
                        const phone = b.id; // borrowerId stored as id
                        const msg = `Your loan account has been flagged as Non-Performing Loan (NPL). Please contact support to regularize your account.`;
                        const smsRes = await sendSms(String(phone), msg);
                        if (!smsRes.ok) console.warn('[npl] sms send failed', smsRes);
                    } catch (e) {
                        console.error('[npl] sms notify error', e);
                    }
                })();
            }

        } catch (error) {
            console.error(`Failed to update NPL statuses for provider ${provider.id}:`, error);
            // We continue to the next provider even if one fails
        }
    }

    // NPL status update finished (log removed to reduce console noise)
    return { success: true, message: `Successfully updated a total of ${totalUpdatedCount} borrowers to NPL status.`, updatedCount: totalUpdatedCount };
}

// For scheduled/background execution (no user session)
export async function updateNplStatusJob(): Promise<{ success: boolean; message: string; updatedCount: number }> {
    return updateNplStatusInternal();
}

export async function updateNplStatus(): Promise<{ success: boolean; message: string; updatedCount: number }> {
    const user = await getUserFromSession({ allowRefresh: false });
    if (!user?.id) {
        return { success: false, message: 'Not authenticated', updatedCount: 0 };
    }
    const allowed = !!user.permissions?.['npl']?.update;
    if (!allowed) {
        return { success: false, message: 'Not authorized', updatedCount: 0 };
    }

    return updateNplStatusInternal();
}
