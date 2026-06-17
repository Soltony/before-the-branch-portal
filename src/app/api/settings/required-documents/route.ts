
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requiredDocumentSchema } from '@/lib/schemas';
import { z } from 'zod';

// GET all required documents for a product
export async function GET(req: NextRequest) {
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
        const documents = await prisma.requiredDocument.findMany({
            where: { productId },
            orderBy: { name: 'asc' },
        });
        return NextResponse.json(documents);
    } catch (error) {
        console.error('Error fetching required documents:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


// POST a new required document
export async function POST(req: NextRequest) {
    
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const data = requiredDocumentSchema.parse(body);

        const newDocument = await prisma.requiredDocument.create({
            data: {
                productId: data.productId,
                name: data.name,
                description: data.description || null,
            },
        });

        return NextResponse.json(newDocument, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error creating required document:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT to update a required document
export async function PUT(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    try {
        const body = await req.json();
        const data = requiredDocumentSchema.extend({ id: z.string() }).parse(body);

        const updatedDocument = await prisma.requiredDocument.update({
            where: { id: data.id },
            data: {
                name: data.name,
                description: data.description || null,
            },
        });

        return NextResponse.json(updatedDocument);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error('Error updating required document:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE a required document
export async function DELETE(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
    }

    try {
        await prisma.requiredDocument.delete({
            where: { id },
        });
        return NextResponse.json({ message: 'Document deleted successfully' });
    } catch (error) {
        console.error('Error deleting required document:', error);
        // Handle case where document is in use
        if (error instanceof Error && (error as any).code === 'P2003') {
            return NextResponse.json({ error: 'Cannot delete document. It is currently associated with uploaded files.' }, { status: 409 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
