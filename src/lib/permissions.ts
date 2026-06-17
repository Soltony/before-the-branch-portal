import { allMenuItems } from './menu-items';
import type { Permissions } from './types';

export const PermissionSets = ['read', 'create', 'update', 'delete', 'approve'] as const;
export type PermissionSet = (typeof PermissionSets)[number];

function pascalOrCamelToKebab(name: string) {
  if (!name) return name;
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const MODULE_KEYS = allMenuItems.map((i) => i.label.toLowerCase().replace(/\s+/g, '-'));

// Explicit map from entity types to the module permission keys exposed in the UI.
const ENTITY_TO_MODULE: Record<string, string[]> = {
  loanprovider: ['settings', 'providers'],
  loanproduct: ['settings', 'products'],
  tax: ['tax', 'settings'],
  approval: ['approvals'],
  approvals: ['approvals'],
  pendingchange: ['approvals'],
  disbursementreversal: ['approvals', 'reversal-approval'],
  disbursementcancel: ['approvals', 'reversal-approval'],
  loanreversal: ['reversals', 'reversal-approval'],
  loancancel: ['reversals', 'reversal-approval'],
  pendingpaymentresolve: ['pending-payments', 'pending-payment-approvals', 'approvals'],
  eligibilitylist: ['settings'],
  dataprovisioningupload: ['settings', 'scoring-engine'],
  termsandconditions: ['settings'],
  loancycleconfig: ['settings'],
  dataprovisioningconfig: ['scoring-engine', 'settings'],
  scoringrules: ['scoring-engine'],
  smstemplate: ['sms-management'],
  smscampaign: ['sms-management'],
  smslog: ['sms-management'],
  fundreplenishment: ['revolving-fund'],
};

export function entityTypeToPermissionKeys(entityType: string) {
  const kebab = pascalOrCamelToKebab(entityType || '');
  const flat = (entityType || '').toLowerCase();
  const keys = new Set<string>();

  ENTITY_TO_MODULE[flat]?.forEach((k) => keys.add(k));

  // Heuristics limited to known module keys
  if (flat.includes('product') && MODULE_KEYS.includes('settings')) keys.add('settings');
  if (flat.includes('provider') && MODULE_KEYS.includes('settings')) keys.add('settings');
  if (flat.includes('tax') && MODULE_KEYS.includes('tax')) keys.add('tax');
  if ((flat.includes('approval') || flat.includes('approvals')) && MODULE_KEYS.includes('approvals')) {
    keys.add('approvals');
  }

  // Only allow direct matches that are valid module keys
  if (MODULE_KEYS.includes(kebab)) keys.add(kebab);
  if (MODULE_KEYS.includes(flat)) keys.add(flat);

  return Array.from(keys);
}

export function hasPermission(user: { permissions?: Permissions } | null | undefined, moduleKey: string, action: PermissionSet) {
  if (!user) return false;
  const perms = user.permissions || {};
  const key = moduleKey?.toLowerCase();
  return !!perms?.[key]?.[action];
}

export function hasPermissionForEntity(user: { permissions?: Permissions } | null | undefined, entityType: string, action: PermissionSet) {
  const keys = entityTypeToPermissionKeys(entityType);
  for (const k of keys) {
    if (hasPermission(user, k, action)) return true;
  }
  return false;
}
