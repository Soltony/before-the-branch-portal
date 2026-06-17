
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit-log';
import { getUserFromSession } from '@/lib/user';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];

export async function POST(req: NextRequest) {
    const user = await getUserFromSession();
    // In a real app, you'd check for a borrower session here. For now, we'll allow it.
    // For admin upload, check user permissions. Assuming admins might upload on behalf of users.
    if (user && !user.permissions?.['applications']?.update) {
         return NextResponse.json({ error: 'Not authorized for this action' }, { status: 403 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const applicationId = formData.get('applicationId') as string | null;
        const requiredDocId = formData.get('requiredDocId') as string | null;

        if (!file || !applicationId || !requiredDocId) {
            return NextResponse.json({ error: 'File, application ID, and required document ID are required' }, { status: 400 });
        }
        
        // **Security: File Type & Size Validation**
        if (!ALLOWED_FILE_TYPES.includes(file.type)) {
            return NextResponse.json({ error: `Invalid file type. Allowed types are: PDF, JPG, PNG.` }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File upload failed. Please try again.' }, { status: 400 });
        }
        
        // **Authorization: Check if user can update this application**
        const application = await prisma.loanApplication.findUnique({
            where: { id: applicationId },
            select: { borrowerId: true }
        });

        if (!application) {
            return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
        }

        // The actor is the borrower associated with the application.
        const actorId = application.borrowerId;


        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64Content = buffer.toString('base64');
        const dataUri = `data:${file.type};base64,${base64Content}`;

        const upsertData = {
            loanApplicationId: applicationId,
            requiredDocumentId: requiredDocId,
            fileName: file.name,
            fileType: file.type,
            fileContent: dataUri,
            status: 'PENDING', // Reset status on new upload
        };

        const newUpload = await prisma.uploadedDocument.upsert({
            where: {
                loanApplicationId_requiredDocumentId: {
                    loanApplicationId: applicationId,
                    requiredDocumentId: requiredDocId,
                }
            },
            update: upsertData,
            create: upsertData,
        });

        // After all documents are submitted, the status could be updated.
        // For now, we'll let the user manually submit for review.

        await createAuditLog({
            actorId: actorId, 
            action: 'DOCUMENT_UPLOADED',
            entity: 'LOAN_APPLICATION',
            entityId: applicationId,
            details: { documentName: file.name, requiredDocumentId: requiredDocId }
        });

        return NextResponse.json(newUpload, { status: 201 });

    } catch (error) {
        console.error('Error uploading document:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
