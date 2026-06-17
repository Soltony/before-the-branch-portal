import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the overdue installment merging logic.
 *
 * These tests verify the new business rule:
 * When an installment's due date passes and it is unpaid:
 * 1. Close (clear) the overdue installment
 * 2. Merge its amount into the next installment
 * 3. Make the next installment the active installment
 */

// Mock the prisma client
const mockInstallmentUpdate = vi.fn();
const mockInstallmentFindMany = vi.fn();

// Simulate the rollover logic for testing purposes
async function simulateRollover(
  installments: Array<{
    id: string;
    installmentNumber: number;
    amount: number;
    penaltyAmount: number;
    status: string;
    isActive: boolean;
    dueDate: Date;
  }>,
  today: Date
): Promise<{
  updated: boolean;
  mergedCount: number;
  resultInstallments: typeof installments;
}> {
  const result = installments.map((i) => ({ ...i }));
  let mergedCount = 0;

  for (let i = 0; i < result.length - 1; i++) {
    const current = result[i];
    const next = result[i + 1];
    const currentDueDate = new Date(current.dueDate);
    currentDueDate.setHours(0, 0, 0, 0);

    const isOverdue = currentDueDate < today;
    const isUnpaid = current.status !== "Paid";
    const notMerged = current.status !== "Merged";
    const hasAmount = (current.amount || 0) > 0;

    if (isOverdue && isUnpaid && notMerged && hasAmount) {
      if (next.status === "Paid") {
        if (!current.isActive) {
          current.isActive = true;
        }
        continue;
      }

      // Close the current overdue installment
      current.status = "Merged";
      current.isActive = false;
      const amountToMerge = current.amount;
      const penaltyToMerge = current.penaltyAmount;
      current.amount = 0;

      // Merge into next installment
      next.amount = (next.amount || 0) + amountToMerge;
      next.penaltyAmount = (next.penaltyAmount || 0) + penaltyToMerge;
      next.isActive = true;

      mergedCount++;
    }
  }

  return {
    updated: mergedCount > 0,
    mergedCount,
    resultInstallments: result,
  };
}

