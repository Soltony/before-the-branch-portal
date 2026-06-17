
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const uploadId = searchParams.get('uploadId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');

    if (!uploadId) {
        return NextResponse.json({ error: 'Upload ID is required' }, { status: 400 });
    }

    try {
        const totalRows = await prisma.provisionedData.count({
            where: { uploadId },
        });

        const data = await prisma.provisionedData.findMany({
            where: { uploadId },
            take: limit,
            skip: (page - 1) * limit,
            orderBy: {
                createdAt: 'asc',
            },
        });
        
        const parsedData = data.map(item => JSON.parse(item.data as string));

        return NextResponse.json({
            data: parsedData,
            page,
            limit,
            totalRows,
            totalPages: Math.ceil(totalRows / limit),
        });
    } catch (error) {
        console.error('Failed to fetch uploaded data:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
