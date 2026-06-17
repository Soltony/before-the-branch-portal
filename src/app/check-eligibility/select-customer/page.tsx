

import { EligibilityCheckerClient } from '@/components/loan/eligibility-checker-client';
import { PrismaClient } from '@prisma/client';
import type { LoanProvider } from '@/lib/types';

const prisma = new PrismaClient();

export const dynamic = 'force-dynamic';

async function getBorrowers() {
    // 1. Find all upload IDs that are used for product eligibility filters.
    const productEligibilityUploads = await prisma.loanProduct.findMany({
        where: {
            eligibilityUploadId: {
                not: null,
            },
        },
        select: {
            eligibilityUploadId: true,
        },
    });
    
    const eligibilityUploadIds = new Set(
        productEligibilityUploads.map(p => p.eligibilityUploadId).filter((id): id is string => id !== null)
    );

    // 2. Fetch all provisioned data entries, EXCLUDING those from eligibility lists.
    const provisionedDataEntries = await prisma.provisionedData.findMany({
        where: {
            // The uploadId should NOT be in the set of eligibility upload IDs.
            // This also implicitly handles cases where uploadId is null.
            uploadId: {
                notIn: Array.from(eligibilityUploadIds),
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });


    // Group all data by borrowerId
    const borrowerDataMap = new Map<string, any>();

    for (const entry of provisionedDataEntries) {
        const data = JSON.parse(entry.data as string);
        const borrowerId = data.id || entry.borrowerId; // Use id from data if available, fallback to borrowerId

        if (!borrowerId) continue;

        if (!borrowerDataMap.has(borrowerId)) {
            borrowerDataMap.set(borrowerId, { id: borrowerId });
        }

        const existingData = borrowerDataMap.get(borrowerId);
        // Merge new data, giving precedence to newer entries (already handled by sorting)
        borrowerDataMap.set(borrowerId, { ...data, ...existingData });
    }

    return Array.from(borrowerDataMap.values());
}


async function getProviders() {
    const providers = await prisma.loanProvider.findMany();
    return providers as LoanProvider[];
}

export default async function SelectCustomerPage() {
    const borrowers = await getBorrowers();
    const providers = await getProviders();
    
    return <EligibilityCheckerClient borrowers={borrowers as any[]} providers={providers as any[]} />;
}
