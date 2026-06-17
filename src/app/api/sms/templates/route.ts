import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import { hasPermission } from '@/lib/permissions';
import { 
    getSmsTemplates, 
    createSmsTemplate, 
    updateSmsTemplate, 
    deleteSmsTemplate 
} from '@/actions/sms';

export async function GET() {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'read')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const templates = await getSmsTemplates();
        return NextResponse.json(templates);
    } catch (error: any) {
        console.error('[API] GET /api/sms/templates error:', error);
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
        const template = await createSmsTemplate(data);
        return NextResponse.json(template, { status: 201 });
    } catch (error: any) {
        console.error('[API] POST /api/sms/templates error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
