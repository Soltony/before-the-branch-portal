
import { headers } from 'next/headers';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { Logo } from '@/components/icons';
import { ConnectClient } from './client';

const ErrorDisplay = ({ title, message }: { title: string, message: string }) => (
    <div className="flex items-center justify-center min-h-screen bg-muted/40">
        <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
                 <div className="flex justify-center mb-4">
                    <Logo className="h-10 w-10" />
                </div>
                <CardTitle className="text-2xl">Connection Failed</CardTitle>
                <CardDescription>
                    There was a problem authenticating your session.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{title}</AlertTitle>
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            </CardContent>
        </Card>
    </div>
);


export default async function ConnectPage() {
    const headersList = await headers();
    const authHeader = headersList.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
         return <ErrorDisplay title="Authentication Error" message="Authorization header is missing or malformed." />;
    }

    const superAppToken = authHeader;

    return <ConnectClient superAppToken={superAppToken} />;
}
