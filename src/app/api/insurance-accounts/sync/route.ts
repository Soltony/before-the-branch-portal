import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromSession } from "@/lib/user";
import { hasPermission } from "@/lib/permissions";
import { createAuditLog } from "@/lib/audit-log";
import { syncInsuranceAccountsFromFarmers } from "@/lib/lersha/insurance-accounts";

const MODULE = "insurance-payments";

/**
 * POST /api/insurance-accounts/sync
 *
 * Fetch insurer name + account number from approved farmers' insurance loan
 * purposes and upsert them into InsuranceAccount, then return the refreshed
 * list. Replaces manual insurer registration.
 */
export async function POST() {
  const user = await getUserFromSession();
  if (!user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const allowed =
    user.role === "Super Admin" ||
    hasPermission(user, MODULE, "create") ||
    hasPermission(user, MODULE, "update");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await syncInsuranceAccountsFromFarmers();

    if (result.created > 0 || result.updated > 0) {
      await createAuditLog({
        actorId: user.id,
        action: "INSURANCE_ACCOUNTS_SYNCED",
        entity: "InsuranceAccount",
        details: result,
      });
    }

    const accounts = await prisma.insuranceAccount.findMany({
      orderBy: { insuranceName: "asc" },
    });
    return NextResponse.json({ ...result, accounts });
  } catch (error) {
    console.error("[insurance-accounts/sync] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
