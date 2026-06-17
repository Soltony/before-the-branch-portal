import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromSession } from '@/lib/user';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit-log';
import { getDisbursementControl } from '@/lib/disbursement-control';

export async function GET() {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['disbursement-control']?.read) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const control = await getDisbursementControl();
  return NextResponse.json({ enabled: control.enabled, updatedAt: control.updatedAt });
}

const updateSchema = z.object({
  enabled: z.boolean(),
});

export async function PUT(req: NextRequest) {
  const user = await getUserFromSession();
  if (!user || !user.permissions?.['disbursement-control']?.update) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const ipAddress = req.headers.get('x-forwarded-for') || 'N/A';
  const userAgent = req.headers.get('user-agent') || 'N/A';

  try {
    const body = await req.json();
    const { enabled } = updateSchema.parse(body);

    // Ensure row exists, then update (SQL Server safe pattern).
    await prisma.$executeRaw`
      IF NOT EXISTS (SELECT 1 FROM [dbo].[DisbursementControl] WHERE [id] = 'global')
      BEGIN
        INSERT INTO [dbo].[DisbursementControl] ([id], [enabled], [updatedAt])
        VALUES ('global', 1, SYSUTCDATETIME())
      END
    `;

    await prisma.$executeRaw`
      UPDATE [dbo].[DisbursementControl]
      SET [enabled] = ${enabled ? 1 : 0},
          [updatedById] = ${user.id},
          [updatedAt] = SYSUTCDATETIME()
      WHERE [id] = 'global'
    `;

    const control = await getDisbursementControl();

    await createAuditLog({
      actorId: user.id,
      action: enabled ? 'DISBURSEMENTS_ENABLED' : 'DISBURSEMENTS_DISABLED',
      entity: 'DISBURSEMENT_CONTROL',
      entityId: 'global',
      details: { enabled },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ enabled: control.enabled, updatedAt: control.updatedAt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const msg = (error as Error).message || 'Internal Server Error';

    await createAuditLog({
      actorId: user.id,
      action: 'DISBURSEMENT_CONTROL_UPDATE_FAILED',
      entity: 'DISBURSEMENT_CONTROL',
      entityId: 'global',
      details: { error: msg },
      ipAddress,
      userAgent,
    }).catch(() => null);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
