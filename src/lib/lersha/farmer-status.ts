/** Farmer registration statuses from Lersha integration */

export const FARMER_APPROVED_STATUS = "APPROVED" as const;
export const FARMER_PENDING_STATUS = "PENDING" as const;
export const FARMER_PENDING_UPDATE_STATUS = "PENDING_UPDATE" as const;

export function isFarmerApprovedForProcessing(status: string): boolean {
  return status.toUpperCase() === FARMER_APPROVED_STATUS;
}

export function isFarmerPendingApproval(status: string): boolean {
  const normalized = status.toUpperCase();
  return (
    normalized === FARMER_PENDING_STATUS ||
    normalized === FARMER_PENDING_UPDATE_STATUS
  );
}

/**
 * After Lersha re-sends Send Farmer Details for an existing farmerId:
 * - Still awaiting first approval → stay PENDING
 * - Rejected resubmission → PENDING
 * - Previously approved (or any other decided state) → PENDING_UPDATE (re-approval required)
 */
export function resolveStatusOnUpdate(existingStatus: string): string {
  const current = existingStatus.toUpperCase();

  if (current === FARMER_PENDING_STATUS) {
    return FARMER_PENDING_STATUS;
  }

  if (current === "REJECTED" || current === "DECLINED") {
    return FARMER_PENDING_STATUS;
  }

  return FARMER_PENDING_UPDATE_STATUS;
}

export function farmerStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case FARMER_PENDING_UPDATE_STATUS:
      return "Update Pending Approval";
    case "OTP_VERIFIED":
      return "Auto Disbursing";
    case "PENDING_OTP":
      return "Pending OTP";
    default:
      return status.replace(/_/g, " ");
  }
}
