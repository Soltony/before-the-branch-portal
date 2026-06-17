'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { CheckLoanEligibilityOutput } from '@/lib/types';

interface CreditScoreFormProps {
  onCheck: () => void;
  isLoading: boolean;
  result: CheckLoanEligibilityOutput | null;
}

export function CreditScoreForm({ onCheck, isLoading, result }: CreditScoreFormProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Check Your Loan Eligibility</CardTitle>
          <CardDescription>Click the button below to see what you may qualify for.</CardDescription>
        </CardHeader>
        <CardContent>
          {result && !result.isEligible && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Not Eligible for Loan</AlertTitle>
                <AlertDescription>
                  {result.reason || "We're sorry, but you are not eligible for a loan at this time."}
                </AlertDescription>
              </Alert>
          )}
        </CardContent>
        <CardFooter>
          <Button onClick={onCheck} className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Check Eligibility
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
