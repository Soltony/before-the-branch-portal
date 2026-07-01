import { describe, it, expect } from "vitest";
import { derivePurposeDisplayStatus } from "./farmer-purpose-status";

/**
 * Insurance purposes are funded through a LershaInsurancePayment rather than a
 * LershaLoanRequest. These tests lock in the regression where a booked
 * insurance payment left its purpose showing "Not Requested".
 */
describe("derivePurposeDisplayStatus — insurance payments", () => {
  const base = {
    farmerStatus: "APPROVED",
    productId: "prod-insurance",
    loanRequest: null,
  };

  it("shows Disbursed for a SUCCESS payment with no linked loan yet", () => {
    expect(
      derivePurposeDisplayStatus({
        ...base,
        linkedLoan: null,
        insurancePayment: { status: "SUCCESS" },
      }),
    ).toBe("Disbursed");
  });

  it("shows Active for a SUCCESS payment with an unpaid linked loan", () => {
    expect(
      derivePurposeDisplayStatus({
        ...base,
        linkedLoan: { repaymentStatus: "Unpaid", loanAmount: 634.47 },
        insurancePayment: { status: "SUCCESS" },
      }),
    ).toBe("Active");
  });

  it("shows Closed for a SUCCESS payment with a paid linked loan", () => {
    expect(
      derivePurposeDisplayStatus({
        ...base,
        linkedLoan: { repaymentStatus: "Paid", loanAmount: 634.47 },
        insurancePayment: { status: "SUCCESS" },
      }),
    ).toBe("Closed");
  });

  it("shows Pending for a REQUESTED (not yet approved) payment", () => {
    expect(
      derivePurposeDisplayStatus({
        ...base,
        linkedLoan: null,
        insurancePayment: { status: "REQUESTED" },
      }),
    ).toBe("Pending");
  });

  it("shows Declined for a REJECTED/FAILED payment", () => {
    expect(
      derivePurposeDisplayStatus({
        ...base,
        linkedLoan: null,
        insurancePayment: { status: "REJECTED" },
      }),
    ).toBe("Declined");
    expect(
      derivePurposeDisplayStatus({
        ...base,
        linkedLoan: null,
        insurancePayment: { status: "FAILED" },
      }),
    ).toBe("Declined");
  });

  it("still returns Not Requested when there is no payment and no request", () => {
    expect(
      derivePurposeDisplayStatus({
        ...base,
        linkedLoan: null,
        insurancePayment: null,
      }),
    ).toBe("Not Requested");
  });
});
