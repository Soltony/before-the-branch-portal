import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/user';
import { hasPermission } from '@/lib/permissions';
import { getSmsTemplate, updateSmsTemplate, deleteSmsTemplate } from '@/actions/sms';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'read')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const template = await getSmsTemplate(id);
        
        if (!template) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        return NextResponse.json(template);
    } catch (error: any) {
        console.error('[API] GET /api/sms/templates/[id] error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'update')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const data = await request.json();
        const template = await updateSmsTemplate(id, data);
        return NextResponse.json(template);
    } catch (error: any) {
        console.error('[API] PATCH /api/sms/templates/[id] error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromSession();
        if (!user || !hasPermission(user, 'sms-management', 'delete')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        await deleteSmsTemplate(id);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[API] DELETE /api/sms/templates/[id] error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
