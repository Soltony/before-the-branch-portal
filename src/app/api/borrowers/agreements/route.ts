
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { MiniAppAuthError, requireMiniAppAuthContext, assertBorrowerMatches } from '@/lib/miniapp-auth';

// GET checks the agreement status for a borrower and a provider
export async function GET(req: NextRequest) {
    try {
    const ctx = await requireMiniAppAuthContext();
    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId');
    const borrowerId = searchParams.get('borrowerId');

    if (!providerId || !borrowerId) {
        return NextResponse.json({ error: 'Provider ID and Borrower ID are required' }, { status: 400 });
    }

    assertBorrowerMatches(borrowerId, ctx);
        // 1. Get the current active terms for the provider
        const currentTerms = await prisma.termsAndConditions.findFirst({
            where: { providerId, isActive: true },
            orderBy: { version: 'desc' },
        });

        if (!currentTerms) {
            // If provider has no terms, no agreement is needed.
            return NextResponse.json({ terms: null, hasAgreed: true });
        }

        // 2. Check if the borrower has an agreement for these specific terms
        const agreement = await prisma.borrowerAgreement.findUnique({
            where: {
                borrowerId_termsId: {
                    borrowerId,
                    termsId: currentTerms.id,
                },
            },
        });

        return NextResponse.json({
            terms: currentTerms,
            hasAgreed: !!agreement,
        });
    } catch (error) {
        if (error instanceof MiniAppAuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('Error checking borrower agreement:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

const agreementSchema = z.object({
  borrowerId: z.string(),
  termsId: z.string(),
});


// POST records a borrower's acceptance of the terms
export async function POST(req: NextRequest) {
    try {
        const ctx = await requireMiniAppAuthContext();
        const body = await req.json();
        const { borrowerId, termsId } = agreementSchema.parse(body);

        assertBorrowerMatches(borrowerId, ctx);

        // Use upsert to avoid creating duplicate agreements
        const agreement = await prisma.borrowerAgreement.upsert({
            where: {
                borrowerId_termsId: {
                    borrowerId,
                    termsId,
                }
            },
            update: {}, // No fields to update if it exists
            create: {
                borrowerId,
                termsId,
            }
        });

        return NextResponse.json(agreement, { status: 201 });

    } catch (error) {
        if (error instanceof MiniAppAuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error creating borrower agreement:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
