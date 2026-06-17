"use server";

import { getUserFromSession } from "@/lib/user";
import prisma from "@/lib/prisma";
import type { PendingChange, User } from "@prisma/client";
import { PendingPaymentApprovalsClient } from "./client";

const ITEMS_PER_PAGE = 10;

export type PendingPaymentApproval = PendingChange & {
  createdBy: Pick<
    User,
    | "id"
    | "fullName"
    | "email"
    | "phoneNumber"
    | "roleId"
    | "loanProviderId"
    | "status"
    | "passwordChangeRequired"
    | "createdAt"
  >;
  entityName: string;
  providerName?: string;
};

export type PaginatedPendingPaymentApprovals = {
  data: PendingPaymentApproval[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

async function getPendingPaymentApprovals(
  page: number = 1
): Promise<PaginatedPendingPaymentApprovals> {
  const skip = (page - 1) * ITEMS_PER_PAGE;

  const [total, changes] = await Promise.all([
    prisma.pendingChange.count({
      where: {
        status: "PENDING",
        entityType: "PendingPaymentResolve",
      },
    }),
    prisma.pendingChange.findMany({
      where: {
        status: "PENDING",
        entityType: "PendingPaymentResolve",
      },
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            roleId: true,
            loanProviderId: true,
            status: true,
            passwordChangeRequired: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: ITEMS_PER_PAGE,
    }),
  ]);

  const detailed = changes.map((change) => {
    let entityName = change.entityId || "N/A";
    let providerName: string | undefined;

    try {
      const data = JSON.parse(change.payload);
      const created = data?.created;
      if (created) {
        const borrowerId = created.borrowerId
          ? String(created.borrowerId)
          : null;
        const loanId = created.loanId ? String(created.loanId) : null;
        const amount = created.amount != null ? Number(created.amount) : null;
        const ftRef = created.ftReference
          ? String(created.ftReference)
          : null;

        entityName =
          [
            borrowerId ? `Borrower ${borrowerId}` : null,
            loanId ? `Loan ${loanId}` : null,
            amount != null ? `Amt ${amount}` : null,
            ftRef ? `FT ${ftRef}` : null,
          ]
            .filter(Boolean)
            .join(" • ") || entityName;

        if (created.providerName) {
          providerName = String(created.providerName);
        }
      }
    } catch {
      // ignore
    }

    return {
      ...change,
      entityName,
      providerName,
    } as PendingPaymentApproval;
  });

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return {
    data: detailed,
    total,
    page,
    pageSize: ITEMS_PER_PAGE,
    totalPages,
  };
}

export default async function PendingPaymentApprovalsPage({
  searchParams,
}: {
  searchParams: { page?: string } | Promise<{ page?: string }>;
}) {
  const user = await getUserFromSession();
  if (!user) return <div>Not authenticated</div>;

  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, parseInt(resolvedSearchParams?.page || "1", 10));
  const paginatedData = await getPendingPaymentApprovals(page);

  return (
    <PendingPaymentApprovalsClient
      paginatedData={paginatedData}
      currentUser={user}
    />
  );
}
