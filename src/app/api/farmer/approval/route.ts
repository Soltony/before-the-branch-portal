import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { sendLoanDecision } from "@/lib/lersha/client";
import { randomUUID } from "crypto";
import { z } from "zod";
import { isFarmerPendingApproval } from "@/lib/lersha/farmer-status";

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

    const { farmer_id, decision, rejectionReason } = parsed.data;
    console.log("[farmer/approval] Parsed input:", {
      farmer_id,
      decision,
      hasRejectionReason: Boolean(rejectionReason),
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

    // Update farmer status
    const updated = await prisma.lershaFarmer.update({
      where: { farmerId: farmer_id },
      data: {
        status: decision,
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
