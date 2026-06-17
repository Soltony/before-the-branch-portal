


import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';
import { createAuditLog } from '@/lib/audit-log';

// GET all tax configurations
export async function GET(req: NextRequest) {
    try {
        const user = await getUserFromSession();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // Check if user has permission to read tax
        if (!user.permissions?.['tax']?.read) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const configs = await prisma.tax.findMany({
            orderBy: {
                name: 'asc'
            }
        });

        // If user is Approver or not Super Admin, filter sensitive fields
        if (user.role === 'Approver' || user.role !== 'Super Admin') {
            const filtered = configs.map(({ id, name, rate, status }) => ({ id, name, rate, status }));
            return NextResponse.json(filtered);
        }

        return NextResponse.json(configs);

    } catch (error) {
        console.error('Error fetching tax configs:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST, PUT, and DELETE are now handled via the approvals workflow
// and are no longer needed here for direct database modification.
// Keeping the file for the GET endpoint.
