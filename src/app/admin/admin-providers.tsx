'use client';

import { AuthProvider } from '@/hooks/use-auth';
import type { AuthenticatedUser } from '@/hooks/use-auth';

interface AdminProvidersProps {
    children: React.ReactNode;
    initialUser: AuthenticatedUser | null;
}

export function AdminProviders({ children, initialUser }: AdminProvidersProps) {
    return (
        <AuthProvider initialUser={initialUser}>
            {children}
        </AuthProvider>
    );
}
