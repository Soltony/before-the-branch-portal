import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';
import { hasPermission } from '@/lib/permissions';
import { getSmsStats } from '@/actions/sms';

export async function GET() {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'read')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const stats = await getSmsStats();
        return NextResponse.json(stats);
    } catch (error: any) {
        console.error('[API] GET /api/sms/stats error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
