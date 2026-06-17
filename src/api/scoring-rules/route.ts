import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { createAuditLog } from '@/lib/audit-log';
import { validateBody, scoringRulesSchema } from '@/lib/validators';

export async function POST(req: NextRequest) {
    if (req.method !== 'POST') {
        return new NextResponse(null, { status: 405, statusText: "Method Not Allowed" });
    }
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
        const validation = await validateBody(req, scoringRulesSchema);
        if (!validation.ok) return validation.errorResponse;
        const { providerId, parameters } = validation.data;

        // Use a transaction to delete old rules and create new ones
        const transaction = await prisma.$transaction(async (tx) => {
            // Delete all existing rules for this provider
            await tx.scoringParameter.deleteMany({ where: { providerId } });

            // Create new parameters and their rules
            const createdParameters = [];
            for (const param of parameters) {
                const newParam = await tx.scoringParameter.create({
                    data: {
                        providerId: providerId,
                        name: param.name,
                        weight: param.weight,
                        rules: {
                            create: param.rules.map((rule: any) => ({
                                field: rule.field,
                                condition: rule.condition,
                                value: String(rule.value),
                                score: rule.score,
                            })),
                        },
                    },
                    include: {
                        rules: true,
                    },
                });
                createdParameters.push(newParam);
            }
            return createdParameters;
        });

        const logDetails = {
            providerId: providerId,
            parameterCount: parameters.length,
            parameters: parameters,
        };
        await createAuditLog({
            actorId: session.userId,
            action: 'SCORING_RULES_UPDATE_SUCCESS',
            entity: 'PROVIDER',
            entityId: providerId,
            details: logDetails
        });

        return NextResponse.json(transaction, { status: 201 });
    } catch (error) {
        console.error('Error saving scoring rules:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
