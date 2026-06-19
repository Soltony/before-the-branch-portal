import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guard-branch tests for processInsurancePayment. These exercise the early
 * returns that gate booking (idempotency, invalid status, rejected farmer,
 * unmapped insurer) without touching the DB transaction. The full happy-path
 * booking is covered by the end-to-end manual verification.
 */

const mockFindUnique = vi.fn();
const mockAccountFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    lershaInsurancePayment: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
    insuranceAccount: {
      findFirst: (...args: any[]) => mockAccountFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/lersha/disbursement", () => ({
  resolveAgricultureProduct: vi.fn(),
}));
vi.mock("@/lib/external-disbursement", () => ({
  processExternalDisbursement: vi.fn(),
}));
vi.mock("@/lib/disbursement-control", () => ({
  areDisbursementsEnabled: vi.fn(),
}));
vi.mock("@/lib/audit-log", () => ({ createAuditLog: vi.fn() }));
vi.mock("@/lib/loan-calculator", () => ({
  calculateTotalRepayable: vi.fn(),
  calculateInclusiveTax: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processInsurancePayment } from "@/lib/lersha/insurance";

const activeFarmer = {
  id: "farmer-internal-1",
  farmerId: "FARMER001",
  farmerName: "Test Farmer",
  status: "APPROVED",
  requestedLoanAmount: 10000,
  requestedLoanTermInMonth: 6,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processInsurancePayment guards", () => {
  it("returns an error when the payment is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const r = await processInsurancePayment("missing", "actor-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("PAYMENT_NOT_FOUND");
    expect(r.confirmation).toBeUndefined();
  });

  it("is idempotent when the payment is already SUCCESS", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p1",
      status: "SUCCESS",
      loanId: "loan-1",
      remainingBalance: 2500,
      transactionId: "TXN1",
      transactionAmount: 1500,
      farmer: activeFarmer,
      insuranceAccount: null,
    });
    const r = await processInsurancePayment("p1", "actor-1");
    expect(r.ok).toBe(true);
    expect(r.alreadyProcessed).toBe(true);
    expect(r.confirmation).toBeUndefined();
  });

  it("rejects approval of a non-REQUESTED payment", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p1",
      status: "REJECTED",
      farmer: activeFarmer,
      insuranceAccount: null,
    });
    const r = await processInsurancePayment("p1", "actor-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("INVALID_PAYMENT_STATUS");
  });

  it("refuses to book for a rejected farmer", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p1",
      status: "REQUESTED",
      farmer: { ...activeFarmer, status: "REJECTED" },
      insuranceAccount: { id: "acc1", accountNumber: "123", insuranceId: "INS1", insuranceName: "NIB" },
    });
    const r = await processInsurancePayment("p1", "actor-1");
    expect(r.ok).toBe(false);
    expect(r.softError).toBe(true);
    expect(r.error).toBe("FARMER_REJECTED");
  });

  it("soft-errors when the insurer has no configured account", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p1",
      status: "REQUESTED",
      insuranceName: "Unmapped Insurer",
      insuranceAmount: 1500,
      farmer: activeFarmer,
      insuranceAccount: null,
    });
    mockAccountFindFirst.mockResolvedValue(null);

    const r = await processInsurancePayment("p1", "actor-1");
    expect(r.ok).toBe(false);
    expect(r.softError).toBe(true);
    expect(r.message).toMatch(/no active insurance account/i);
    expect(r.confirmation).toBeUndefined();
  });
});
