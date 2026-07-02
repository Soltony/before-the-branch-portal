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
 * Whether Send Farmer Details may modify this farmer's record. Only farmers
 * still awaiting first approval — or resubmitting after a rejection — can be
 * updated; once a farmer has been approved the record is locked and updates
 * from Lersha are rejected outright. (PENDING_UPDATE is a legacy state from
 * when post-approval updates were accepted; those farmers were approved, so
 * they are locked too until a reviewer decides on the pending update.)
 */
export function canAcceptProfileUpdate(status: string): boolean {
  const normalized = status.toUpperCase();
  return (
    normalized === FARMER_PENDING_STATUS ||
    normalized === "REJECTED" ||
    normalized === "DECLINED"
  );
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
