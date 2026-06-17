
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const { toast } = useToast();
  
  const COMMON_PASSWORDS = new Set([
    '123456','123456789','qwerty','password','1234567','12345678','12345','111111','123123','password1','1234567890','1234','welcome','letmein','admin','iloveyou'
  ]);

  function validatePasswordClient(pw: string) {
    if (!pw || pw.length < 8) return 'Password must be at least 8 characters long.';
    if (!/(?=.*[a-z])/.test(pw)) return 'Password must contain a lowercase letter.';
    if (!/(?=.*[A-Z])/.test(pw)) return 'Password must contain an uppercase letter.';
    if (!/(?=.*\d)/.test(pw)) return 'Password must contain a number.';
    if (!/(?=.*[^A-Za-z0-9])/.test(pw)) return 'Password must contain a symbol.';
    if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'Password is too common or compromised.';
    return null;
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    // Client-side validation (same rules as server except final breach check)
    const clientError = validatePasswordClient(newPassword);
    if (clientError) {
      setError(clientError);
      return;
    }

    setIsLoading(true);
    // Check pwned password via server helper endpoint before sending change request
    try {
      const pwnedRes = await fetch('/api/utils/pwned-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (pwnedRes.ok) {
        const pwnedData = await pwnedRes.json();
        if (pwnedData?.pwned) {
          setIsLoading(false);
          setError('Password has been found in a data breach. Please choose a more secure password.');
          return;
        }
      }
    } catch (err) {
      // If the pwned check fails, do not block the user; proceed and let server enforce.
      console.warn('Pwned password check failed', err);
    }
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to change password.');
      }

      toast({
        title: 'Password Changed Successfully',
        description: 'Please log in with your new password.',
      });
      
      // Log the user out and redirect to login
      await logout();
      router.push('/admin/login');
      router.refresh();

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/40">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Change Your Password</CardTitle>
          <CardDescription>
            For security reasons, you must change the temporary password provided to you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2 relative">
              <Label htmlFor="newPassword">New Password</Label>
               <Input
                id="newPassword"
                type={isPasswordVisible ? 'text' : 'password'}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-10"
              />
               <button
                type="button"
                onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                className="absolute right-3 top-9 h-5 w-5 text-muted-foreground"
              >
                {isPasswordVisible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
             <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Set New Password
             </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
