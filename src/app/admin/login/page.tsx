
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AdminLoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const { toast } = useToast();
  
  const nibBankColor = '#fdb913';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setLockSeconds(0);
    try {
      await login(phoneNumber, password);
      router.push('/admin');
      router.refresh(); // This is important to re-fetch server-side data
      toast({
        title: 'Login Successful',
        description: 'Welcome back!',
      });
    } catch (err: any) {
      // Show server message as-is to avoid duplicated attempt/delay info.
      const delay = typeof err.retryAfter === 'number'
        ? err.retryAfter
        : (typeof err.delaySeconds === 'number' ? err.delaySeconds : undefined);
      if (typeof delay === 'number' && delay > 0) {
        setLockSeconds(delay);
      }
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  // Countdown timer for lockout/backoff
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockSeconds((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  const disableSubmit = useMemo(() => isLoading || lockSeconds > 0, [isLoading, lockSeconds]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
                <Image src="https://play-lh.googleusercontent.com/HR87m6M2_7ZmPGrSp_MSlmfG5uyx94iYthItSzrmWVgFWkJ3FPTOYCLPw0F_ul4mYg" alt="Logo" width={40} height={40} className="h-10 w-10" />
            </div>
          <CardTitle className="text-2xl">Admin Login</CardTitle>
          <CardDescription>
            Enter your credentials to access the admin dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Login Failed</AlertTitle>
                <AlertDescription>
                  <div>{error}</div>
                  {lockSeconds > 0 && (
                    <div className="text-sm mt-1">
                      Please wait {lockSeconds}s before trying again.
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder="e.g., 0912345678"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2 relative">
              <Label htmlFor="password">Password</Label>
               <Input
                id="password"
                type={isPasswordVisible ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
             <Button type="submit" className="w-full text-white" disabled={disableSubmit} style={{ backgroundColor: nibBankColor }}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
             </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
