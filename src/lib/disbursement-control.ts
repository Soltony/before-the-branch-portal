import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const GLOBAL_ID = 'global';

/**
 * Thrown inside a booking transaction when the kill-switch is off (or
 * unreadable) at the moment of writing. Rolling the transaction back is what
 * keeps a disabled switch from leaving a booked loan with no transfer behind
 * it, so every flow that books money must gate on
 * `areDisbursementsEnabledWithin` and let this propagate.
 */
export class DisbursementsDisabledError extends Error {
  constructor() {
    super('Disbursements are currently disabled');
    this.name = 'DisbursementsDisabledError';
  }
}

export type DisbursementControlState = {
  /** Whether disbursements may proceed. False whenever the flag cannot be confirmed. */
  enabled: boolean;
  updatedAt: Date | null;
  /**
   * True when `enabled` is a fail-closed default rather than the stored value.
   * Callers that *display* state must distinguish this ("we cannot read the
   * switch") from an operator having deliberately switched disbursements off.
   */
  unavailable: boolean;
  /** Why the flag could not be read. Only set when `unavailable` is true. */
  reason?: string;
};

/**
 * Read the global disbursement kill-switch.
 *
 * Fails CLOSED. A kill switch exists to stop money moving during an incident,
 * and a degraded database is exactly the kind of incident during which it has
 * to hold — so an unreadable flag means "disabled", not "carry on". (This
 * previously failed open to avoid outages before the table was migrated;
 * DisbursementControl has shipped in the init migration since, so that risk is
 * historical and no longer worth trading safety for.)
 */
export async function getDisbursementControl(): Promise<DisbursementControlState> {
  try {
    // Idempotent bootstrap, so a first read creates the row without racing a
    // concurrent reader into a primary-key violation.
    await prisma.$executeRaw`
      IF NOT EXISTS (SELECT 1 FROM [dbo].[DisbursementControl] WHERE [id] = ${GLOBAL_ID})
      BEGIN
        INSERT INTO [dbo].[DisbursementControl] ([id], [enabled], [updatedAt])
        VALUES (${GLOBAL_ID}, 1, SYSUTCDATETIME())
      END
    `;

    const rows = await prisma.$queryRaw<Array<{ enabled: boolean; updatedAt: Date }>>`
      SELECT TOP 1 [enabled] as enabled, [updatedAt] as updatedAt
      FROM [dbo].[DisbursementControl]
      WHERE [id] = ${GLOBAL_ID}
    `;

    if (rows.length === 0) {
      // The bootstrap above should guarantee a row. If there still isn't one the
      // state is genuinely unknown — refuse rather than assume.
      const reason = 'DisbursementControl row missing after bootstrap';
      console.error(`[disbursement-control] ${reason}; refusing disbursements`);
      return { enabled: false, updatedAt: null, unavailable: true, reason };
    }

    return {
      enabled: !!rows[0].enabled,
      updatedAt: rows[0].updatedAt ?? null,
      unavailable: false,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(
      '[disbursement-control] failed to read control flag; refusing disbursements',
      e,
    );
    return { enabled: false, updatedAt: null, unavailable: true, reason };
  }
}

export async function areDisbursementsEnabled(): Promise<boolean> {
  const control = await getDisbursementControl();
  return control.enabled;
}

/**
 * Read the kill-switch through an existing transaction client.
 *
 * Checking the switch and then booking the loan in separate statements leaves a
 * window in which an operator can disable disbursements between the two — the
 * loan lands on the books anyway. Reading it inside the booking transaction
 * closes that window: the check and the write commit or roll back together.
 *
 * Deliberately does not bootstrap the row (a read-only guard must not write
 * inside someone else's transaction) and fails closed if it is absent —
 * callers reach this only after `getDisbursementControl` has already ensured it.
 */
export async function areDisbursementsEnabledWithin(
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  try {
    const rows = await tx.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT TOP 1 [enabled] as enabled
      FROM [dbo].[DisbursementControl]
      WHERE [id] = ${GLOBAL_ID}
    `;
    if (rows.length === 0) {
      console.error(
        '[disbursement-control] no control row inside transaction; refusing disbursement',
      );
      return false;
    }
    return !!rows[0].enabled;
  } catch (e) {
    console.error(
      '[disbursement-control] in-transaction read failed; refusing disbursement',
      e,
    );
    return false;
  }
}
