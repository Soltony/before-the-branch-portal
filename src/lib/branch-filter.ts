import prisma from './prisma';

export function getBranchCodeFromUser(user: {
  role?: string;
  branchCode?: number | null;
}): number | null {
  if (user.role !== 'Branch' || user.branchCode == null) return null;
  return user.branchCode;
}

export async function getBorrowerIdsForBranchCode(branchCode: number): Promise<string[]> {
  const patterns = [
    `"Branchcode":${branchCode}`,
    `"Branchcode": ${branchCode}`,
    `"branchcode":${branchCode}`,
    `"branchcode": ${branchCode}`,
  ];

  const rows = await prisma.provisionedData.findMany({
    where: { OR: patterns.map((p) => ({ data: { contains: p } })) },
    select: { borrowerId: true },
  });

  return [...new Set(rows.map((r) => r.borrowerId))];
}

function intersectBorrowerIds(existing: string[], branchBorrowerIds: string[]): string[] {
  const set = new Set(branchBorrowerIds);
  return existing.filter((id) => set.has(id));
}

/** Apply branch filter to a loan-level Prisma where clause. Returns false when no rows match. */
export async function applyBranchFilterToLoanWhere(
  whereClause: Record<string, unknown>,
  branchCode: number | null
): Promise<boolean> {
  if (branchCode == null) return true;

  const borrowerIds = await getBorrowerIdsForBranchCode(branchCode);
  if (borrowerIds.length === 0) return false;

  const existing = (whereClause.borrowerId as { in?: string[] } | undefined)?.in;
  if (existing?.length) {
    const intersected = intersectBorrowerIds(existing, borrowerIds);
    if (intersected.length === 0) return false;
    whereClause.borrowerId = { in: intersected };
  } else {
    whereClause.borrowerId = { in: borrowerIds };
  }

  return true;
}

/** Apply branch filter to nested `loan` relation filters (journal entries, payments, etc.). */
export function applyBranchFilterToNestedLoan(
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

  if (existing?.length) {
    whereClause[loanKey] = {
      ...loan,
      borrowerId: { in: intersectBorrowerIds(existing, borrowerIds) },
    };
  } else {
    whereClause[loanKey] = { ...loan, borrowerId: { in: borrowerIds } };
  }
}

export async function resolveBranchBorrowerIds(
  branchCode: number | null
): Promise<string[] | null> {
  if (branchCode == null) return null;
  return getBorrowerIdsForBranchCode(branchCode);
}
