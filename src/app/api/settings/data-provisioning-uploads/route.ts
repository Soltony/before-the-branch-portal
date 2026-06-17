

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getUserFromSession } from '@/lib/user';
import ExcelJS from 'exceljs';
import { createAuditLog } from '@/lib/audit-log';
import { handleApiError } from '@/lib/error-utils';
import { hasPermissionForEntity } from '@/lib/require-permission';


// Helper to convert strings to camelCase
const toCamelCase = (str: string) => {
    if (!str) return '';
    return str.replace(/[^a-zA-Z0-9]+(.)?/g, (match, chr) => chr ? chr.toUpperCase() : '').replace(/^./, (match) => match.toLowerCase());
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_FILE_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']; // .xlsx

// This is a simplified version and does not handle file storage.
// It parses the file in memory, validates it, and stores the data.
// For large files, a streaming approach and storing the file in a bucket would be better.

export async function POST(req: NextRequest) {
    const session = await getSession();
    const user = await getUserFromSession();
    if (!session?.userId || !user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasPermissionForEntity(user, 'DataProvisioningUpload', 'create')) {
        return NextResponse.json({ error: 'Not authorized for this action' }, { status: 403 });
    }
    const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const configId = formData.get('configId') as string | null;
        const isProductFilter = formData.get('productFilter') === 'true';
        const productId = formData.get('productId') as string | null;

        if (!file || !configId) {
            return NextResponse.json({ error: 'File and configId are required' }, { status: 400 });
        }
        
        // **Security: File Type & Size Validation**
        if (!ALLOWED_FILE_TYPES.includes(file.type)) {
            return NextResponse.json({ error: `Invalid file type. Only .xlsx files are allowed.` }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File upload failed. Please try again.' }, { status: 400 });
        }

        const config = await prisma.dataProvisioningConfig.findUnique({
            where: { id: configId }
        });

        if (!config) {
            return NextResponse.json({ error: 'Data Provisioning Config not found' }, { status: 404 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];

        const columnCount = worksheet.columnCount || 0;
        const jsonData: any[][] = [];
        worksheet.eachRow((row) => {
            const rowArr: any[] = [];
            for (let i = 1; i <= columnCount; i++) {
                const cell = row.getCell(i);
                rowArr.push(cell.value);
            }
            jsonData.push(rowArr);
        });
        
        const originalHeaders = jsonData.length > 0 ? jsonData[0].map(h => String(h)) : [];
        const camelCaseHeaders = originalHeaders.map(toCamelCase);
        
        const rows = jsonData.length > 1 ? jsonData.slice(1) : [];

        // Determine identifier column up-front, validate and prepare lists used later
        const idColumnConfig = JSON.parse(config.columns as string).find((c: any) => c.isIdentifier);
        if (!idColumnConfig) {
            return NextResponse.json({ error: 'No identifier column found in config' }, { status: 400 });
        }

        const idColumnIndex = originalHeaders.findIndex(h => h === idColumnConfig.name);
        const idList = idColumnIndex !== -1 ? rows.map(r => String(r[idColumnIndex]).trim()).filter(Boolean) : [];
        const idColumnCamelCase = toCamelCase(idColumnConfig.name);

        const newUpload = await prisma.dataProvisioningUpload.create({
            data: {
                configId: configId,
                fileName: file.name,
                rowCount: rows.length,
                uploadedBy: user.fullName || user.email,
            }
        });

        // we already determined idColumnConfig and idColumnCamelCase above
        
        // Use transaction to perform all upserts
        await prisma.$transaction(async (tx) => {
            for (const row of rows) {
                const newRowData: { [key: string]: any } = {};
                camelCaseHeaders.forEach((header, index) => {
                    newRowData[header] = row[index];
                });
                
                const borrowerId = String(newRowData[idColumnCamelCase]);
                if (!borrowerId) continue;

                // 1. Upsert the borrower record first to ensure it exists
                await tx.borrower.upsert({
                    where: { id: borrowerId },
                    update: {},
                    create: { id: borrowerId }
                });

                // 2. Now upsert the provisioned data, merging if it exists
                // find provisioned data for this specific upload so we don't overwrite older uploads
                const existingData = await tx.provisionedData.findUnique({
                     where: {
                        borrowerId_configId_uploadId: {
                            borrowerId: borrowerId,
                            configId: configId,
                            uploadId: newUpload.id
                        }
                    },
                });
                
                let mergedData = newRowData;
                if (existingData?.data) {
                    const oldData = JSON.parse(existingData.data as string);
                    mergedData = { ...oldData, ...newRowData };
                }

                await tx.provisionedData.upsert({
                    where: {
                        borrowerId_configId_uploadId: {
                            borrowerId: borrowerId,
                            configId: configId,
                            uploadId: newUpload.id
                        }
                    },
                    update: {
                        data: JSON.stringify(mergedData),
                        uploadId: newUpload.id,
                    },
                    create: {
                        borrowerId: borrowerId,
                        configId: configId,
                        data: JSON.stringify(mergedData),
                        uploadId: newUpload.id,
                    }
                });
            }
        });
        
        if (isProductFilter && productId) {
             // Save a product-scoped eligibility filter using the identifier column name
             const filterString = idList.join(',');
             const filterObj = JSON.stringify({ [idColumnConfig.name]: filterString });

             await prisma.loanProduct.update({
                where: { id: productId },
                data: {
                    eligibilityUploadId: newUpload.id,
                    eligibilityFilter: filterObj,
                },
             });
             await createAuditLog({
                actorId: session.userId,
                action: 'DATA_PROVISIONING_FILTER_UPLOAD',
                entity: 'PRODUCT',
                entityId: productId,
                details: { uploadId: newUpload.id, fileName: file.name, rows: rows.length },
                ipAddress,
                userAgent
            });
        } else {
             await createAuditLog({
                actorId: session.userId,
                action: 'DATA_PROVISIONING_UPLOAD',
                entity: 'PROVIDER',
                entityId: config.providerId,
                details: { uploadId: newUpload.id, fileName: file.name, rows: rows.length },
                ipAddress,
                userAgent
            });
        }


        return NextResponse.json(newUpload, { status: 201 });

    } catch (error: any) {
        console.error('Error uploading provisioning data:', error);
        if (error.code === 'P2002') { // Handle unique constraint violation if any
             return NextResponse.json({ error: 'Duplicate data entry found in file. Please ensure identifiers are unique within the file.' }, { status: 400 });
        }
        if (error.code === 'P2003') { // Foreign key constraint
            return NextResponse.json({ error: 'Foreign key constraint failed. Please verify identifier values in the uploaded file.' }, { status: 400 });
        }
        return handleApiError(error, { operation: 'POST /api/settings/data-provisioning-uploads' });
    }
}

export async function DELETE(req: NextRequest) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const user = await getUserFromSession({ allowRefresh: false });
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasPermissionForEntity(user, 'DataProvisioningUpload', 'delete')) {
        return NextResponse.json({ error: 'Not authorized for this action' }, { status: 403 });
    }
     const ipAddress = req.ip || req.headers.get('x-forwarded-for') || 'N/A';
    const userAgent = req.headers.get('user-agent') || 'N/A';

    const { searchParams } = new URL(req.url);
    const uploadId = searchParams.get('uploadId');

    if (!uploadId) {
        return NextResponse.json({ error: 'Upload ID is required' }, { status: 400 });
    }

    try {
        const uploadToDelete = await prisma.dataProvisioningUpload.findUnique({
            where: { id: uploadId },
        });

        if (!uploadToDelete) {
             return NextResponse.json({ message: 'Upload not found or already deleted.' }, { status: 404 });
        }

        await prisma.$transaction(async (tx) => {
            // Delete all provisioned data associated with this upload
            await tx.provisionedData.deleteMany({
                where: { uploadId: uploadId }
            });

            // Delete the upload record itself
            await tx.dataProvisioningUpload.delete({
                where: { id: uploadId }
            });
        });
        
         await createAuditLog({
            actorId: session.userId,
            action: 'DATA_PROVISIONING_DELETE',
            entity: 'PROVIDER',
            entityId: uploadToDelete.configId,
            details: { uploadId: uploadId, fileName: uploadToDelete.fileName },
            ipAddress,
            userAgent
        });


        return NextResponse.json({ message: 'Upload and all associated data have been deleted successfully.' }, { status: 200 });

    } catch (error: any) {
        console.error(`Error deleting upload ${uploadId}:`, error);
        if (error.code === 'P2025') {
            // This happens if the record was already deleted
            return NextResponse.json({ message: 'Upload not found or already deleted.' }, { status: 404 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
    
