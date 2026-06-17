import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';
import { hasPermission } from '@/lib/permissions';
import { 
    getSmsCampaigns, 
    createSmsCampaign, 
    previewCampaignRecipients 
} from '@/actions/sms';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'read')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') as any;

        const campaigns = await getSmsCampaigns(status);
        return NextResponse.json(campaigns);
    } catch (error: any) {
        console.error('[API] GET /api/sms/campaigns error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'create')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const data = await request.json();
        const campaign = await createSmsCampaign(data);
        return NextResponse.json(campaign, { status: 201 });
    } catch (error: any) {
        console.error('[API] POST /api/sms/campaigns error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
