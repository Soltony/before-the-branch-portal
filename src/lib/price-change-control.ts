import prisma from '@/lib/prisma';

const GLOBAL_ID = 'global';

/** Default tolerance (percent) applied when no row is configured yet. */
export const DEFAULT_PRICE_CHANGE_THRESHOLD_PERCENT = 10;

/**
 * Reads the bank-configured tolerance for Lersha woreda price changes from the
 * single-row PriceChangeControl table (id = 'global'), creating it with the
 * default on first read. Mirrors the disbursement-control pattern.
 */
export async function getPriceChangeControl(): Promise<{
  thresholdPercent: number;
  updatedAt: Date | null;
}> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ thresholdPercent: number; updatedAt: Date }>
    >`
      SELECT TOP 1 [thresholdPercent] as thresholdPercent, [updatedAt] as updatedAt
      FROM [dbo].[PriceChangeControl]
      WHERE [id] = ${GLOBAL_ID}
    `;

    if (rows.length > 0) {
      return {
        thresholdPercent: Number(rows[0].thresholdPercent),
        updatedAt: rows[0].updatedAt ?? null,
      };
    }

    // Initialize row (id='global') if missing.
    await prisma.$executeRaw`
      INSERT INTO [dbo].[PriceChangeControl] ([id], [thresholdPercent], [updatedAt])
      VALUES (${GLOBAL_ID}, ${DEFAULT_PRICE_CHANGE_THRESHOLD_PERCENT}, SYSUTCDATETIME())
    `;

    return {
      thresholdPercent: DEFAULT_PRICE_CHANGE_THRESHOLD_PERCENT,
      updatedAt: null,
    };
  } catch (e) {
    // Fall back to the default tolerance if the row/table can't be read (e.g.
    // migration not applied yet) — the threshold is still enforced.
    console.error('[price-change-control] failed to read threshold', e);
    return {
      thresholdPercent: DEFAULT_PRICE_CHANGE_THRESHOLD_PERCENT,
      updatedAt: null,
    };
  }
}

export async function getPriceChangeThresholdPercent(): Promise<number> {
  const control = await getPriceChangeControl();
  return control.thresholdPercent;
}
