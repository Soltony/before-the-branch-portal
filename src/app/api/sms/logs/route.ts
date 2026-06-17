import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';
import { hasPermission } from '@/lib/permissions';
import { getSmsLogs, getSmsStats, resendFailedSmsBulk } from '@/actions/sms';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'read')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') as any;
        const campaignId = searchParams.get('campaignId') || undefined;
        const productId = searchParams.get('productId') || undefined;
        const search = searchParams.get('search') || undefined;
        const page = parseInt(searchParams.get('page') || '1');
        const pageSize = parseInt(searchParams.get('pageSize') || '50');

        const result = await getSmsLogs({
            status,
            campaignId,
            productId,
            search,
            page,
            pageSize,
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[API] GET /api/sms/logs error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'update')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { action, smsLogIds } = await request.json();

        if (action === 'resend-bulk' && Array.isArray(smsLogIds)) {
            const result = await resendFailedSmsBulk(smsLogIds);
            return NextResponse.json(result);
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('[API] POST /api/sms/logs error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
