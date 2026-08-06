import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { hasPermission, type PermissionSet } from "@/lib/permissions";
import { createAuditLog } from "@/lib/audit-log";
import {
  listFarmerAccounts,
  verifyFarmerAccountSelection,
} from "@/lib/lersha/farmer-accounts";

/**
 * Bank accounts held against a farmer's phone number, and the one selected to be
 * credited when this farmer is disbursed (agri-input loan or insurance).
 *
 * Both the farmer-loans reviewers and the insurance-payments approvers need this,
 * so either module's permission grants access.
 */
const MODULES = ["farmer-loans", "insurance-payments"] as const;

type RouteParams = { params: Promise<{ farmerId: string }> };

async function authorize(action: PermissionSet) {
  const user = await getUserFromSession();
  if (!user?.id) {
    return {
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  const allowed =
    user.role === "Super Admin" ||
    MODULES.some((m) => hasPermission(user, m, action));
  if (!allowed) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

async function findFarmer(farmerId: string) {
  return prisma.lershaFarmer.findFirst({
    where: { OR: [{ id: farmerId }, { farmerId }] },
  });
}

// GET — list the accounts registered against this farmer's phone number.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("read");
  if (auth.error) return auth.error;

  try {
    const { farmerId } = await params;
    const farmer = await findFarmer(farmerId);
    if (!farmer) {
      return NextResponse.json({ error: "Farmer not found." }, { status: 404 });
    }

    const result = await listFarmerAccounts(farmer.phoneNumber);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      phoneNumber: farmer.phoneNumber,
      accounts: result.accounts,
      selected: farmer.disbursementAccountNo
        ? {
            accountNumber: farmer.disbursementAccountNo,
            accountName: farmer.disbursementAccountName,
            selectedAt: farmer.disbursementAccountSelectedAt,
          }
        : null,
    });
  } catch (error) {
    console.error("[farmer accounts GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const selectSchema = z.object({
  accountNumber: z.string().min(1, "accountNumber is required"),
});

/**
 * PUT — set (or change) the account credited when this farmer is disbursed.
 *
 * Used for farmers approved before account selection existed, and to correct a
 * selection. Registration approval sets it through /api/farmer/approval instead.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("update");
  if (auth.error) return auth.error;
  const user = auth.user!;

  try {
    const { farmerId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = selectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const farmer = await findFarmer(farmerId);
    if (!farmer) {
      return NextResponse.json({ error: "Farmer not found." }, { status: 404 });
    }

    const verified = await verifyFarmerAccountSelection(
      farmer.phoneNumber,
      parsed.data.accountNumber,
    );
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const previousAccountNo = farmer.disbursementAccountNo;
    const updated = await prisma.lershaFarmer.update({
      where: { id: farmer.id },
      data: {
        disbursementAccountNo: verified.account.accountNumber,
        disbursementAccountName: verified.account.accountName,
        disbursementAccountSelectedAt: new Date(),
        disbursementAccountSelectedBy: user.id,
      },
    });

    await createAuditLog({
      actorId: user.id,
      action: "LERSHA_FARMER_DISBURSEMENT_ACCOUNT_SET",
      entity: "LershaFarmer",
      entityId: farmer.id,
      details: {
        farmerId: farmer.farmerId,
        farmerName: farmer.farmerName,
        phoneNumber: farmer.phoneNumber,
        previousAccountNo,
        accountNo: verified.account.accountNumber,
        accountName: verified.account.accountName,
      },
    });

    return NextResponse.json({
      success: true,
      selected: {
        accountNumber: updated.disbursementAccountNo,
        accountName: updated.disbursementAccountName,
        selectedAt: updated.disbursementAccountSelectedAt,
      },
    });
  } catch (error) {
    console.error("[farmer accounts PUT] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
