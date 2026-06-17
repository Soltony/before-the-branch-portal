'use client';

import { useMemo } from 'react';
import { useAuth } from './use-auth';
import { hasPermission, hasPermissionForEntity } from '@/lib/permissions';
import type { PermissionSet } from '@/lib/permissions';

export function usePermissions() {
  const { currentUser } = useAuth();

  const api = useMemo(() => {
    return {
      canModule: (moduleKey: string, action: PermissionSet) => hasPermission(currentUser, moduleKey, action),
      canEntity: (entityType: string, action: PermissionSet) => hasPermissionForEntity(currentUser, entityType, action),
      entityActions: (entityType: string) => ({
        read: hasPermissionForEntity(currentUser, entityType, 'read'),
        create: hasPermissionForEntity(currentUser, entityType, 'create'),
        update: hasPermissionForEntity(currentUser, entityType, 'update'),
        delete: hasPermissionForEntity(currentUser, entityType, 'delete'),
        approve: hasPermissionForEntity(currentUser, entityType, 'approve'),
      }),
    };
  }, [currentUser]);

  return api;
}
