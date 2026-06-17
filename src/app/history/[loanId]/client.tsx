
'use client';

import React, { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { LoanDetails } from '@/lib/types';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const formatCurrency = (amount: number | null | undefined) => {  
    if (amount === null || amount === undefined) return '0.00';
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
};


interface LoanDetailClientProps {
    loanDetails: LoanDetails;
}

export function LoanDetailClient({ loanDetails }: LoanDetailClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleBack = () => {
        const params = new URLSearchParams(searchParams.toString());
        router.push(`/history?${params.toString()}`);
    }

    const { total, principal, interest, penalty, serviceFee, tax } = useMemo(() => {
        if (loanDetails.calculatedRepayment) {
            return loanDetails.calculatedRepayment;
        }
        // Fallback for older data that might not have the pre-calculated value
        const estimate = {
            total: loanDetails.loanAmount + loanDetails.serviceFee,
            principal: loanDetails.loanAmount,
            interest: 0,
            penalty: 0,
            serviceFee: loanDetails.serviceFee,
            tax: 0,
        };
        return estimate;
    }, [loanDetails]);

    const totalOutstanding = Math.max(0, total - (loanDetails.repaidAmount || 0));
    const isPaid = loanDetails.repaymentStatus === 'Paid' || totalOutstanding <= 0.01;
    
    const providerColor = loanDetails.product.provider?.colorHex || '#fdb913';

    return (
        <div className="flex flex-col min-h-screen bg-gray-50">
            <main className="flex-1">
                <div className="container py-6 md:py-10 max-w-2xl mx-auto">
                    <Card>
                        <CardHeader>
                             <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-sm text-muted-foreground">Contract No.</p>
                                    <p className="font-mono">{loanDetails.id}</p>
                                </div>
                                 <div className="text-right">
                                    <p className="text-sm text-muted-foreground">Contract Status</p>
                                    <Badge variant={isPaid ? 'default' : 'destructive'} className={cn(isPaid && 'bg-green-600 text-white')}>
                                        {isPaid ? 'Paid' : loanDetails.repaymentStatus}
                                    </Badge>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-2 gap-4 text-center">
                                <div>
                                    <p className="text-sm text-muted-foreground">Total Credit Amount (ETB)</p>
                                    <p className="text-2xl font-bold">{formatCurrency(loanDetails.loanAmount)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Total Outstanding (ETB)</p>
                                    <p className="text-2xl font-bold">{formatCurrency(totalOutstanding)}</p>
                                </div>
                            </div>

                            <Card className="bg-muted/50">
                                <CardContent className="p-4 space-y-3 text-sm">
                                    <div className="flex justify-between"><span>Principal (ETB)</span> <span className="font-medium">{formatCurrency(principal)}</span></div>
                                    <div className="flex justify-between"><span>Service Fee ({loanDetails.product.serviceFee.type === 'percentage' ? `${loanDetails.product.serviceFee.value}%` : 'Fixed'})</span> <span className="font-medium">{formatCurrency(serviceFee)}</span></div>
                                    <div className="flex justify-between"><span>Daily Fee</span> <span className="font-medium">{formatCurrency(interest)}</span></div>
                                    <div className="flex justify-between"><span>Penalty Fee</span> <span className="font-medium">{formatCurrency(penalty)}</span></div>
                                    {tax > 0 && <div className="flex justify-between"><span>Tax</span> <span className="font-medium">{formatCurrency(tax)}</span></div>}
                                </CardContent>
                            </Card>

                            <div>
                                <h3 className="font-semibold mb-2">Due Date</h3>
                                <Card>
                                    <CardContent className="p-4 text-sm">
                                        <div className="flex justify-between items-center">
                                            <p className="text-muted-foreground">Due</p>
                                            <p className="font-medium">{format(loanDetails.dueDate, 'yyyy-MM-dd')}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                            
                             <div>
                                <h3 className="font-semibold mb-2">Transaction Details</h3>
                                <Card>
                                     <CardContent className="p-4 divide-y">
                                        {loanDetails.payments.map(payment => (
                                             <div key={payment.id} className="py-3 flex justify-between items-center">
                                                 <div>
                                                    <p className="font-medium">Repayment (ETB)</p>
                                                    <p className="text-xs text-muted-foreground">{format(payment.date, 'yyyy-MM-dd HH:mm:ss')}</p>
                                                 </div>
                                                 <p className="font-mono text-green-600 font-semibold text-right">+ {formatCurrency(payment.amount)}</p>
                                             </div>
                                        ))}
                                        {loanDetails.payments.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No repayments made yet.</p>}
                                    </CardContent>
                                </Card>
                            </div>

                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
