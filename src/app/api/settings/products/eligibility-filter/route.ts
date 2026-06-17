
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

export async function DELETE(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('productId');

    if (!productId) {
        return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    try {
        const product = await prisma.loanProduct.findUnique({
            where: { id: productId }
        });

        if (!product || !product.eligibilityUploadId) {
            return NextResponse.json({ message: 'No filter to delete.' }, { status: 200 });
        }

        await prisma.$transaction(async (tx) => {
            // First, nullify the link on the product
            await tx.loanProduct.update({
                where: { id: productId },
                data: {
                    eligibilityFilter: null,
                    eligibilityUploadId: null
                }
            });

            // Remove all provisioned data linked to that upload first. 
            // When the upload is deleted, the ProvisionedData relation would otherwise
            // try to set uploadId to NULL (onDelete: SetNull). Because we added a
            // unique constraint that includes uploadId, setting uploadId to NULL
            // can produce duplicate rows (two rows with same borrowerId+configId+NULL)
            // which causes a unique-constraint failure. So delete the rows explicitly.
            await tx.provisionedData.deleteMany({ where: { uploadId: product.eligibilityUploadId! } });

            // Then, delete the now-orphaned upload record (use deleteMany to avoid P2025 if already removed)
            const deletedUploads = await tx.dataProvisioningUpload.deleteMany({ where: { id: product.eligibilityUploadId! } });
            if (deletedUploads.count === 0) {
                console.warn(`Eligibility upload ${product.eligibilityUploadId} for product ${productId} was not found (may have been already deleted).`);
            }
        });

        return NextResponse.json({ message: 'Eligibility filter and list deleted successfully.' });

    } catch (error: any) {
        console.error(`Error deleting eligibility filter for product ${productId}:`, error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
