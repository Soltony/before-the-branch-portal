import prisma from "@/lib/prisma";
import { FARMER_APPROVED_STATUS } from "@/lib/lersha/farmer-status";

/**
 * Default NIB insurance product id used when an insurer mapping is first
 * auto-created from farmer data. It is admin-editable afterwards (the insurer
 * name and account number are sourced from the farmer registration; only the
 * NIB id and status are managed in the portal).
 */
export const DEFAULT_NIB_INSURANCE_ID = "INSURANCE001";

export interface InsuranceAccountSyncResult {
  created: number;
  updated: number;
  /** Distinct insurers found across approved farmers' insurance purposes. */
  total: number;
}

/**
 * Derive insurer → account mappings from approved farmers' "Insurance" loan
 * purposes. Lersha sends the insurer name (shown in the Agro Dealer column) and
 * its account number at registration, so instead of registering them by hand we
 * fetch and upsert them here.
 *
 * The NIB insurance id and the ACTIVE/INACTIVE status are admin-controlled: they
 * are seeded with a default only when a row is first created and preserved on
 * every later sync. The account number always tracks the latest farmer data.
 */
export async function syncInsuranceAccountsFromFarmers(options?: {
  /** Limit to specific farmers (LershaFarmer.id). Omitted → all approved farmers. */
  farmerInternalIds?: string[];
}): Promise<InsuranceAccountSyncResult> {
  const purposes = await prisma.lershaLoanPurpose.findMany({
    where: {
      ...(options?.farmerInternalIds
        ? { farmerId: { in: options.farmerInternalIds } }
        : {}),
      farmer: { status: FARMER_APPROVED_STATUS },
      OR: [{ insuranceName: { not: null } }, { loanPurpose: "insurance" }],
    },
    select: {
      insuranceName: true,
      agroDealerName: true,
      agroDealerAccountNo: true,
      createdAt: true,
    },
    // Latest registration first, so the most recent account number wins when an
    // insurer appears across multiple farmers.
    orderBy: { createdAt: "desc" },
  });

  // Collapse to one entry per insurer (keyed case-insensitively).
  const byName = new Map<string, { name: string; account: string }>();
  for (const p of purposes) {
    const name = (p.insuranceName ?? p.agroDealerName ?? "").trim();
    const account = (p.agroDealerAccountNo ?? "").trim();
    if (!name || !account) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, account });
  }

  let created = 0;
  let updated = 0;

  for (const { name, account } of byName.values()) {
    const existing = await prisma.insuranceAccount.findUnique({
      where: { insuranceName: name },
    });

    if (existing) {
      if (existing.accountNumber !== account) {
        await prisma.insuranceAccount.update({
          where: { id: existing.id },
          data: { accountNumber: account },
        });
        updated += 1;
      }
      continue;
    }

    await prisma.insuranceAccount.create({
      data: {
        insuranceName: name,
        accountNumber: account,
        insuranceId: DEFAULT_NIB_INSURANCE_ID,
        status: "ACTIVE",
      },
    });
    created += 1;
  }

  return { created, updated, total: byName.size };
}
