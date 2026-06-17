import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/user';

const MAX_DAYS = 31;
const MAX_ROWS = 50000;

function parseYyyyMmDd(value: string) {
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = value.split('-').map((v) => Number(v));
  if (!y || !mo || !d) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, mo, d };
}

function daysBetweenInclusive(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

function toUtcRangeFromLocalDays(fromYmd: { y: number; mo: number; d: number }, toYmd: { y: number; mo: number; d: number }, tz: string) {
  // Africa/Nairobi and Africa/Addis_Ababa are UTC+3 year-round (no DST).
  const allowed = new Set(['Africa/Nairobi', 'Africa/Addis_Ababa']);
  if (!allowed.has(tz)) return null;

  const offsetMs = 3 * 60 * 60 * 1000;

  const startLocalUtc = Date.UTC(fromYmd.y, fromYmd.mo - 1, fromYmd.d, 0, 0, 0, 0);
  const endLocalUtc = Date.UTC(toYmd.y, toYmd.mo - 1, toYmd.d, 23, 59, 59, 999);

  const startUtc = new Date(startLocalUtc - offsetMs);
  const endUtc = new Date(endLocalUtc - offsetMs);

  return { startUtc, endUtc };
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  const needs = /[\n\r,\"]/g.test(text);
  if (!needs) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const canReadAuditLogs = user.permissions?.['audit-logs']?.read || user.role === 'Super Admin' || user.role === 'Auditor';
  if (!canReadAuditLogs) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get('from') || '';
  const toStr = searchParams.get('to') || '';
  const tz = searchParams.get('tz') || 'Africa/Nairobi';
  const format = (searchParams.get('format') || 'csv').toLowerCase();

  const fromYmd = parseYyyyMmDd(fromStr);
  const toYmd = parseYyyyMmDd(toStr);
  if (!fromYmd || !toYmd) {
    return NextResponse.json({ error: 'Invalid from/to. Use YYYY-MM-DD.' }, { status: 400 });
  }

  const range = toUtcRangeFromLocalDays(fromYmd, toYmd, tz);
  if (!range) {
    return NextResponse.json({ error: 'Invalid tz. Use Africa/Nairobi or Africa/Addis_Ababa.' }, { status: 400 });
  }

  if (range.endUtc < range.startUtc) {
    return NextResponse.json({ error: 'Invalid range: to must be >= from.' }, { status: 400 });
  }

  const dayCount = daysBetweenInclusive(
    new Date(Date.UTC(fromYmd.y, fromYmd.mo - 1, fromYmd.d)),
    new Date(Date.UTC(toYmd.y, toYmd.mo - 1, toYmd.d))
  );

  if (dayCount > MAX_DAYS) {
    return NextResponse.json({ error: `Date range too large. Max ${MAX_DAYS} days.` }, { status: 400 });
  }

  if (format !== 'csv' && format !== 'json') {
    return NextResponse.json({ error: 'Invalid format. Use csv or json.' }, { status: 400 });
  }

  const privileged = user.role === 'Super Admin' || user.role === 'Auditor';

  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        gte: range.startUtc,
        lte: range.endUtc,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS + 1,
  });

  if (logs.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows. Narrow date range (max ${MAX_ROWS} rows).` }, { status: 400 });
  }

  const actorIds = Array.from(new Set(logs.map((l) => l.actorId).filter(Boolean)));
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, fullName: true, email: true },
  });
  const actorById = new Map(actors.map((a) => [a.id, a] as const));

  const exported = logs.map((log) => {
    const base: any = {
      id: log.id,
      createdAt: log.createdAt,
      actorId: log.actorId,
      actorName: actorById.get(log.actorId)?.fullName ?? null,
      actorEmail: actorById.get(log.actorId)?.email ?? null,
      action: log.action,
      entity: log.entity ?? null,
      entityId: log.entityId ?? null,
    };

    if (privileged) {
      base.ipAddress = log.ipAddress ?? null;
      base.userAgent = log.userAgent ?? null;
      base.details = log.details ?? null;
    } else {
      base.ipAddress = null;
      base.userAgent = null;
      base.details = null;
    }

    return base;
  });

  const filenameBase = `audit-logs_${fromStr}_to_${toStr}_${tz.replace(/\//g, '-')}`;

  if (format === 'json') {
    return new NextResponse(JSON.stringify(exported, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.json"`,
      },
    });
  }

  // CSV
  const headers = [
    'id',
    'createdAt',
    'actorId',
    'actorName',
    'actorEmail',
    'action',
    'entity',
    'entityId',
    'ipAddress',
    'userAgent',
    'details',
  ];

  const lines: string[] = [];
  lines.push(headers.join(','));

  for (const row of exported) {
    const values = headers.map((h) => {
      const v = (row as any)[h];
      if (h === 'details' && typeof v === 'string') {
        // keep details as a single CSV field
        return csvEscape(v);
      }
      return csvEscape(v);
    });
    lines.push(values.join(','));
  }

  const csv = lines.join('\n');
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
