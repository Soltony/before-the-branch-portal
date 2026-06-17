
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { z } from 'zod';

const updateBorrowerStatusSchema = z.object({
  borrowerId: z.string(),
  status: z.string(),
});

export async function PUT(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { borrowerId, status } = updateBorrowerStatusSchema.parse(body);

        const updatedBorrower = await prisma.borrower.update({
            where: { id: borrowerId },
            data: { status },
        });

        return NextResponse.json(updatedBorrower);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error updating borrower status:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
