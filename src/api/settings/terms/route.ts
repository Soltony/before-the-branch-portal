import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

// GET the latest active T&C for a provider
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId');

    if (!providerId) {
        return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 });
    }

    try {
        const terms = await prisma.termsAndConditions.findFirst({
            where: {
                providerId: providerId,
            },
            orderBy: {
                version: 'desc',
            },
        });

        return NextResponse.json(terms);
    } catch (error) {
        console.error('Error fetching terms and conditions:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
