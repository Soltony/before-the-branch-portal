
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit-log';

const submitSchema = z.object({
  applicationId: z.string(),
});

export async function POST(req: NextRequest) {
    
    try {
        const body = await req.json();
        const { applicationId } = submitSchema.parse(body);

        const application = await prisma.loanApplication.findUnique({
            where: { id: applicationId },
            include: { product: { include: { requiredDocuments: true } } }
        });

        if (!application) {
            return NextResponse.json({ error: 'Application not found' }, { status: 404 });
        }
        
        // Verify all documents are uploaded
        const uploadedDocIds = new Set(
            (await prisma.uploadedDocument.findMany({
                where: { loanApplicationId: applicationId },
                select: { requiredDocumentId: true }
            })).map(d => d.requiredDocumentId)
        );
        
        const requiredDocIds = new Set(application.product.requiredDocuments.map(d => d.id));

        const missingDocs = [...requiredDocIds].filter(id => !uploadedDocIds.has(id));

        if (missingDocs.length > 0) {
            return NextResponse.json({ error: 'Not all required documents have been uploaded.' }, { status: 400 });
        }

        const updatedApplication = await prisma.loanApplication.update({
            where: { id: applicationId },
            data: {
                status: 'PENDING_REVIEW'
            }
        });
        
        await createAuditLog({
            actorId: application.borrowerId,
            action: 'APPLICATION_SUBMITTED_FOR_REVIEW',
            entity: 'LOAN_APPLICATION',
            entityId: applicationId,
        });

        return NextResponse.json(updatedApplication);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error submitting application:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

    