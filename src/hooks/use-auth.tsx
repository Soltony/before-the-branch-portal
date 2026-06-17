
'use client';

import React, {
  useState,
  useEffect,
  createContext,
  useContext,
  useMemo,
  useCallback,
} from 'react';
import type { getCurrentUser } from '@/lib/session';

// Define a user type that matches the structure returned by getUserFromSession
export type AuthenticatedUser = Awaited<ReturnType<typeof getUserFromSession>>;

interface AuthContextType {
  currentUser: AuthenticatedUser | null;
  setCurrentUser: (user: AuthenticatedUser | null) => void;
  login: (phoneNumber: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  setCurrentUser: () => {},
  login: async () => {},
  logout: async () => {},
  isLoading: true,
  refetchUser: () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
    children: React.ReactNode;
    initialUser?: AuthenticatedUser | null;
}

export const AuthProvider = ({ children, initialUser = null }: AuthProviderProps) => {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(initialUser);
  const [isLoading, setIsLoading] = useState(initialUser === undefined);

  useEffect(() => {
    if(initialUser !== undefined) {
      setCurrentUser(initialUser);
      setIsLoading(false);
    }
  }, [initialUser]);


  const login = useCallback(
    async (phoneNumber: string, password: string) => {
      setIsLoading(true);
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({phoneNumber, password}),
      });

      if (!response.ok) {
        setIsLoading(false);
        const errorData = await response.json().catch(() => ({ error: 'Login failed' }));
        // Build a user-friendly message including validation issues if present
        let message = errorData.error || 'Login failed';
        if (errorData.issues) {
          try {
            const issuesText = Array.isArray(errorData.issues)
              ? errorData.issues.map((i: any) => i.message || JSON.stringify(i)).join('; ')
              : String(errorData.issues);
            message = `${message}: ${issuesText}`;
          } catch (e) {
            // ignore formatting errors
          }
        }

        // Include rate-limit/backoff details in the message and as properties on the Error
        if (typeof errorData.retriesLeft !== 'undefined') {
          message = `${message} (${errorData.retriesLeft} attempts left)`;
        }
        if (typeof errorData.delaySeconds !== 'undefined' && errorData.delaySeconds > 0) {
          message = `${message} (delay ${errorData.delaySeconds}s)`;
        }
        if (typeof errorData.retryAfter !== 'undefined') {
          message = `${message} (retry after ${errorData.retryAfter}s)`;
        }

        const err = new Error(message);
        (err as any).issues = errorData.issues;
        (err as any).retriesLeft = errorData.retriesLeft;
        (err as any).delaySeconds = errorData.delaySeconds;
        (err as any).retryAfter = errorData.retryAfter;
        throw err;
      }

      // After successful login, refetch user data to update context
      // This MUST be awaited to ensure the session is updated before redirection.
      await refetchUser();
      
      setIsLoading(false);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout failed:', error)
    } finally {
        setCurrentUser(null);
    }
  }, []);
  
  const refetchUser = useCallback(async () => {
    try {
      setIsLoading(true);
      const userRes = await fetch('/api/auth/user');
      if (userRes.ok) {
        const user = await userRes.json();
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
      }
    } catch (error) {
      console.error('Failed to refetch user:', error);
      setCurrentUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);


  const value = useMemo(
    () => ({
      currentUser,
      setCurrentUser,
      login,
      logout,
      isLoading,
      refetchUser,
    }),
    [currentUser, login, logout, isLoading, refetchUser, setCurrentUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
