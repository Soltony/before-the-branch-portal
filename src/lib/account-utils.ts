'use server';

import prisma from '@/lib/prisma';

/**
 * Retrieves all phone numbers linked to the same account number as the given phone number.
 * This prevents users from circumventing loan restrictions by changing their phone number.
 * 
 * Useful after phone number changes to ensure all associated data is found:
 * - Loan history
 * - Credit history
 * - Account metrics
 * - Payments
 * 
 * @param phoneNumber - The borrower's phone number
 * @returns Array of all phone numbers associated with the same account
 */
export async function getPhoneNumbersForAccount(phoneNumber: string): Promise<string[]> {
    try {
        // Find all account numbers associated with this phone number
        const phoneAccountsForBorrower = await prisma.phoneAccount.findMany({
            where: { phoneNumber },
            select: { accountNumber: true },
            distinct: ['accountNumber'],
        });

        if (phoneAccountsForBorrower.length === 0) {
            // No account association found, return just the phone number
            return [phoneNumber];
        }

        const accountNumbers = phoneAccountsForBorrower.map(pa => pa.accountNumber);

        // Find all phone numbers linked to any of these accounts
        const allPhoneAccounts = await prisma.phoneAccount.findMany({
            where: {
                accountNumber: { in: accountNumbers },
            },
            select: { phoneNumber: true },
            distinct: ['phoneNumber'],
        });

        const phoneNumbers = allPhoneAccounts.map(pa => pa.phoneNumber);
        return phoneNumbers.length > 0 ? phoneNumbers : [phoneNumber];
    } catch (error) {
        console.error('Error retrieving phone numbers for account:', error);
        // Fallback to just the provided phone number if something goes wrong
        return [phoneNumber];
    }
}

/**
 * Gets the active account number for a given phone number.
 * Returns the primary account associated with this phone.
 * 
 * @param phoneNumber - The borrower's phone number
 * @returns The active account number or null if not found
 */
export async function getActiveAccountNumber(phoneNumber: string): Promise<string | null> {
    try {
        const activeAccount = await prisma.phoneAccount.findFirst({
            where: { phoneNumber, isActive: true },
            select: { accountNumber: true },
        });
        return activeAccount?.accountNumber || null;
    } catch (error) {
        console.error('Error retrieving active account number:', error);
        return null;
    }
}
