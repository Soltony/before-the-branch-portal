/**
 * Derives a user-facing status for each Lersha loan purpose line item.
 */

export type PurposeDisplayStatus =
  | "Pending"
  | "Approved"
  | "Disbursed"
  | "Active"
  | "Closed"
  | "Declined"
  | "Not Requested"
  | "N/A";

export type PurposeStatusInput = {
  farmerStatus: string;
  productId: string | null;
  loanRequest: {
    status: string;
    createdAt: Date;
    disbursementConfirmedAt: Date | null;
    otpExpiresAt?: Date | string | null;
    otpVerified?: boolean;
  } | null;
  linkedLoan: {
    repaymentStatus: string;
    loanAmount: number;
  } | null;
};

/**
 * A loan request is "expired" when its OTP window lapsed before the farmer
 * verified it. The DB never mutates the stored status in this case (expiry is
 * only checked lazily at confirmation time), so callers must derive it.
 */
export function isLoanRequestExpired(req: {
  status: string;
  otpVerified?: boolean;
  otpExpiresAt?: Date | string | null;
}): boolean {
  if (req.status.toUpperCase() !== "PENDING_OTP") return false;
  if (req.otpVerified) return false;
  if (!req.otpExpiresAt) return false;
  return new Date(req.otpExpiresAt).getTime() < Date.now();
}

/**
 * User-facing status for a loan request row: surfaces EXPIRED for lapsed,
 * unverified OTP requests; otherwise returns the raw stored status.
 */
export function deriveLoanRequestDisplayStatus(req: {
  status: string;
  otpVerified?: boolean;
  otpExpiresAt?: Date | string | null;
}): string {
  return isLoanRequestExpired(req) ? "EXPIRED" : req.status;
}

export function derivePurposeDisplayStatus(
  input: PurposeStatusInput,
): PurposeDisplayStatus {
  const { farmerStatus, productId, loanRequest, linkedLoan } = input;

  if (!productId) {
    return "N/A";
  }

  const farmerUpper = farmerStatus.toUpperCase();
  if (farmerUpper === "REJECTED" || farmerUpper === "DECLINED") {
    return "Declined";
  }

  if (!loanRequest) {
  if (farmerUpper === "PENDING" || farmerUpper === "PENDING_UPDATE") {
    return "Pending";
  }
    return "Not Requested";
  }

  const reqStatus = loanRequest.status.toUpperCase();

  // A lapsed OTP request is no longer active; for an approved farmer the
  // product line becomes requestable again.
  if (reqStatus === "PENDING_OTP" && isLoanRequestExpired(loanRequest)) {
    return "Not Requested";
  }

  switch (reqStatus) {
    case "PENDING_OTP":
    case "OTP_VERIFIED":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "DECLINED":
      return "Declined";
    case "DISBURSED": {
      if (linkedLoan) {
        const rs = linkedLoan.repaymentStatus.toUpperCase();
        if (rs === "PAID") {
          return "Closed";
        }
        if (rs === "REVERSED" || rs === "CANCELLED") {
          return "Closed";
        }
        return "Active";
      }
      return "Disbursed";
    }
    default:
      return "Pending";
  }
}

export function purposeStatusBadgeVariant(
  status: PurposeDisplayStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Approved":
    case "Disbursed":
      return "default";
    case "Active":
      return "default";
    case "Declined":
      return "destructive";
    case "Closed":
      return "secondary";
    case "Pending":
    case "Not Requested":
      return "secondary";
    default:
      return "outline";
  }
}
