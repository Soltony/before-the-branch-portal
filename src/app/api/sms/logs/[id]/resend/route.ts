import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';
import { hasPermission } from '@/lib/permissions';
import { resendFailedSms } from '@/actions/sms';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'update')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const result = await resendFailedSms(id);
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[API] POST /api/sms/logs/[id]/resend error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
