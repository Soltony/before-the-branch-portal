

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getUserFromSession } from '@/lib/user';
import { hasPermissionForEntity } from '@/lib/require-permission';

// Helper to safely parse JSON strings
const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};


// GET all configs for a provider
export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const user = await getUserFromSession({ allowRefresh: false });
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasPermissionForEntity(user, 'DataProvisioningConfig', 'read')) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId');

    if (!providerId) {
        return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 });
    }
    
    try {
        const configs = await prisma.dataProvisioningConfig.findMany({
            where: { providerId },
             include: {
                uploads: {
                    orderBy: {
                        uploadedAt: 'desc',
                    }
                }
            }
        });
        
        // Parse the columns from JSON string to an array for each config
        const formattedConfigs = configs.map(config => ({
            ...config,
            columns: safeJsonParse(config.columns, [])
        }));

        return NextResponse.json(formattedConfigs);
    } catch (error) {
        console.error('Error fetching data provisioning configs:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


// POST a new config
export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await getUserFromSession({ allowRefresh: false });
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasPermissionForEntity(user, 'DataProvisioningConfig', 'create')) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { providerId, name, columns } = body;
        
        const newConfig = await prisma.dataProvisioningConfig.create({
            data: {
                providerId,
                name,
                columns: JSON.stringify(columns)
            }
        });

        return NextResponse.json({ ...newConfig, columns: columns }, { status: 201 });
    } catch (error) {
        console.error('Error creating data provisioning config:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT to update a config
export async function PUT(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await getUserFromSession({ allowRefresh: false });
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasPermissionForEntity(user, 'DataProvisioningConfig', 'update')) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { id, name, columns } = body;

        const updatedConfig = await prisma.dataProvisioningConfig.update({
            where: { id },
            data: {
                name,
                columns: JSON.stringify(columns)
            }
        });
        
        return NextResponse.json({ ...updatedConfig, columns: columns });
    } catch (error) {
        console.error('Error updating data provisioning config:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


// DELETE a config
export async function DELETE(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await getUserFromSession({ allowRefresh: false });
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasPermissionForEntity(user, 'DataProvisioningConfig', 'delete')) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'Config ID is required' }, { status: 400 });
    }
    
    try {
        // Check if any product is using this config via an uploaded eligibility list
        const productCount = await prisma.loanProduct.count({
            where: { 
                eligibilityUpload: {
                    configId: id,
                }
            }
        });

        if (productCount > 0) {
            return NextResponse.json({ error: `Cannot delete. This data source is currently used by ${productCount} product(s) via an eligibility list.` }, { status: 409 });
        }

        await prisma.$transaction(async (tx) => {
             // Find any products that are linked to uploads from this config
            const uploadsToDelete = await tx.dataProvisioningUpload.findMany({
                where: { configId: id },
                select: { id: true }
            });
            const uploadIds = uploadsToDelete.map(u => u.id);

            // Unlink products before deleting uploads
            if (uploadIds.length > 0) {
                await tx.loanProduct.updateMany({
                    where: { eligibilityUploadId: { in: uploadIds } },
                    data: { eligibilityUploadId: null }
                });
            }

            // Delete all provisioned data associated with this config
            await tx.provisionedData.deleteMany({
                where: { configId: id }
            });

            // Now delete the config and its associated uploads
            await tx.dataProvisioningConfig.delete({
                where: { id },
            });
        });


        return NextResponse.json({ message: 'Config deleted successfully' });

    } catch (error: any) {
        console.error('Error deleting data provisioning config:', error);
        // Fallback for any other errors
        if (error.code === 'P2003') { // This is a general foreign key constraint, though we try to check above.
             return NextResponse.json({ error: 'This configuration is in use and cannot be deleted.' }, { status: 409 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
