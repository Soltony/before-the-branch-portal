import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guard-branch tests for processInsurancePayment. These exercise the early
 * returns that gate booking (idempotency, invalid status, rejected farmer,
 * missing farmer account) without touching the DB transaction. The full
 * happy-path booking is covered by the end-to-end manual verification.
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
import { createAuditLog } from "@/lib/audit-log";

const mockCreateAuditLog = vi.mocked(createAuditLog);

const activeFarmer = {
  id: "farmer-internal-1",
  farmerId: "FARMER001",
  farmerName: "Test Farmer",
  status: "APPROVED",
  requestedLoanAmount: 10000,
  requestedLoanTermInMonth: 6,
  // Borrower's own account, nominated by the approver at registration approval.
  disbursementAccountNo: "1000123456789",
  disbursementAccountName: "TEST FARMER",
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

  it("soft-errors when the farmer has no disbursement account selected", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p1",
      status: "REQUESTED",
      insuranceName: "NIB Insurance",
      insuranceAmount: 1500,
      farmer: { ...activeFarmer, disbursementAccountNo: null },
      insuranceAccount: {
        id: "acc1",
        accountNumber: "999",
        insuranceId: "INS1",
        insuranceName: "NIB Insurance",
      },
    });

    const r = await processInsurancePayment("p1", "actor-1");
    expect(r.ok).toBe(false);
    expect(r.softError).toBe(true);
    expect(r.message).toMatch(/no disbursement account selected/i);
    expect(r.confirmation).toBeUndefined();
  });

  // An unmapped insurer no longer blocks approval: the insurer mapping only
  // supplies the NIB insurance id reported alongside the transfer, and the
  // money goes to the farmer's own account either way.
  it("does not block on an unmapped insurer when the farmer has an account", async () => {
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
    expect(r.message).not.toMatch(/no active insurance account/i);
    expect(r.message).not.toMatch(/no disbursement account selected/i);
  });
});

/**
 * A refused approval changes nothing on the payment, so the audit entry is the
 * only record that someone tried and why it did not go through.
 */
describe("processInsurancePayment audit trail", () => {
  it("records a failed approval with the approver, reason and request origin", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p1",
      status: "REQUESTED",
      insuranceName: "NIB Insurance",
      insuranceAmount: 1500,
      farmer: { ...activeFarmer, disbursementAccountNo: null },
      insuranceAccount: null,
    });

    await processInsurancePayment("p1", "actor-1", {
      ipAddress: "10.0.0.7",
      userAgent: "test-agent",
    });

    expect(mockCreateAuditLog).toHaveBeenCalledTimes(1);
    const entry = mockCreateAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      actorId: "actor-1",
      action: "LERSHA_INSURANCE_APPROVAL_FAILED",
      entity: "LershaInsurancePayment",
      entityId: "p1",
      ipAddress: "10.0.0.7",
      userAgent: "test-agent",
    });
    expect(entry.details).toMatchObject({
      farmerId: "FARMER001",
      retryable: true,
      bookedLoanId: null,
    });
    expect(entry.details.reason).toMatch(/no disbursement account selected/i);
  });

  it("records a hard failure as not retryable", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p1",
      status: "REJECTED",
      farmer: activeFarmer,
      insuranceAccount: null,
    });

    await processInsurancePayment("p1", "actor-1");

    const entry = mockCreateAuditLog.mock.calls[0][0];
    expect(entry.action).toBe("LERSHA_INSURANCE_APPROVAL_FAILED");
    expect(entry.details).toMatchObject({
      reason: "INVALID_PAYMENT_STATUS",
      retryable: false,
    });
  });

  it("does not log an already-processed payment a second time", async () => {
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

    await processInsurancePayment("p1", "actor-1");

    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });
});
