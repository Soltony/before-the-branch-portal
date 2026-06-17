"use server";

import { getUserFromSession } from "@/lib/user";
import { ApprovalsClient } from "./client";
import prisma from "@/lib/prisma";
import type { PendingChange, User } from "@prisma/client";

const ITEMS_PER_PAGE = 10;

export type PendingChangeWithDetails = PendingChange & {
  createdBy: User;
  entityName: string;
  providerName?: string;
};

export type PaginatedPendingChanges = {
  data: PendingChangeWithDetails[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

async function getPendingChanges(
  page: number = 1
): Promise<PaginatedPendingChanges> {
  const skip = (page - 1) * ITEMS_PER_PAGE;

  const [total, changes] = await Promise.all([
    prisma.pendingChange.count({
      where: {
        status: "PENDING",
        // Exclude reversal-related and payment-resolve entity types - they have their own pages
        entityType: { notIn: ["DisbursementReversal", "DisbursementCancel", "LoanReversal", "LoanCancel", "PendingPaymentResolve"] },
      },
    }),
    prisma.pendingChange.findMany({
      where: {
        status: "PENDING",
        // Exclude reversal-related and payment-resolve entity types - they have their own pages
        entityType: { notIn: ["DisbursementReversal", "DisbursementCancel", "LoanReversal", "LoanCancel", "PendingPaymentResolve"] },
      },
      include: {
        // Only select non-sensitive fields for the creating user to avoid returning password hashes
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
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: ITEMS_PER_PAGE,
    }),
  ]);

  const providerIds = changes
    .map((c) => {
      try {
        const data = JSON.parse(c.payload);
        return (
          data.created?.providerId ||
          data.updated?.providerId ||
          data.original?.providerId
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const providers = await prisma.loanProvider.findMany({
    where: { id: { in: providerIds } },
    select: { id: true, name: true },
  });
  const providerMap = new Map(providers.map((p) => [p.id, p.name]));

  // Remove known sensitive fields (password hashes etc.) from payloads
  const removeSensitiveFields = (obj: any): any => {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(removeSensitiveFields);
    const out: any = {};
    for (const k of Object.keys(obj)) {
      if (
        k === "password" ||
        k.toLowerCase().includes("password") ||
        k === "passwordHash" ||
        k === "hashedPassword" ||
        k === "pass"
      ) {
        continue;
      }
      const v = obj[k];
      out[k] =
        typeof v === "object" && v !== null ? removeSensitiveFields(v) : v;
    }
    return out;
  };

  const sanitizePayloadForDisplay = (
    entityType: string,
    payloadStr: string
  ) => {
    try {
      if (
        entityType === "EligibilityList" ||
        entityType === "DataProvisioningUpload"
      )
        return payloadStr;
      const parsed = JSON.parse(payloadStr);
      const removeFileContent = (obj: any) => {
        if (!obj || typeof obj !== "object") return obj;
        if (Array.isArray(obj)) return obj.map(removeFileContent);
        const out: any = {};
        for (const k of Object.keys(obj)) {
          if (k === "fileContent") continue;
          const v = obj[k];
          out[k] = removeFileContent(v);
        }
        return out;
      };
      ["created", "updated", "original"].forEach((p) => {
        if (parsed[p]) {
          parsed[p] = removeFileContent(parsed[p]);
          parsed[p] = removeSensitiveFields(parsed[p]);
        }
      });
      const sanitized = removeSensitiveFields(parsed);
      return JSON.stringify(sanitized);
    } catch (e) {
      return payloadStr;
    }
  };

  const detailedChanges = changes.map((change) => {
    // sanitize payload for display so we don't show raw fileContent in product/provider diffs
    change.payload = sanitizePayloadForDisplay(
      change.entityType,
      change.payload
    );

    let entityName = change.entityId || "N/A";
    let providerName: string | undefined = undefined;

    try {
      const data = JSON.parse(change.payload);
      const target = data.created || data.updated || data.original;

      if (target) {
        entityName = target.name || change.entityId || "Unnamed";
        if (change.entityType === "ScoringRules") {
          entityName = "Scoring Rules";
        }

        const pId = target.providerId;
        if (pId && providerMap.has(pId)) {
          providerName = providerMap.get(pId);
        } else if (change.entityType === "LoanProvider") {
          providerName = target.name;
        }
      } else if (change.entityType === "DataProvisioningUpload") {
        entityName = data.created.fileName;
      }
    } catch (e) {
      console.error(`Failed to parse payload for change ${change.id}:`, e);
    }

    return {
      ...change,
      entityName,
      providerName,
    } as PendingChangeWithDetails;
  });

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return {
    data: detailedChanges,
    total,
    page,
    pageSize: ITEMS_PER_PAGE,
    totalPages,
  };
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { page?: string } | Promise<{ page?: string }>;
}) {
  const user = await getUserFromSession();
  if (!user) {
    return <div>Not authenticated</div>;
  }
  
  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, parseInt(resolvedSearchParams?.page || "1", 10));
  const paginatedData = await getPendingChanges(page);

  return <ApprovalsClient paginatedData={paginatedData} currentUser={user} />;
}
