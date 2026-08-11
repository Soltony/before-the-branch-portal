import prisma from './prisma';

/**
 * District scoping for users on the District role.
 *
 * Districts come from Lersha: every farmer registration carries the district
 * the farmer belongs to, stored on LershaFarmer.districtCode. A District user
 * sees only that district's farmers, and only the loans, insurance payments,
 * reports and dashboard figures derived from them.
 *
 * Loans booked for a Lersha farmer use the farmer's external `farmerId` as
 * `Loan.borrowerId` (see lib/lersha/disbursement.ts), which is what makes the
 * loan-level filters below possible — and what makes them exclude non-Lersha
 * loans, since those borrowers are never registered under a district.
 */

export function getDistrictCodeFromUser(user: {
  role?: string;
  districtCode?: number | null;
}): number | null {
  if (user.role !== 'District' || user.districtCode == null) return null;
  return user.districtCode;
}

/** Internal LershaFarmer.id values for a district (FK target of farmer relations). */
export async function getFarmerIdsForDistrictCode(districtCode: number): Promise<string[]> {
  const rows = await prisma.lershaFarmer.findMany({
    where: { districtCode },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** External LershaFarmer.farmerId values, which double as Loan.borrowerId. */
export async function getBorrowerIdsForDistrictCode(districtCode: number): Promise<string[]> {
  const rows = await prisma.lershaFarmer.findMany({
    where: { districtCode },
    select: { farmerId: true },
  });
  return [...new Set(rows.map((r) => r.farmerId))];
}

function intersectIds(existing: string[], scopedIds: string[]): string[] {
  const set = new Set(scopedIds);
  return existing.filter((id) => set.has(id));
}

/**
 * Narrow an `{ in: string[] }` id filter to the district's ids, preserving any
 * filter already on the clause. Returns false when nothing can match.
 */
function applyIdScope(
  whereClause: Record<string, unknown>,
  key: string,
  scopedIds: string[]
): boolean {
  if (scopedIds.length === 0) return false;

  const existing = (whereClause[key] as { in?: string[] } | undefined)?.in;
  if (existing?.length) {
    const intersected = intersectIds(existing, scopedIds);
    if (intersected.length === 0) return false;
    whereClause[key] = { in: intersected };
  } else {
    whereClause[key] = { in: scopedIds };
  }

  return true;
}

/** Apply district filter to a loan-level Prisma where clause. False when no rows match. */
export async function applyDistrictFilterToLoanWhere(
  whereClause: Record<string, unknown>,
  districtCode: number | null
): Promise<boolean> {
  if (districtCode == null) return true;

  const borrowerIds = await getBorrowerIdsForDistrictCode(districtCode);
  return applyIdScope(whereClause, 'borrowerId', borrowerIds);
}

/** Apply district filter to nested `loan` relation filters (journal entries, payments, etc.). */
export function applyDistrictFilterToNestedLoan(
  whereClause: Record<string, unknown>,
  borrowerIds: string[],
  loanKey = 'loan'
): void {
  const loan = (whereClause[loanKey] as Record<string, unknown> | undefined) ?? {};
  const existing = (loan.borrowerId as { in?: string[] } | undefined)?.in;

  if (borrowerIds.length === 0) {
    whereClause[loanKey] = { ...loan, borrowerId: { in: [] } };
    return;
  }

  whereClause[loanKey] = {
    ...loan,
    borrowerId: {
      in: existing?.length ? intersectIds(existing, borrowerIds) : borrowerIds,
    },
  };
}

export async function resolveDistrictBorrowerIds(
  districtCode: number | null
): Promise<string[] | null> {
  if (districtCode == null) return null;
  return getBorrowerIdsForDistrictCode(districtCode);
}

/**
 * Guard a single farmer against the caller's district. Callers that already
 * hold the farmer's district code should compare directly instead.
 */
export function isFarmerInDistrict(
  farmerDistrictCode: number | null | undefined,
  districtCode: number | null
): boolean {
  if (districtCode == null) return true;
  return farmerDistrictCode === districtCode;
}
