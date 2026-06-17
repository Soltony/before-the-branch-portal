'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './use-auth';

export function useRequirePermission(moduleName: string | string[]) {
  const { currentUser, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!currentUser) {
      router.replace('/admin/login');
      return;
    }

    const moduleNames = Array.isArray(moduleName) ? moduleName : [moduleName];
    const allowed = moduleNames.some(
      (name) => !!currentUser.permissions?.[name]?.read
    );
    if (!allowed) {
      router.replace('/admin/forbidden');
    }
  }, [currentUser, isLoading, moduleName, router]);
}
