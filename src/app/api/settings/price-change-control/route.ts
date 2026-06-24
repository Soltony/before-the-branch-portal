import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit-log';
import { getPriceChangeControl } from '@/lib/price-change-control';

export async function GET() {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['settings']?.read) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const control = await getPriceChangeControl();
  return NextResponse.json({
    thresholdPercent: control.thresholdPercent,
    updatedAt: control.updatedAt,
  });
}

const updateSchema = z.object({
  // Tolerance as a percent: e.g. 10 means ±10%.
  thresholdPercent: z.number().positive().max(100),
});

export async function PUT(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['settings']?.update) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const ipAddress = req.headers.get('x-forwarded-for') || 'N/A';
  const userAgent = req.headers.get('user-agent') || 'N/A';

  try {
    const body = await req.json();
    const { thresholdPercent } = updateSchema.parse(body);

    // Ensure row exists, then update (SQL Server safe pattern).
    await prisma.$executeRaw`
      IF NOT EXISTS (SELECT 1 FROM [dbo].[PriceChangeControl] WHERE [id] = 'global')
      BEGIN
        INSERT INTO [dbo].[PriceChangeControl] ([id], [thresholdPercent], [updatedAt])
        VALUES ('global', 10, SYSUTCDATETIME())
      END
    `;

    await prisma.$executeRaw`
      UPDATE [dbo].[PriceChangeControl]
      SET [thresholdPercent] = ${thresholdPercent},
          [updatedById] = ${user.id},
          [updatedAt] = SYSUTCDATETIME()
      WHERE [id] = 'global'
    `;

    const control = await getPriceChangeControl();

    await createAuditLog({
      actorId: user.id,
      action: 'PRICE_CHANGE_THRESHOLD_UPDATED',
      entity: 'PRICE_CHANGE_CONTROL',
      entityId: 'global',
      details: { thresholdPercent },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      thresholdPercent: control.thresholdPercent,
      updatedAt: control.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const msg = (error as Error).message || 'Internal Server Error';

    await createAuditLog({
      actorId: user.id,
      action: 'PRICE_CHANGE_THRESHOLD_UPDATE_FAILED',
      entity: 'PRICE_CHANGE_CONTROL',
      entityId: 'global',
      details: { error: msg },
      ipAddress,
      userAgent,
    }).catch(() => null);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
