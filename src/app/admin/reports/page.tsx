

import { ReportsClient } from '@/components/admin/reports-client';
import type { LoanProvider as LoanProviderType, LoanReportData, CollectionsReportData, IncomeReportData } from '@/lib/types';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import { requireServerPermission } from '@/lib/require-permission';
import { startOfToday, endOfToday, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, format } from 'date-fns';

export const dynamic = 'force-dynamic';

async function getProviders(userId: string): Promise<LoanProviderType[]> {
    const user = await getUserFromSession();

    const isSuperAdminOrRecon = user?.role === 'Super Admin' || user?.role === 'Reconciliation';

    if (isSuperAdminOrRecon) {
        return (await prisma.loanProvider.findMany({
            orderBy: { displayOrder: 'asc' }
        })) as LoanProviderType[];
    }
    
        if (user?.loanProviderId) {
        const provider = await prisma.loanProvider.findUnique({
            where: { id: user.loanProviderId }
        });
        return provider ? [provider] as LoanProviderType[] : [];
    }

        // If the user can access reports but isn't bound to a specific provider,
        // allow them to select from all providers (common for Auditor/Loan Manager/Branch).
        if (user?.role !== 'Loan Provider') {
            return (await prisma.loanProvider.findMany({
                orderBy: { displayOrder: 'asc' },
            })) as LoanProviderType[];
        }

        return [];
}


export default async function AdminReportsPage() {
    await requireServerPermission('reports');
    const user = await getUserFromSession();
     if (!user) {
        return <div>Not authenticated</div>;
    }

    const providers = await getProviders(user.id);
    
    return <ReportsClient providers={providers} />;
}
