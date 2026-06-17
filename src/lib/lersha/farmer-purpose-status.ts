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
  } | null;
  linkedLoan: {
    repaymentStatus: string;
    loanAmount: number;
  } | null;
};

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
