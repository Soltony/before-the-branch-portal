import prisma from '@/lib/prisma';

const GLOBAL_ID = 'global';

export async function getDisbursementControl(): Promise<{ enabled: boolean; updatedAt: Date | null }> {
  try {
    const rows = await prisma.$queryRaw<Array<{ enabled: boolean; updatedAt: Date }>>`
      SELECT TOP 1 [enabled] as enabled, [updatedAt] as updatedAt
      FROM [dbo].[DisbursementControl]
      WHERE [id] = ${GLOBAL_ID}
    `;

    if (rows.length > 0) {
      return { enabled: !!rows[0].enabled, updatedAt: rows[0].updatedAt ?? null };
    }

    // Initialize row (id='global') if missing.
    await prisma.$executeRaw`
      INSERT INTO [dbo].[DisbursementControl] ([id], [enabled], [updatedAt])
      VALUES (${GLOBAL_ID}, 1, SYSUTCDATETIME())
    `;

    return { enabled: true, updatedAt: null };
  } catch (e) {
    // Fail open: if we can't read the control flag, allow disbursements.
    // (Avoid accidental outages if migrations aren't applied yet.)
    console.error('[disbursement-control] failed to read control flag', e);
    return { enabled: true, updatedAt: null };
  }
}

export async function areDisbursementsEnabled(): Promise<boolean> {
  const control = await getDisbursementControl();
  return control.enabled;
}
