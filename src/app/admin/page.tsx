
import { DashboardClient } from '@/components/admin/dashboard-client';
import { getUserFromSession } from '@/lib/user';
import { getDashboardData } from './dashboard/page';
import { redirect } from 'next/navigation';
import { allMenuItems } from '@/lib/menu-items';

export const dynamic = 'force-dynamic';

export default async function AdminRootPage() {
    const user = await getUserFromSession();
    if (!user) {
        // This should be handled by middleware, but as a fallback
        return redirect('/admin/login');
    }

    const hasDashboardAccess = user.permissions['dashboard']?.read;

    // If user does not have dashboard access, redirect to the first page they DO have access to.
    if (!hasDashboardAccess) {
        const firstAllowedPage = allMenuItems.find(item => {
            const moduleName = item.label.toLowerCase().replace(/\s+/g, '-');
            // Ensure permissions object and module entry exist before checking .read
            return user.permissions && user.permissions[moduleName]?.read;
        });

        if (firstAllowedPage) {
            return redirect(firstAllowedPage.path);
        }

        // Fallback if they have no read permissions at all
        return (
            <div className="flex-1 space-y-4 p-8 pt-6">
                 <h2 className="text-3xl font-bold tracking-tight">Access Denied</h2>
                 <p className="text-muted-foreground">You do not have permission to view any pages.</p>
            </div>
        );
    }
    
    // Original logic for users who have dashboard access
    const data = await getDashboardData(user.id);

    if (!data || !data.overallData) {
        return <div>Loading dashboard...</div>;
    }
    
    return <DashboardClient dashboardData={data} />;
}
