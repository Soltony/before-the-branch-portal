
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export function ConnectClient({ superAppToken }: { superAppToken: string }) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const createSession = async () => {
            try {
                const response = await fetch('/api/auth/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ superAppToken }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    console.error('[loan/connect] /api/auth/connect failed', {
                        status: response.status,
                        errorData,
                    });

                    const parts: string[] = [];
                    parts.push(String(errorData?.error || 'Session creation failed.'));
                    if (errorData?.upstreamWwwAuthenticate) {
                        parts.push(`WWW-Authenticate: ${String(errorData.upstreamWwwAuthenticate)}`);
                    }
                    if (errorData?.upstreamBodySnippet) {
                        parts.push(`Upstream: ${String(errorData.upstreamBodySnippet)}`);
                    }

                    throw new Error(parts.join(' '));
                }
                
                const { borrowerId } = await response.json();
                
                if (!borrowerId) {
                    throw new Error('Borrower ID not returned from session creation.');
                }

                router.push(`/loan?borrowerId=${borrowerId}`);

            } catch (err: any) {
                setError(err.message);
            }
        };

        createSession();
    }, [superAppToken, router]);

    if (error) {
        return (
             <div className="flex items-center justify-center min-h-screen bg-muted/40 p-4">
                <Alert variant="destructive" className="max-w-md">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Connection Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            </div>
        )
    }

    return (
        <div className="flex flex-col min-h-screen bg-background items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <h2 className="text-xl font-semibold">Connecting...</h2>
                <p className="text-muted-foreground">Establishing secure session.</p>
            </div>
        </div>
    );
}
