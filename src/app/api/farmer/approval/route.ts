import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { sendLoanDecision } from "@/lib/lersha/client";
import { randomUUID } from "crypto";
import { z } from "zod";
import { isFarmerPendingApproval } from "@/lib/lersha/farmer-status";
import { verifyFarmerAccountSelection } from "@/lib/lersha/farmer-accounts";
import { getUserFromSession } from "@/lib/user";
import { getDistrictCodeFromUser } from "@/lib/district-filter";

/**
 * Admin approval endpoint for farmers.
 * Allows admins to approve or reject farmers before they can request loans.
 */

const approvalSchema = z.object({
  farmer_id: z.string().min(1, "farmer_id is required"),
  decision: z.enum(["APPROVED", "REJECTED"], {
    errorMap: () => ({ message: "decision must be APPROVED or REJECTED" }),
  }),
  rejectionReason: z.string().optional(),
  // The borrower's own account to credit on every disbursement for this farmer.
  // Required on approval: Lersha sends no account at registration, so the
  // approver picks one of the accounts held against the farmer's phone number.
  disbursementAccountNo: z.string().min(1).optional(),
});

type ApprovalInput = z.infer<typeof approvalSchema>;

export async function POST(req: NextRequest) {
  try {
    console.log("[farmer/approval] Request received");
    const body = await req.json();
    console.log("[farmer/approval] Incoming payload:", body);

    const parsed = approvalSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("[farmer/approval] Validation failed:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { farmer_id, decision, rejectionReason, disbursementAccountNo } =
      parsed.data;
    console.log("[farmer/approval] Parsed input:", {
      farmer_id,
      decision,
      hasRejectionReason: Boolean(rejectionReason),
      hasDisbursementAccount: Boolean(disbursementAccountNo),
    });

    // Find the farmer
    const farmer = await prisma.lershaFarmer.findUnique({
      where: { farmerId: farmer_id },
    });

    if (!farmer) {
      console.warn("[farmer/approval] Farmer not found:", { farmer_id });
      return NextResponse.json(
        { error: "Farmer not found." },
        { status: 404 },
      );
    }

    // A District user approves only their own district's farmers.
    const actingUser = await getUserFromSession();
    const actingDistrictCode = getDistrictCodeFromUser(actingUser ?? {});
    if (actingDistrictCode != null && farmer.districtCode !== actingDistrictCode) {
      console.warn("[farmer/approval] Cross-district decision blocked:", {
        farmer_id,
        farmerDistrictCode: farmer.districtCode,
        actingDistrictCode,
      });
      return NextResponse.json(
        { error: "This farmer belongs to another district." },
        { status: 403 },
      );
    }

    // Approve/reject farmers awaiting first registration or profile update review
    if (!isFarmerPendingApproval(farmer.status)) {
      console.warn("[farmer/approval] Invalid farmer status for decision:", {
        farmer_id,
        status: farmer.status,
        decision,
      });
      return NextResponse.json(
        {
          error: `Cannot ${decision.toLowerCase()} farmer with status: ${farmer.status}. Only pending registrations or pending updates can be approved/rejected.`,
        },
        { status: 409 },
      );
    }

    // On approval the reviewer must nominate the borrower's own account — every
    // disbursement for this farmer (agri-input loan and insurance) is credited
    // to it. Re-verify the number against the accounts the banking service holds
    // for the farmer's phone so an arbitrary account can never be posted here.
    let selectedAccount: { accountNumber: string; accountName: string | null } | null =
      null;
    if (decision === "APPROVED") {
      const accountNo =
        disbursementAccountNo?.trim() || farmer.disbursementAccountNo?.trim() || "";
      if (!accountNo) {
        console.warn("[farmer/approval] Approval without a credit account:", {
          farmer_id,
        });
        return NextResponse.json(
          {
            error:
              "Select the farmer's bank account to credit before approving. Accounts are listed from the farmer's phone number.",
          },
          { status: 400 },
        );
      }

      const verified = await verifyFarmerAccountSelection(
        farmer.phoneNumber,
        accountNo,
      );
      if (!verified.ok) {
        console.warn("[farmer/approval] Account verification failed:", {
          farmer_id,
          error: verified.error,
        });
        return NextResponse.json(
          { error: verified.error },
          { status: verified.status },
        );
      }
      selectedAccount = verified.account;
    }

    // Update farmer status. The review baseline (pre-update snapshot used to
    // show reviewers what changed) is consumed by this decision, so clear it.
    const updated = await prisma.lershaFarmer.update({
      where: { farmerId: farmer_id },
      data: {
        status: decision,
        reviewBaseline: null,
        ...(selectedAccount
          ? {
              disbursementAccountNo: selectedAccount.accountNumber,
              disbursementAccountName: selectedAccount.accountName,
              disbursementAccountSelectedAt: new Date(),
            }
          : {}),
      },
    });

    // Generate reference number for approved farmers
    const referenceNo =
      decision === "APPROVED"
        ? `REF${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`
        : undefined;

    // Notify Lersha of the decision
    const lershaPayload: any = {
      farmer_id: farmer_id,
      decision: decision === "APPROVED" ? "APPROVED" : "DECLINED",
      comment: rejectionReason || "Farmer registration review completed",
    };
    if (referenceNo) {
      lershaPayload.reference_no = referenceNo;
    }
    console.log("[farmer/approval] Sending payload to Lersha:", lershaPayload);

    const lershaResponse = await sendLoanDecision(lershaPayload);
    console.log("[farmer/approval] Response from Lersha:", {
      ok: lershaResponse.ok,
      status: lershaResponse.status,
      data: lershaResponse.data,
    });

    await createAuditLog({
      actorId: "admin-approval", // In production, use the actual admin user ID
      action: `LERSHA_FARMER_${decision}`,
      entity: "LershaFarmer",
      entityId: updated.id,
      details: {
        farmerId: farmer_id,
        farmerName: farmer.farmerName,
        decision,
        rejectionReason: rejectionReason || null,
        referenceNo,
        disbursementAccountNo: selectedAccount?.accountNumber ?? null,
        disbursementAccountName: selectedAccount?.accountName ?? null,
        lershaNotified: lershaResponse.ok,
        lershaStatus: lershaResponse.status,
      },
    });

    const response = {
      message: `Farmer ${decision.toLowerCase()} successfully.`,
      farmerId: farmer_id,
      farmerName: farmer.farmerName,
      status: updated.status,
      rejectionReason: rejectionReason || null,
      referenceNo,
      disbursementAccountNo: updated.disbursementAccountNo,
      disbursementAccountName: updated.disbursementAccountName,
      lershaNotified: lershaResponse.ok,
    };
    console.log("[farmer/approval] Returning response:", response);
    return NextResponse.json(response, { status: 200 });
  } catch (error: any) {
    console.error("[farmer/approval] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
