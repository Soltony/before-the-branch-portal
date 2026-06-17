import prisma from './prisma';
import { randomUUID } from 'crypto';

interface AuditLogData {
    actorId: string;
    action: string;
    entity?: string;
    entityId?: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
}

type ExternalApiAuditBase = {
    actorId: string;
    ipAddress?: string;
    userAgent?: string;
    integration: string; // e.g. DISBURSEMENT, SMS, TOKEN_VALIDATION
    entity?: string;
    entityId?: string;
    correlationId?: string;
};

type ExternalApiRequestDetails = {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
};

type ExternalApiResponseDetails = {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: unknown;
    durationMs?: number;
};

function truncateString(value: string, maxLen = 4000) {
    const str = value ?? '';
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + `…(truncated, len=${str.length})`;
}

function sanitizeUrl(url: string) {
    try {
        const u = new URL(url);
        const keys = Array.from(u.searchParams.keys());
        const query = keys.length ? `?${keys.map(k => `${encodeURIComponent(k)}=`).join('&')}` : '';
        return `${u.origin}${u.pathname}${query}`;
    } catch {
        return truncateString(String(url), 1000);
    }
}

function sanitizeHeaders(headers?: Record<string, string> | Headers | null) {
    if (!headers) return undefined;

    const out: Record<string, string> = {};
    const set = (kRaw: string, vRaw: string) => {
        const k = String(kRaw);
        const lower = k.toLowerCase();
        if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie' || lower === 'x-api-key') {
            out[k] = '[redacted]';
            return;
        }
        out[k] = truncateString(String(vRaw), 500);
    };

    if (typeof (headers as any).forEach === 'function') {
        (headers as any).forEach((v: any, k: any) => set(k, v));
        return out;
    }

    for (const [k, v] of Object.entries(headers as Record<string, string>)) {
        set(k, v);
    }
    return out;
}

function sanitizeForAudit(value: any, opts?: { maxDepth?: number; maxArrayLen?: number; maxStringLen?: number }) {
    const maxDepth = opts?.maxDepth ?? 6;
    const maxArrayLen = opts?.maxArrayLen ?? 50;
    const maxStringLen = opts?.maxStringLen ?? 4000;

    const redactKey = (k: string) => /pass(word)?|secret|token|authorization|api[_-]?key|signature/i.test(k);

    const walk = (v: any, depth: number): any => {
        if (v == null) return v;
        if (depth <= 0) return '[max-depth]';

        if (typeof v === 'string') return truncateString(v, maxStringLen);
        if (typeof v === 'number' || typeof v === 'boolean') return v;

        if (Array.isArray(v)) {
            const slice = v.slice(0, maxArrayLen).map(x => walk(x, depth - 1));
            if (v.length > maxArrayLen) {
                slice.push(`[+${v.length - maxArrayLen} more]`);
            }
            return slice;
        }

        if (typeof v === 'object') {
            const out: Record<string, any> = {};
            for (const [k, val] of Object.entries(v)) {
                if (redactKey(k)) {
                    out[k] = '[redacted]';
                } else {
                    out[k] = walk(val, depth - 1);
                }
            }
            return out;
        }

        try {
            return truncateString(String(v), maxStringLen);
        } catch {
            return '[unserializable]';
        }
    };

    return walk(value, maxDepth);
}

export function newAuditCorrelationId() {
    try {
        return randomUUID();
    } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }
}

export async function auditExternalApiRequest(base: ExternalApiAuditBase, req: ExternalApiRequestDetails) {
    const correlationId = base.correlationId ?? newAuditCorrelationId();
    await createAuditLog({
        actorId: base.actorId,
        action: 'EXTERNAL_API_REQUEST_SENT',
        entity: base.entity ?? 'EXTERNAL_API',
        entityId: base.entityId,
        ipAddress: base.ipAddress,
        userAgent: base.userAgent,
        details: sanitizeForAudit({
            correlationId,
            integration: base.integration,
            request: {
                method: req.method,
                url: sanitizeUrl(req.url),
                headers: sanitizeHeaders(req.headers),
                body: sanitizeForAudit(req.body),
            },
        }),
    });

    return correlationId;
}

export async function auditExternalApiResponse(base: ExternalApiAuditBase, res: ExternalApiResponseDetails) {
    const correlationId = base.correlationId ?? newAuditCorrelationId();
    await createAuditLog({
        actorId: base.actorId,
        action: 'EXTERNAL_API_RESPONSE_RECEIVED',
        entity: base.entity ?? 'EXTERNAL_API',
        entityId: base.entityId,
        ipAddress: base.ipAddress,
        userAgent: base.userAgent,
        details: sanitizeForAudit({
            correlationId,
            integration: base.integration,
            response: {
                status: res.status,
                statusText: res.statusText,
                headers: sanitizeHeaders(res.headers as any),
                body: sanitizeForAudit(res.body),
                durationMs: res.durationMs,
            },
        }),
    });

    return correlationId;
}

export async function auditExternalApiError(base: ExternalApiAuditBase, error: unknown, extra?: { durationMs?: number; request?: Partial<ExternalApiRequestDetails> }) {
    const correlationId = base.correlationId ?? newAuditCorrelationId();
    const message = error instanceof Error ? error.message : String(error);
    await createAuditLog({
        actorId: base.actorId,
        action: 'EXTERNAL_API_ERROR',
        entity: base.entity ?? 'EXTERNAL_API',
        entityId: base.entityId,
        ipAddress: base.ipAddress,
        userAgent: base.userAgent,
        details: sanitizeForAudit({
            correlationId,
            integration: base.integration,
            error: {
                message,
                name: error instanceof Error ? error.name : undefined,
            },
            durationMs: extra?.durationMs,
            request: extra?.request
                ? {
                      method: extra.request.method,
                      url: extra.request.url ? sanitizeUrl(extra.request.url) : undefined,
                      headers: extra.request.headers ? sanitizeHeaders(extra.request.headers) : undefined,
                      body: extra.request.body ? sanitizeForAudit(extra.request.body) : undefined,
                  }
                : undefined,
        }),
    });

    return correlationId;
}

/**
 * Creates a structured audit log entry in the database.
 * This is used for compliance and tracking critical actions.
 * @param data - The data for the audit log entry.
 */
export async function createAuditLog(data: AuditLogData) {
    'use server';
    try {
        await prisma.auditLog.create({
            data: {
                actorId: data.actorId,
                action: data.action,
                entity: data.entity,
                entityId: data.entityId,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                details: data.details ? JSON.stringify(data.details) : null,
            },
        });
    } catch (error) {
        console.error("Failed to create audit log:", error);
        // In a real application, you might want a fallback mechanism here,
        // like writing to a critical log file if the DB fails.
    }
}
