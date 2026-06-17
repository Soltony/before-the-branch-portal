import { PrismaClient } from "@prisma/client";
import { startOfDay } from "date-fns";
import { getAsOfDate } from "./date-utils";

/**
 * Overdue Installment Merging Logic
 *
 * When an installment's due date passes and it is unpaid, the system should:
 * 1. Clear (close) the overdue installment (set status to 'Merged', amount to 0)
 * 2. Merge its amount into the next installment
 * 3. Make the next installment the active installment
 *
 * This process repeats sequentially for any number of installments (n).
 *
 * Example:
 * - Installment 1 (3333.33) is overdue -> Close it, merge into Installment 2
 * - Installment 2 now has 6666.66 and becomes active
 * - If Installment 2 also becomes overdue -> Close it, merge into Installment 3
 * - Installment 3 now has 10000 (full loan amount) and becomes active
 *
 * IMPORTANT: This only affects installment status/amount tracking.
 * Loan-level interest (daily fee) calculation is NOT modified.
 */

export interface RolloverResult {
  updated: boolean;
  mergedCount: number;
  activeInstallmentId: string | null;
}

/**
 * Ensures overdue installments are rolled over (merged) into the next installment.
 *
 * @param prisma - Prisma client instance (can be transaction client)
 * @param loanId - The loan ID to process
 * @param asOfDate - Optional date to use for determining overdue status (defaults to current date)
 * @returns RolloverResult with information about what was updated
 */
export async function ensureInstallmentRollover(
  prisma:
    | PrismaClient
    | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  loanId: string,
  asOfDate?: Date
): Promise<RolloverResult> {
  const rawAsOfDate = asOfDate ?? getAsOfDate();
  const today = startOfDay(rawAsOfDate);

  // Fetch all installments for this loan, ordered by installment number
  const installments = await (prisma as any).loanInstallment.findMany({
    where: { loanId },
    orderBy: { installmentNumber: "asc" },
  });

  if (installments.length === 0) {
    return { updated: false, mergedCount: 0, activeInstallmentId: null };
  }

  const updates: Promise<any>[] = [];
  let mergedCount = 0;

  // Process installments sequentially from first to second-to-last
  // We iterate forward: if installment[i] is overdue, close it and merge into installment[i+1]
  for (let i = 0; i < installments.length - 1; i++) {
    const current = installments[i];
    const next = installments[i + 1];
    const currentDueDate = startOfDay(new Date(current.dueDate));

    // Check if current installment is overdue and unpaid
    // An installment is eligible for rollover if:
    // - It's not already Paid
    // - It's not already MERGED (already processed)
    // - Its due date is before today
    // - It has an amount > 0 (something to merge)
    const isOverdue = currentDueDate < today;
    const isUnpaid = current.status !== "PAID";
    const notMerged = current.status !== "MERGED";
    const hasAmount = (current.amount || 0) > 0;

    if (isOverdue && isUnpaid && notMerged && hasAmount) {
      // Check that the next installment hasn't been paid or merged already
      if (next.status === "PAID") {
        // Next installment is already paid, can't merge into it
        // Just mark current as active if not already
        if (!current.isActive) {
          updates.push(
            (prisma as any).loanInstallment.update({
              where: { id: current.id },
              data: { isActive: true },
            })
          );
        }
        continue;
      }

      // Close the current overdue installment
      updates.push(
        (prisma as any).loanInstallment.update({
          where: { id: current.id },
          data: {
            status: "MERGED",
            isActive: false,
            // Keep the original amount for audit purposes, or set to 0 if preferred
            // Setting to 0 as per the requirement "clear the overdue installment"
            amount: 0,
          },
        })
      );

      // Calculate the remaining unpaid amount for partial payment scenarios
      // Only the unpaid portion should be merged into the next installment
      const paidAmount = current.paidAmount || 0;
      const remainingAmount = Math.max(0, (current.amount || 0) - paidAmount);

      // Merge the remaining unpaid amount and penalty into the next installment
      // Also update in-memory to handle cascading rollovers in the same loop
      const mergedAmount = remainingAmount + (next.amount || 0);
      const mergedPenalty =
        (current.penaltyAmount || 0) + (next.penaltyAmount || 0);

      updates.push(
        (prisma as any).loanInstallment.update({
          where: { id: next.id },
          data: {
            amount: mergedAmount,
            penaltyAmount: mergedPenalty,
            isActive: true,
          },
        })
      );

      // Update in-memory values for cascading effect
      // This ensures if next also becomes overdue, the loop handles it correctly
      next.amount = mergedAmount;
      next.penaltyAmount = mergedPenalty;
      next.isActive = true;

      // Clear current's in-memory values
      current.amount = 0;
      current.status = "MERGED";
      current.isActive = false;

      mergedCount++;
    }
  }

  // Execute all updates
  if (updates.length > 0) {
    await Promise.all(updates);
  }

  // Find the active installment after rollover
  // Re-check the in-memory state to find active
  const activeInstallment = installments.find(
    (i: any) => i.isActive && i.status !== "PAID" && i.status !== "MERGED"
  );

  // If no active installment found (e.g., all merged), set the last non-paid installment as active
  if (!activeInstallment) {
    const lastUnpaid = [...installments]
      .reverse()
      .find((i: any) => i.status !== "PAID" && i.status !== "MERGED");
    if (lastUnpaid && !lastUnpaid.isActive) {
      await (prisma as any).loanInstallment.update({
        where: { id: lastUnpaid.id },
        data: { isActive: true },
      });
      return {
        updated: updates.length > 0 || true,
        mergedCount,
        activeInstallmentId: lastUnpaid.id,
      };
    }
  }

  return {
    updated: updates.length > 0,
    mergedCount,
    activeInstallmentId: activeInstallment?.id ?? null,
  };
}

/**
 * Batch process rollover for multiple loans.
 * Useful for dashboard/history pages that need to ensure all loans are up-to-date.
 *
 * @param prisma - Prisma client instance
 * @param loanIds - Array of loan IDs to process
 * @param asOfDate - Optional date to use for determining overdue status
 */
export async function ensureInstallmentRolloverBatch(
  prisma: PrismaClient,
  loanIds: string[],
  asOfDate?: Date
): Promise<void> {
  for (const loanId of loanIds) {
    await ensureInstallmentRollover(prisma, loanId, asOfDate);
  }
}
