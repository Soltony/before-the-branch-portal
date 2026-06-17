'use server';

import { getUserFromSession } from '@/lib/user';
import ApprovalsDetailClient from './client';
import prisma from '@/lib/prisma';
import type { PendingChange } from '@prisma/client';

const removeSensitiveFields = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(removeSensitiveFields);
  const out: any = {};
  for (const k of Object.keys(obj)) {
    if (k === 'password' || k.toLowerCase().includes('password') || k === 'passwordHash' || k === 'hashedPassword' || k === 'pass') continue;
    const v = obj[k];
    out[k] = (typeof v === 'object' && v !== null) ? removeSensitiveFields(v) : v;
  }
  return out;
};

const sanitizePayloadKeepFiles = (payloadStr: string) => {
  try {
    const parsed = JSON.parse(payloadStr);
    ['created', 'updated', 'original'].forEach((p) => {
      if (parsed[p]) parsed[p] = removeSensitiveFields(parsed[p]);
    });
    return JSON.stringify(parsed);
  } catch (e) {
    return payloadStr;
  }
};

export type PendingChangeWithDetails = PendingChange & {
  createdBy: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    roleId: string;
    loanProviderId: string | null;
    status: string;
    passwordChangeRequired: boolean;
    createdAt: Date;
  };
  entityName: string;
  providerName?: string | null;
};

export default async function ApprovalDetailPage({ params }: { params: any }) {
  const user = await getUserFromSession();
  if (!user) return <div>Not authenticated</div>;
  // `params` may be a Promise in newer Next.js versions — unwrap it safely.
  const resolvedParams = await params;
  const id = resolvedParams?.id;
  if (!id) return <div>Missing approval id</div>;
  const change = await prisma.pendingChange.findUnique({
    where: { id },
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
        }
      }
    }
  });

  if (!change) return <div>Change not found</div>;

  // sanitize payload for display but keep fileContent for uploads
  let payload = sanitizePayloadKeepFiles(change.payload);

  let entityName = change.entityId || 'N/A';
  let providerName: string | undefined = undefined;

  try {
    const data = JSON.parse(payload);
    const target = data.created || data.updated || data.original;
    if (target) {
      entityName = target.name || change.entityId || 'Unnamed';
      const pId = target.providerId;
      if (pId) {
        const provider = await prisma.loanProvider.findUnique({ where: { id: pId }, select: { name: true } });
        providerName = provider?.name;
      } else if (change.entityType === 'LoanProvider') {
        providerName = target.name;
      } else if (change.entityType === 'ScoringRules' && change.entityId) {
        const provider = await prisma.loanProvider.findUnique({ where: { id: change.entityId }, select: { name: true } });
        providerName = provider?.name;
      } else if (change.entityType === 'DataProvisioningUpload') {
        // For uploads we receive entityId as the config id; look up the config to find its provider
        const cfgId = (target && (target.configId || target.config?.id)) || change.entityId;
        if (cfgId) {
          const cfg = await prisma.dataProvisioningConfig.findUnique({ where: { id: String(cfgId) }, select: { providerId: true } });
          if (cfg?.providerId) {
            const provider = await prisma.loanProvider.findUnique({ where: { id: cfg.providerId }, select: { name: true } });
            providerName = provider?.name;
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to parse payload for detail page', e);
  }

  // Replace any providerId occurrences within payload with friendly provider names
  try {
    const parsed = JSON.parse(payload);
    const foundIds = new Set<string>();
    const collectProviderIds = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) return obj.forEach(collectProviderIds);
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (k === 'providerId' && typeof v === 'string') foundIds.add(v);
        else if (typeof v === 'object' && v !== null) collectProviderIds(v);
      }
    };
    ['created', 'updated', 'original'].forEach((p) => collectProviderIds(parsed[p]));

    if (foundIds.size > 0) {
      const providers = await prisma.loanProvider.findMany({ where: { id: { in: Array.from(foundIds) } }, select: { id: true, name: true } });
      const map = new Map(providers.map(p => [p.id, p.name]));

      const replaceIds = (obj: any): any => {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(replaceIds);
        const out: any = {};
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (k === 'providerId' && typeof v === 'string') {
            out[k] = map.get(v) ?? v;
          } else if (typeof v === 'object' && v !== null) {
            out[k] = replaceIds(v);
          } else {
            out[k] = v;
          }
        }
        return out;
      };

      ['created', 'updated', 'original'].forEach((p) => {
        if (parsed[p]) parsed[p] = replaceIds(parsed[p]);
      });

      // stringify back and overwrite payload with provider-name substituted version
      payload = JSON.stringify(parsed);
    }
  } catch (e) {
    // ignore
  }

  const detailed: PendingChangeWithDetails = {
    ...change,
    payload,
    entityName,
    providerName,
  };

  // convert dates to strings for client serialization
  (detailed as any).createdAt = detailed.createdAt ? new Date(detailed.createdAt).toISOString() : null;
  (detailed as any).updatedAt = detailed.updatedAt ? new Date(detailed.updatedAt).toISOString() : null;

  return <ApprovalsDetailClient change={detailed} currentUser={user} />;
}
