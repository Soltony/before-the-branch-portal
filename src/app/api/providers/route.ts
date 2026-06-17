
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { createAuditLog } from '@/lib/audit-log';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');

const safeJsonParse = (jsonString: string | null | undefined, defaultValue: any) => {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
};

export async function GET() {
    try {
        const session = await getSession();
        if (!session?.userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Fetch the user (including role) to determine which provider they belong to
        const user = await prisma.user.findUnique({ where: { id: session.userId }, include: { role: true } });
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // If Super Admin, return all providers; otherwise filter by user's provider
        let providers;
        if (user.role?.name === 'Super Admin') {
            providers = await prisma.loanProvider.findMany({
                include: {
                    products: {
                        orderBy: { name: 'asc' }
                    }
                },
                orderBy: { displayOrder: 'asc' }
            });
        } else {
            // If the user has no associated provider, return an empty array
            if (!user.loanProviderId) return NextResponse.json([]);

            providers = await prisma.loanProvider.findMany({
                where: { id: user.loanProviderId },
                include: {
                    products: {
                        orderBy: { name: 'asc' }
                    }
                },
                orderBy: { displayOrder: 'asc' }
            });
        }

        const formattedProviders = providers.map(p => ({
                id: p.id,
                name: p.name,
                icon: p.icon,
                colorHex: p.colorHex,
                displayOrder: p.displayOrder,
                accountNumber: p.accountNumber,
                products: p.products.map(prod => ({
                        id: prod.id,
                        providerId: p.id,
                        name: prod.name,
                        description: prod.description,
                        icon: prod.icon,
                        minLoan: prod.minLoan,
                        maxLoan: prod.maxLoan,
                        serviceFee: safeJsonParse(prod.serviceFee, { type: 'percentage', value: 0 }),
                        dailyFee: safeJsonParse(prod.dailyFee, { type: 'percentage', value: 0 }),
                        penaltyRules: safeJsonParse(prod.penaltyRules, []),
                        status: prod.status,
                        serviceFeeEnabled: prod.serviceFeeEnabled,
                        dailyFeeEnabled: prod.dailyFeeEnabled,
                        penaltyRulesEnabled: prod.penaltyRulesEnabled,
                }))
        }));

        return NextResponse.json(formattedProviders);
    } catch (error) {
        console.error('Error fetching providers:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const allowedMimeByPurpose: Record<string, string[]> = {
    icon: ['image/png', 'image/jpeg'],
    // Documents are restricted to .xlsx only (Office Open XML spreadsheet)
    document: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

const blockedExtensions = new Set(['html', 'htm', 'xml', 'js', 'exe', 'sh', 'php']);

function getExtension(filename: string | null | undefined) {
    if (!filename) return '';
    const idx = filename.lastIndexOf('.');
    if (idx === -1) return '';
    return filename.slice(idx + 1).toLowerCase();
}

function detectMimeFromMagic(bytes: Uint8Array): string | null {
    if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        return 'application/pdf';
    }
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
    }
    // Detect ZIP-based OOXML files (XLSX). ZIP magic: 50 4B 03 04
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)) {
        // Look for OOXML indicators in the first chunk: 'xl/' folder or [Content_Types].xml
        try {
            const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 4096)));
            if (sample.includes('xl/') || sample.includes('[Content_Types].xml') || sample.includes('workbook.xml')) {
                return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            }
            // Generic ZIP not matched to XLSX
            return 'application/zip';
        } catch (e) {
            return 'application/zip';
        }
    }
    // Basic catch for text-based risky types (HTML/XML/JS)
    try {
        const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 1024)));
        const lower = sample.toLowerCase();
        if (lower.includes('<!doctype') || lower.includes('<html') || lower.includes('<?xml') || lower.includes('<script') || lower.includes('javascript:')) {
            return 'text/risky';
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function extensionLooksLikeMime(ext: string, mime: string | null) {
    if (!mime) return false;
    if (ext === 'png' && mime === 'image/png') return true;
    if ((ext === 'jpg' || ext === 'jpeg') && mime === 'image/jpeg') return true;
    if (ext === 'pdf' && mime === 'application/pdf') return true;
    if (ext === 'xlsx' && mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return true;
    return false;
}

function makeSafeContentDisposition(filename: string) {
    // Always force download; avoid inline rendering to prevent execution in browser
    const safeName = filename.replace(/\"/g, '');
    return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const form = await req.formData();
        const file = form.get('file') as File | null;
        const providerId = form.get('providerId')?.toString();
        const purpose = (form.get('type')?.toString() || 'icon') as string; // icon or document

        // Basic parameter validation
        if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        if (!providerId) return NextResponse.json({ error: 'Missing providerId' }, { status: 400 });

        // Authorization: Super Admin or user belonging to provider
        const user = await prisma.user.findUnique({ where: { id: session.userId } });
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const isSuperAdmin = !!(await prisma.role.findFirst({ where: { id: user.roleId, name: 'Super Admin' } }));
        if (!isSuperAdmin && user.loanProviderId !== providerId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const fileName = (file as any).name || 'upload.bin';
        const ext = getExtension(fileName);
        const size = (file as any).size ?? 0;

        // Size check
        if (size > MAX_FILE_SIZE) {
            await createAuditLog({ actorId: session.userId, action: 'UPLOAD_ATTEMPT', entity: 'LoanProvider', entityId: providerId, details: { fileName, size, reason: 'TOO_LARGE' }, ipAddress: req.headers.get('x-forwarded-for') || undefined, userAgent: req.headers.get('user-agent') || undefined });
            return NextResponse.json({ error: 'File too large' }, { status: 413 });
        }

        // Extension blocklist
        if (blockedExtensions.has(ext)) {
            await createAuditLog({ actorId: session.userId, action: 'UPLOAD_ATTEMPT', entity: 'LoanProvider', entityId: providerId, details: { fileName, size, extension: ext, reason: 'EXTENSION_BLOCKED' }, ipAddress: req.headers.get('x-forwarded-for') || undefined, userAgent: req.headers.get('user-agent') || undefined });
            return NextResponse.json({ error: 'File type not allowed' }, { status: 415 });
        }

        const ab = await file.arrayBuffer();
        const u8 = new Uint8Array(ab);
        const detected = detectMimeFromMagic(u8);

        if (detected === 'text/risky') {
            await createAuditLog({ actorId: session.userId, action: 'UPLOAD_ATTEMPT', entity: 'LoanProvider', entityId: providerId, details: { fileName, size, reason: 'RISKY_CONTENT' }, ipAddress: req.headers.get('x-forwarded-for') || undefined, userAgent: req.headers.get('user-agent') || undefined });
            return NextResponse.json({ error: 'Risky file content detected' }, { status: 415 });
        }

        // If we couldn't detect mime, reject for safety
        if (!detected) {
            await createAuditLog({ actorId: session.userId, action: 'UPLOAD_ATTEMPT', entity: 'LoanProvider', entityId: providerId, details: { fileName, size, reason: 'UNKNOWN_MAGIC' }, ipAddress: req.headers.get('x-forwarded-for') || undefined, userAgent: req.headers.get('user-agent') || undefined });
            return NextResponse.json({ error: 'Unable to verify file type' }, { status: 415 });
        }

        // Purpose-based allowlist
        const allowedForPurpose = allowedMimeByPurpose[purpose] ?? [];
        if (!allowedForPurpose.includes(detected)) {
            await createAuditLog({ actorId: session.userId, action: 'UPLOAD_ATTEMPT', entity: 'LoanProvider', entityId: providerId, details: { fileName, size, detected, purpose, reason: 'DISALLOWED_FOR_PURPOSE' }, ipAddress: req.headers.get('x-forwarded-for') || undefined, userAgent: req.headers.get('user-agent') || undefined });
            return NextResponse.json({ error: 'File type not allowed for this upload' }, { status: 415 });
        }

        // Extension vs detected mime check
        if (!extensionLooksLikeMime(ext, detected)) {
            await createAuditLog({ actorId: session.userId, action: 'UPLOAD_ATTEMPT', entity: 'LoanProvider', entityId: providerId, details: { fileName, size, detected, extension: ext, reason: 'EXT_MISMATCH' }, ipAddress: req.headers.get('x-forwarded-for') || undefined, userAgent: req.headers.get('user-agent') || undefined });
            return NextResponse.json({ error: 'File extension does not match file content' }, { status: 415 });
        }

        // Store to uploads dir
        const safeBaseName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
        const newFileName = `${uniqueSuffix}-${safeBaseName}`;
        const subdir = purpose === 'icon' ? `providers/${providerId}/icons` : `providers/${providerId}/documents`;
        const destDir = path.join(UPLOADS_DIR, subdir);
        await mkdir(destDir, { recursive: true });
        const destPath = path.join(destDir, newFileName);
        // Write buffer to disk (small files expected). For larger files, switch to streaming.
        await writeFile(destPath, Buffer.from(u8));

        // Compute a URL/path that frontend can use. If you serve uploads from a static route, adjust accordingly.
        // We'll store a relative path from project root: /uploads/...
        const publicPath = `/${path.relative(process.cwd(), destPath).split(path.sep).join('/')}`;

        if (purpose === 'icon') {
            await prisma.loanProvider.update({ where: { id: providerId }, data: { icon: publicPath } });
        } else {
            // Allow optional association fields from form
            const loanApplicationId = form.get('loanApplicationId')?.toString() ?? '';
            const requiredDocumentId = form.get('requiredDocumentId')?.toString() ?? '';
            // Create UploadedDocument record if possible
            try {
                await prisma.uploadedDocument.create({ data: {
                    loanApplicationId: loanApplicationId || undefined,
                    requiredDocumentId: requiredDocumentId || undefined,
                    fileName,
                    fileType: detected,
                    fileContent: publicPath,
                }});
            } catch (e) {
                // If DB constraints fail, still continue but log
                console.warn('Failed to create UploadedDocument record:', e);
            }
        }

        await createAuditLog({ actorId: session.userId, action: 'UPLOAD', entity: 'LoanProvider', entityId: providerId, details: { fileName, size, detected, purpose, result: 'SUCCESS' }, ipAddress: req.headers.get('x-forwarded-for') || undefined, userAgent: req.headers.get('user-agent') || undefined });

        return NextResponse.json({ ok: true, message: 'File uploaded', contentType: detected }, { status: 200, headers: { 'X-Content-Disposition': makeSafeContentDisposition(fileName) } });
    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
