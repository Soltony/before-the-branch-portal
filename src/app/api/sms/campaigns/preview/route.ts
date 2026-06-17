import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';
import { hasPermission } from '@/lib/permissions';
import { previewCampaignRecipients } from '@/actions/sms';

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'read')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const criteria = await request.json();
        const preview = await previewCampaignRecipients(criteria);
        return NextResponse.json(preview);
    } catch (error: any) {
        console.error('[API] POST /api/sms/campaigns/preview error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
