

'use server';

import { getSession, deleteSession } from './session';
import prisma from './prisma';
import type { User as AuthUser, Permissions } from '@/lib/types';
import { Prisma } from '@prisma/client';

export async function getUserFromSession(options?: { allowRefresh?: boolean }): Promise<AuthUser | null> {
  try {
    let session = await getSession({ allowRefresh: options?.allowRefresh });

    // If we're in a context where cookies cannot be modified (Server Components),
    // Next.js throws when getSession tries to rotate/set cookies. Retry in no-refresh mode.
    // This preserves auth checks without performing token rotation.
    if (!session) {
      return null;
    }

    if (!session?.userId) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        role: true,
        loanProvider: true,
      },
    });

    if (!user) {
      return null;
    }
    
    if (user.status === 'Inactive') {
        try {
          await deleteSession();
        } catch (_) {
          // ignore in contexts where cookie mutation is not allowed
        }
        return null;
    }
    
    const { password, ...userWithoutPassword } = user;
    
    const authUser: AuthUser = {
      ...userWithoutPassword,
      role: user.role.name as AuthUser['role'],
      providerName: user.loanProvider?.name,
      permissions: JSON.parse(user.role.permissions as string) as Permissions,
      passwordChangeRequired: user.passwordChangeRequired,
    };

    return authUser;

  } catch (error) {
    const msg = (error as any)?.message ? String((error as any).message) : '';
    if (msg.includes('Cookies can only be modified in a Server Action or Route Handler')) {
      try {
        const session = await getSession({ allowRefresh: false });
        if (!session?.userId) return null;

        const user = await prisma.user.findUnique({
          where: { id: session.userId },
          include: { role: true, loanProvider: true },
        });
        if (!user) return null;
        if (user.status === 'Inactive') return null;

        const { password, ...userWithoutPassword } = user;
        const authUser: AuthUser = {
          ...userWithoutPassword,
          role: user.role.name as AuthUser['role'],
          providerName: user.loanProvider?.name,
          permissions: JSON.parse(user.role.permissions as string) as Permissions,
          passwordChangeRequired: user.passwordChangeRequired,
        };
        return authUser;
      } catch (_) {
        return null;
      }
    }
    const e = error as any;
    if (e && (e.name === 'PrismaClientKnownRequestError' || typeof e.code === 'string')) {
    }
    console.error('Get User Error:', error);
    return null;
  }
}

// Re-export cookies from next/headers to be used in server components
import { cookies } from 'next/headers';
export { cookies };
