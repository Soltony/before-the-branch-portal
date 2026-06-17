
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { z } from 'zod';

const tierSchema = z.object({
  id: z.string().optional(),
  fromScore: z.number(),
  toScore: z.number(),
  loanAmount: z.number(),
});

const saveTiersSchema = z.object({
  productId: z.string(),
  tiers: z.array(tierSchema),
});

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { productId, tiers } = saveTiersSchema.parse(body);

        // Use a transaction to delete old tiers and create new ones
        const savedTiers = await prisma.$transaction(async (tx) => {
            // Delete all existing tiers for this product
            await tx.loanAmountTier.deleteMany({ where: { productId } });

            // Create new tiers
            if (tiers.length > 0) {
                await tx.loanAmountTier.createMany({
                    data: tiers.map(tier => ({
                        productId,
                        fromScore: tier.fromScore,
                        toScore: tier.toScore,
                        loanAmount: tier.loanAmount,
                    })),
                });
            }

            // Return the newly created tiers
            return await tx.loanAmountTier.findMany({ where: { productId } });
        });

        return NextResponse.json(savedTiers, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error saving loan amount tiers:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
