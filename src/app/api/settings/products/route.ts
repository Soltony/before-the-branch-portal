import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { createProductSchema, updateProductSchema } from '@/lib/schemas';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit-log';


// POST a new product - This route is no longer used for direct creation.
// All creations go through the pending changes API.
// This is kept for potential future direct admin actions but should not be used in the maker-checker flow.
export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';

    try {
        const body = await req.json();
        const { providerId, ...productData } = createProductSchema.parse(body);

        const logDetails = { productName: productData.name, providerId: providerId };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_CREATE_INITIATED', entity: 'PRODUCT', details: logDetails, ipAddress, userAgent });

        const newProduct = await prisma.loanProduct.create({
            data: {
                providerId: providerId,
                name: productData.name,
                description: productData.description || '',
                icon: productData.icon,
                minLoan: productData.minLoan,
                maxLoan: productData.maxLoan,
                duration: productData.duration,
                status: 'Disabled',
                // Default fee structures
                serviceFee: JSON.stringify({ type: 'percentage', value: 0 }),
                dailyFee: JSON.stringify({ type: 'percentage', value: 0 }),
                penaltyRules: JSON.stringify([]),
                serviceFeeEnabled: false,
                dailyFeeEnabled: false,
                penaltyRulesEnabled: false,
                dataProvisioningEnabled: false,
            }
        });
        
        const successLogDetails = { productId: newProduct.id, productName: newProduct.name, providerId: newProduct.providerId };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_CREATE_SUCCESS', entity: 'PRODUCT', entityId: newProduct.id, details: successLogDetails, ipAddress, userAgent });

        return NextResponse.json(newProduct, { status: 201 });

    } catch (error) {
        const errorMessage = (error instanceof z.ZodError) ? error.errors : (error as Error).message;
        const failureLogDetails = { error: errorMessage };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_CREATE_FAILED', entity: 'PRODUCT', details: failureLogDetails, ipAddress, userAgent });
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT to update a product - This route is no longer used for direct updates.
// All updates go through the pending changes API.
export async function PUT(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
    
    try {
        const body = await req.json();
        const parsedData = updateProductSchema.parse(body);
        const { id, ...updateData } = parsedData;

        const logDetails = { productId: id, updatedFields: Object.keys(updateData) };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_UPDATE_INITIATED', entity: 'PRODUCT', entityId: id, details: logDetails, ipAddress, userAgent });
        
        const dataToUpdate: any = { ...updateData };

        // Stringify JSON fields if they are present and are objects/arrays
        if (updateData.serviceFee && typeof updateData.serviceFee === 'object') {
            dataToUpdate.serviceFee = JSON.stringify(updateData.serviceFee);
        }
        if (updateData.dailyFee && typeof updateData.dailyFee === 'object') {
            dataToUpdate.dailyFee = JSON.stringify(updateData.dailyFee);
        }
        if (updateData.penaltyRules && Array.isArray(updateData.penaltyRules)) {
            dataToUpdate.penaltyRules = JSON.stringify(updateData.penaltyRules);
        }
        
        const updatedProduct = await prisma.loanProduct.update({
            where: { id },
            data: dataToUpdate,
            include: {
                eligibilityUpload: true, // Include the linked upload data
            }
        });

        const successLogDetails = { productId: updatedProduct.id, updatedFields: Object.keys(dataToUpdate) };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_UPDATE_SUCCESS', entity: 'PRODUCT', entityId: updatedProduct.id, details: successLogDetails, ipAddress, userAgent });

        return NextResponse.json(updatedProduct);

    } catch (error: any) {
        const errorMessage = (error as Error).message;
        const failureLogDetails = { error: errorMessage };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_UPDATE_FAILED', entity: 'PRODUCT', details: failureLogDetails, ipAddress, userAgent });
        return NextResponse.json({ error: 'Internal Server Error', 'details': errorMessage }, { status: 500 });
    }
}

// DELETE a product - This route is no longer used for direct deletions.
// All deletions go through the pending changes API.
export async function DELETE(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';
    
    let productId = '';
    try {
        const { id } = await req.json();
        productId = id;
        if (!id) {
            return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
        }
        
        const logDetails = { productId: id };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_DELETE_INITIATED', entity: 'PRODUCT', entityId: id, details: logDetails, ipAddress, userAgent });
        
        // Add check if product has associated loans
        const loanCount = await prisma.loan.count({ where: { productId: id } });
        if (loanCount > 0) {
            throw new Error('Cannot delete product. It has associated loans.');
        }
        
        const productToDelete = await prisma.loanProduct.findUnique({ where: { id }});

        await prisma.loanProduct.delete({ where: { id } });

        const successLogDetails = { deletedProductId: id, deletedProductName: productToDelete?.name, providerId: productToDelete?.providerId };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_DELETE_SUCCESS', entity: 'PRODUCT', entityId: id, details: successLogDetails, ipAddress, userAgent });

        return NextResponse.json({ message: 'Product deleted successfully' });

    } catch (error) {
        const errorMessage = (error as Error).message;
        const failureLogDetails = { productId: productId, error: errorMessage };
        await createAuditLog({ actorId: session.userId, action: 'PRODUCT_DELETE_FAILED', entity: 'PRODUCT', entityId: productId, details: failureLogDetails, ipAddress, userAgent });
        return NextResponse.json({ error: errorMessage || 'Internal Server Error' }, { status: 500 });
    }
}
