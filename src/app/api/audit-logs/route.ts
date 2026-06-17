

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';

export async function GET(req: NextRequest) {
    const user = await getUserFromSession();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Only allow users with audit-logs.read permission or Super Admin/Auditor role
    const canReadAuditLogs = user.permissions?.['audit-logs']?.read || user.role === 'Super Admin' || user.role === 'Auditor';
    if (!canReadAuditLogs) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    // If an id is provided, return that single audit log
    if (id) {
        try {
            const log = await prisma.auditLog.findUnique({ where: { id } });
            if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 });

            const actor = await prisma.user.findUnique({
                where: { id: log.actorId },
                select: { id: true, fullName: true, email: true },
            });

            if (user.role !== 'Super Admin' && user.role !== 'Auditor') {
                const filtered = {
                    id: log.id,
                    actorId: log.actorId,
                    actor,
                    action: log.action,
                    entity: log.entity,
                    entityId: log.entityId,
                    createdAt: log.createdAt,
                    ipAddress: null,
                    details: null,
                    userAgent: null,
                };
                return NextResponse.json(filtered);
            }

            return NextResponse.json({
                ...log,
                actor,
            });
        } catch (error) {
            console.error('Failed to fetch audit log:', error);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Filter / search params
    const search = searchParams.get('search')?.trim() || '';
    const actionFilter = searchParams.get('action') || '';
    const entityFilter = searchParams.get('entity') || '';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';
    const meta = searchParams.get('meta'); // if "1", return distinct actions & entities

    // Build Prisma where clause
    const where: any = {};
    if (actionFilter) {
        where.action = actionFilter;
    }
    if (entityFilter) {
        where.entity = entityFilter;
    }
    if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) {
            // Include the entire "to" day
            const toEnd = new Date(dateTo);
            toEnd.setHours(23, 59, 59, 999);
            where.createdAt.lte = toEnd;
        }
    }

    // Text search – search across actor name/email, action, entity, entityId, ipAddress
    // We resolve matching actor IDs first, then use OR conditions
    if (search) {
        const matchingActors = await prisma.user.findMany({
            where: {
                OR: [
                    { fullName: { contains: search } },
                    { email: { contains: search } },
                ],
            },
            select: { id: true },
        });
        const actorIdMatches = matchingActors.map((a) => a.id);

        where.OR = [
            { action: { contains: search } },
            { entity: { contains: search } },
            { entityId: { contains: search } },
            { ipAddress: { contains: search } },
            ...(actorIdMatches.length > 0 ? [{ actorId: { in: actorIdMatches } }] : []),
        ];
    }

    try {
        // Optionally return filter metadata (distinct actions & entities)
        if (meta === '1') {
            const [distinctActions, distinctEntities] = await prisma.$transaction([
                prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
                prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, where: { entity: { not: null } }, orderBy: { entity: 'asc' } }),
            ]);
            return NextResponse.json({
                actions: distinctActions.map((a) => a.action),
                entities: distinctEntities.map((e) => e.entity).filter(Boolean),
            });
        }

        const [logs, totalCount] = await prisma.$transaction([
            prisma.auditLog.findMany({
                where,
                orderBy: {
                    createdAt: 'desc',
                },
                take: limit,
                skip: skip,
            }),
            prisma.auditLog.count({ where }),
        ]);

        const actorIds = Array.from(new Set(logs.map((l) => l.actorId).filter(Boolean)));
        const actors = await prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, fullName: true, email: true },
        });
        const actorById = new Map(actors.map((a) => [a.id, a] as const));

        // For non-super-admin/auditor, filter sensitive fields
        let filteredLogs = logs;
        if (user.role !== 'Super Admin' && user.role !== 'Auditor') {
            filteredLogs = logs.map(({ id, actorId, action, entity, entityId, createdAt }) => ({
                id,
                actorId,
                actor: actorById.get(actorId) ?? null,
                action,
                entity,
                entityId,
                createdAt,
                ipAddress: null,
                details: null,
                userAgent: null,
            }));
        } else {
            filteredLogs = logs.map((log) => ({
                ...log,
                actor: actorById.get(log.actorId) ?? null,
            }));
        }

        return NextResponse.json({
            logs: filteredLogs,
            totalPages: Math.ceil(totalCount / limit),
            currentPage: page,
        });
    } catch (error) {
        console.error('Failed to fetch audit logs:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

