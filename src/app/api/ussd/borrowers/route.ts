
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { toCamelCase } from '@/lib/utils';


// Function to normalize a phone number by removing the leading '0' if it's an Ethiopian number format
const normalizePhoneNumber = (phone: string): string => {
    if (typeof phone !== 'string') return '';
    const trimmedPhone = phone.trim();
    if (trimmedPhone.startsWith('0') && trimmedPhone.length === 10) {
        return trimmedPhone.substring(1);
    }
    if (trimmedPhone.startsWith('+251') && trimmedPhone.length === 13) {
        return trimmedPhone.substring(4);
    }
    return trimmedPhone;
};


// Helper to get the most complete borrower data from provisioned sources
async function getBorrowerDataByPhoneNumber(phoneNumber: string): Promise<Record<string, any> | null> {
    const normalizedTargetPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedTargetPhone) return null;
    
    // 1. Check if there's a User with this phone number (e.g., an admin who might also be a borrower)
    const user = await prisma.user.findFirst({
        where: { phoneNumber: phoneNumber }
    });
    // This is a loose match; we need to find the actual provisioned data
    if (user) {
        // This is not enough, we need to find their provisioned data. We will proceed to check provisioned data.
    }

    // Since we don't know which data type contains the phone number, we have to search all of them.
    // This is inefficient but necessary with the current data model.
    // A better model would have a dedicated `borrower_contacts` table.
    const provisionedDataEntries = await prisma.provisionedData.findMany({
        orderBy: { createdAt: 'desc' },
    });

    for (const entry of provisionedDataEntries) {
        try {
            const data = JSON.parse(entry.data as string);
            const standardizedData: Record<string, any> = {};
            for (const key in data) {
                standardizedData[toCamelCase(key)] = data[key];
            }
            
            // Check for any field that looks like a phone number and match it
            const phoneKey = Object.keys(standardizedData).find(k => k.toLowerCase().includes('phone'));
            
            if (phoneKey && standardizedData[phoneKey]) {
                 const normalizedDbPhone = normalizePhoneNumber(String(standardizedData[phoneKey]));
                 if (normalizedDbPhone === normalizedTargetPhone) {
                     // Found a match. Now get all data for this borrower.
                     const allDataForBorrower = await prisma.provisionedData.findMany({
                         where: { borrowerId: entry.borrowerId },
                         orderBy: { createdAt: 'desc' },
                     });

                     const combinedData: Record<string, any> = { id: entry.borrowerId };
                     for (const b_entry of allDataForBorrower) {
                          const b_data = JSON.parse(b_entry.data as string);
                           const b_standardizedData: Record<string, any> = {};
                           for (const key in b_data) {
                               b_standardizedData[toCamelCase(key)] = b_data[key];
                           }
                           Object.assign(combinedData, b_standardizedData);
                     }
                    return combinedData;
                }
            }

        } catch (e) {
            console.error(`Failed to parse provisioned data for entry ${entry.id}:`, e);
        }
    }

    return null;
}


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const phoneNumber = searchParams.get('phoneNumber');

  if (!phoneNumber) {
    return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 });
  }

  try {
    const borrowerData = await getBorrowerDataByPhoneNumber(phoneNumber);

    if (!borrowerData) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    return NextResponse.json(borrowerData);

  } catch (error) {
    console.error('Failed to retrieve borrower:', error);
    return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
  }
}
