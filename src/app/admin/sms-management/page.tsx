import { SmsManagementClient } from '@/components/admin/sms-management-client';
import { requireServerPermission } from '@/lib/require-permission';
import prisma from '@/lib/prisma';
import type { LoanProvider } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getProviders(): Promise<{ id: string; name: string; products: { id: string; name: string }[] }[]> {
    const providers = await prisma.loanProvider.findMany({
        select: {
            id: true,
            name: true,
            products: {
                select: {
                    id: true,
                    name: true,
                },
                where: { status: 'Active' },
                orderBy: { name: 'asc' },
            },
        },
        orderBy: { displayOrder: 'asc' },
    });
    return providers;
}

export default async function SmsManagementPage() {
    await requireServerPermission('sms-management');

    const providers = await getProviders();

    return <SmsManagementClient providers={providers} />;
}
