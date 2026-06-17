
import { Suspense } from 'react';
import { UploadClient } from './client';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import type { LoanApplication, RequiredDocument } from '@/lib/types';
import { Loader2 } from 'lucide-react';

async function getApplicationDetails(applicationId: string): Promise<LoanApplication | null> {
    if (!applicationId) return null;

    const application = await prisma.loanApplication.findUnique({
        where: { id: applicationId },
        include: {
            product: {
                include: {
                    requiredDocuments: true,
                    provider: true,
                }
            },
            uploadedDocuments: true,
        }
    });
    
    // If the application doesn't exist, we can't continue.
    if (!application) {
        return null;
    }

    // Don't allow access if the loan is already fully disbursed.
    if (application.status === 'DISBURSED') {
        // You might want to redirect or show a different page, but for now, we'll treat it as not found.
        return null;
    }

    return application as LoanApplication;
}


export default async function UploadDocumentsPage({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
    const applicationId = searchParams['applicationId'] as string;
    
    if (!applicationId) {
        notFound();
    }

    const application = await getApplicationDetails(applicationId);

    if (!application) {
        notFound();
    }

    return (
        <Suspense fallback={
             <div className="flex flex-col min-h-screen bg-background items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    <h2 className="text-xl font-semibold">Loading Application...</h2>
                    <p className="text-muted-foreground">Preparing your document upload checklist.</p>
                </div>
            </div>
        }>
            <UploadClient application={application} />
        </Suspense>
    );
}
