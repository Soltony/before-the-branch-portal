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
                isActive: true,
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

// POST a new version of the T&C
export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { providerId, content } = body;

        if (!providerId || !content) {
            return NextResponse.json({ error: 'Provider ID and content are required' }, { status: 400 });
        }

        const newVersion = await prisma.$transaction(async (tx) => {
            // Deactivate all previous versions
            await tx.termsAndConditions.updateMany({
                where: { providerId: providerId },
                data: { isActive: false },
            });

            // Get the latest version number
            const latestVersion = await tx.termsAndConditions.findFirst({
                where: { providerId: providerId },
                orderBy: { version: 'desc' },
            });

            const newVersionNumber = (latestVersion?.version || 0) + 1;

            // Create the new active version
            const newTerms = await tx.termsAndConditions.create({
                data: {
                    providerId,
                    content,
                    version: newVersionNumber,
                    isActive: true,
                    publishedAt: new Date(),
                },
            });
            
            return newTerms;
        });

        return NextResponse.json(newVersion, { status: 201 });
    } catch (error) {
        console.error('Error creating new terms and conditions:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
