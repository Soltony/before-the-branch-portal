import { redirect } from 'next/navigation';
import { getUserFromSession } from './user';
import { PermissionSet, PermissionSets, entityTypeToPermissionKeys, hasPermission, hasPermissionForEntity } from './permissions';

export async function requireServerPermission(moduleName?: string, action: PermissionSet = 'read') {
  const user = await getUserFromSession();
  if (!user?.id) {
    redirect('/admin/login');
  }

  if (!moduleName) return;

  const allowed = !!user.permissions?.[moduleName]?.[action];
  if (!allowed) {
    redirect('/admin/forbidden');
  }
}

export { PermissionSets, entityTypeToPermissionKeys, hasPermission, hasPermissionForEntity };
export type { PermissionSet };