describe("Overdue Installment Merging Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Merging Scenarios", () => {
    it("should merge overdue installment into the next installment", async () => {
      // Loan Amount: 10,000 split into 3 installments
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-01-01"), // Overdue
        },
        {
          id: "inst-2",
          installmentNumber: 2,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: false,
          dueDate: new Date("2025-02-01"),
        },
        {
          id: "inst-3",
          installmentNumber: 3,
          amount: 3333.34,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: false,
          dueDate: new Date("2025-03-01"),
        },
      ];

      const today = new Date("2025-01-15"); // After first installment due date
      today.setHours(0, 0, 0, 0);

      const result = await simulateRollover(installments, today);

      expect(result.mergedCount).toBe(1);

      // Installment 1 should be closed/merged
      expect(result.resultInstallments[0].status).toBe("Merged");
      expect(result.resultInstallments[0].amount).toBe(0);
      expect(result.resultInstallments[0].isActive).toBe(false);

      // Installment 2 should have the merged amount and be active
      expect(result.resultInstallments[1].amount).toBeCloseTo(6666.66, 2);
      expect(result.resultInstallments[1].isActive).toBe(true);

      // Installment 3 should remain unchanged
      expect(result.resultInstallments[2].amount).toBeCloseTo(3333.34, 2);
      expect(result.resultInstallments[2].isActive).toBe(false);
    });

    it("should cascade merge when multiple installments are overdue", async () => {
      // All 3 installments overdue
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 3333.33,
          penaltyAmount: 10,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-01-01"), // Overdue
        },
        {
          id: "inst-2",
          installmentNumber: 2,
          amount: 3333.33,
          penaltyAmount: 5,
          status: "PENDING",
          isActive: false,
          dueDate: new Date("2025-02-01"), // Overdue
        },
        {
          id: "inst-3",
          installmentNumber: 3,
          amount: 3333.34,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: false,
          dueDate: new Date("2025-03-01"), // Overdue
        },
      ];

      const today = new Date("2025-03-15"); // After all due dates
      today.setHours(0, 0, 0, 0);

      const result = await simulateRollover(installments, today);

      expect(result.mergedCount).toBe(2); // Two merges: 1->2, 2->3

      // Installment 1 should be closed
      expect(result.resultInstallments[0].status).toBe("Merged");
      expect(result.resultInstallments[0].amount).toBe(0);
      expect(result.resultInstallments[0].isActive).toBe(false);

      // Installment 2 should also be closed (it received from 1, then merged to 3)
      expect(result.resultInstallments[1].status).toBe("Merged");
      expect(result.resultInstallments[1].amount).toBe(0);
      expect(result.resultInstallments[1].isActive).toBe(false);

      // Installment 3 should have the full loan amount
      expect(result.resultInstallments[2].amount).toBeCloseTo(10000, 2);
      expect(result.resultInstallments[2].penaltyAmount).toBe(15); // 10 + 5 + 0
      expect(result.resultInstallments[2].isActive).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should not merge if installment is already paid", async () => {
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "Paid", // Already paid
          isActive: false,
          dueDate: new Date("2025-01-01"),
        },
        {
          id: "inst-2",
          installmentNumber: 2,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-02-01"),
        },
      ];

      const today = new Date("2025-01-15");
      today.setHours(0, 0, 0, 0);

      const result = await simulateRollover(installments, today);

      expect(result.mergedCount).toBe(0);
      expect(result.resultInstallments[0].status).toBe("Paid");
      expect(result.resultInstallments[1].amount).toBe(3333.33);
    });

    it("should not merge if installment is already merged", async () => {
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 0,
          penaltyAmount: 0,
          status: "Merged", // Already merged
          isActive: false,
          dueDate: new Date("2025-01-01"),
        },
        {
          id: "inst-2",
          installmentNumber: 2,
          amount: 6666.66,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-02-01"),
        },
      ];

      const today = new Date("2025-01-15");
      today.setHours(0, 0, 0, 0);

      const result = await simulateRollover(installments, today);

      expect(result.mergedCount).toBe(0);
      expect(result.resultInstallments[1].amount).toBe(6666.66);
    });

    it("should not merge if due date is in the future", async () => {
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-02-01"), // Not due yet
        },
        {
          id: "inst-2",
          installmentNumber: 2,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: false,
          dueDate: new Date("2025-03-01"),
        },
      ];

      const today = new Date("2025-01-15"); // Before due date
      today.setHours(0, 0, 0, 0);

      const result = await simulateRollover(installments, today);

      expect(result.mergedCount).toBe(0);
      expect(result.resultInstallments[0].amount).toBe(3333.33);
      expect(result.resultInstallments[0].isActive).toBe(true);
      expect(result.resultInstallments[1].amount).toBe(3333.33);
    });

    it("should not merge into a paid next installment", async () => {
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-01-01"), // Overdue
        },
        {
          id: "inst-2",
          installmentNumber: 2,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "Paid", // Already paid (edge case)
          isActive: false,
          dueDate: new Date("2025-02-01"),
        },
      ];

      const today = new Date("2025-01-15");
      today.setHours(0, 0, 0, 0);

      const result = await simulateRollover(installments, today);

      expect(result.mergedCount).toBe(0);
      // Current should stay as is but become active
      expect(result.resultInstallments[0].amount).toBe(3333.33);
      expect(result.resultInstallments[0].isActive).toBe(true);
    });

    it("should handle single installment loan", async () => {
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 10000,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-01-01"),
        },
      ];

      const today = new Date("2025-01-15");
      today.setHours(0, 0, 0, 0);

      const result = await simulateRollover(installments, today);

      expect(result.mergedCount).toBe(0); // No next installment to merge into
      expect(result.resultInstallments[0].amount).toBe(10000);
    });
  });

  describe("Full Example from Requirements", () => {
    it("should handle the complete example scenario correctly", async () => {
      // Loan Amount: 10,000 split into 3 installments
      const installments = [
        {
          id: "inst-1",
          installmentNumber: 1,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: true,
          dueDate: new Date("2025-01-01"), // D1
        },
        {
          id: "inst-2",
          installmentNumber: 2,
          amount: 3333.33,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: false,
          dueDate: new Date("2025-02-01"), // D2
        },
        {
          id: "inst-3",
          installmentNumber: 3,
          amount: 3333.34,
          penaltyAmount: 0,
          status: "PENDING",
          isActive: false,
          dueDate: new Date("2025-03-01"), // D3
        },
      ];

      // Case 1: Installment 1 is overdue and unpaid (after D1 but before D2)
      const afterD1 = new Date("2025-01-15");
      afterD1.setHours(0, 0, 0, 0);

      const case1Result = await simulateRollover([...installments.map((i) => ({ ...i }))], afterD1);

      // Installment 1 is cleared
      expect(case1Result.resultInstallments[0].status).toBe("Merged");
      expect(case1Result.resultInstallments[0].amount).toBe(0);

      // Its amount (3,333.33) is merged into Installment 2
      // New Installment 2 amount = 6,666.66
      expect(case1Result.resultInstallments[1].amount).toBeCloseTo(6666.66, 2);

      // Installment 2 becomes the active installment
      expect(case1Result.resultInstallments[1].isActive).toBe(true);

      // Installment 3 unchanged
      expect(case1Result.resultInstallments[2].amount).toBeCloseTo(3333.34, 2);

      // Case 2: Both Installment 1 and 2 are overdue (after D2 but before D3)
      const afterD2 = new Date("2025-02-15");
      afterD2.setHours(0, 0, 0, 0);

      const case2Result = await simulateRollover([...installments.map((i) => ({ ...i }))], afterD2);

      // Both installments 1 and 2 should be merged
      expect(case2Result.resultInstallments[0].status).toBe("Merged");
      expect(case2Result.resultInstallments[0].amount).toBe(0);
      expect(case2Result.resultInstallments[1].status).toBe("Merged");
      expect(case2Result.resultInstallments[1].amount).toBe(0);

      // Installment 3 has full loan amount
      expect(case2Result.resultInstallments[2].amount).toBeCloseTo(10000, 2);
      expect(case2Result.resultInstallments[2].isActive).toBe(true);
    });
  });
});
