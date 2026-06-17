

'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { LoanProduct, LoanDetails, FeeRule, Tax, PenaltyRule } from '@/lib/types';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { calculateInstallmentDueBreakdown, calculateTotalRepayableDetailed } from '@/lib/loan-calculator';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';

const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
};

const formatFee = (feeRule: FeeRule | undefined, suffix?: string): string => {
    if (!feeRule || feeRule.value === '' || feeRule.value === null) return 'N/A';
    const numericValue = Number(feeRule.value);
    if (isNaN(numericValue)) return 'N/A';

    if (feeRule.type === 'percentage') {
        return `${numericValue}%${suffix || ''}`;
    }
    return formatCurrency(numericValue) + ' ETB';
};

const formatPenaltyRule = (rule: PenaltyRule | undefined, type: 'summary' | 'full' = 'full'): string => {
    if (!rule || rule.value === '' || rule.value === null) return 'N/A';
    const value = Number(rule.value);
    if (isNaN(value)) return 'N/A';

    let valueString = '';
    if (rule.type === 'fixed') {
        valueString = formatCurrency(value) + ' ETB';
    } else {
        valueString = `${value}%`;
    }

    if (type === 'summary') {
        return `${valueString} ${rule.frequency || 'daily'}`;
    }

    let conditionString = '';
    if (rule.type === 'percentageOfPrincipal') {
        valueString += ' of principal';
    } else if (rule.type === 'percentageOfCompound') {
        valueString += ' of outstanding';
    }
    
    const fromDay = rule.fromDay === '' ? 1 : Number(rule.fromDay);
    const toDay = rule.toDay === '' || rule.toDay === null ? Infinity : Number(rule.toDay);

    if (toDay === Infinity) {
        conditionString = ` from day ${fromDay} onwards`;
    } else {
        conditionString = ` from day ${fromDay} to day ${toDay}`;
    }

    return `${valueString}${conditionString}`;
}

const taxComponentLabels: Record<string, string> = {
    serviceFee: 'Service Fee',
    interest: 'Daily Fee',
};

interface ProductCardProps {
    product: LoanProduct;
    taxConfigs: Tax[];
    providerColor?: string;
    activeLoan?: LoanDetails;
    onApply: () => void;
    onRepay: (loan: LoanDetails, balanceDue: number) => void;
    IconDisplayComponent: React.ComponentType<{ iconName: string, className?: string }>;
    isEligible: boolean;
    eligibilityReason: string;
    availableToBorrow: number;
    asOfDate: Date;
}

export function ProductCard({ 
    product, 
    taxConfigs,
    providerColor = '#fdb913', 
    activeLoan, 
    onApply, 
    onRepay, 
    IconDisplayComponent,
    isEligible,
    eligibilityReason,
    availableToBorrow,
    asOfDate
}: ProductCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    
    const activeInstallment = activeLoan && Array.isArray((activeLoan as any).installments) ? (activeLoan as any).installments.find((i: any) => i.isActive) : undefined;
    const mergedNextInstallment = activeLoan && activeInstallment && Array.isArray((activeLoan as any).installments)
        ? (activeLoan as any).installments.find((i: any) => i && i.status === 'Merged' && i.installmentNumber === activeInstallment.installmentNumber + 1)
        : undefined;
    const isOverdue = activeInstallment ? asOfDate > new Date(activeInstallment.dueDate) : (activeLoan ? asOfDate > new Date(activeLoan.dueDate) : false);

    const balanceDue = useMemo(() => {
        if (!activeLoan) return 0;
        
        // Calculate total repayable using asOfDate with detailed breakdown
        const totals = calculateTotalRepayableDetailed(activeLoan, activeLoan.product, taxConfigs, asOfDate);
        
        // For installment-based loans, only show the CURRENT installment amount due
        if (Array.isArray((activeLoan as any).installments) && (activeLoan as any).installments.length > 0) {
            const installments = (activeLoan as any).installments;
            const activeInst = installments.find((i: any) => i.isActive);
            if (activeInst) {
                const due = calculateInstallmentDueBreakdown({
                    loanDetails: activeLoan,
                    loanProduct: activeLoan.product,
                    taxConfigs,
                    activeInstallment: activeInst,
                    asOfDate,
                });
                return Math.max(0, due.totalDue);
            }
        }
        
        // For non-installment loans, use accurate paid amounts from detailed calculation
        const alreadyRepaid = activeLoan.repaidAmount || 0;
        const remainingBalance = totals.total - alreadyRepaid;
        return Math.max(0, remainingBalance);
    }, [activeLoan, taxConfigs, asOfDate]);

    const trueAvailableLimit = useMemo(() => {
        // The available limit for this specific product is the smaller of the product's general
        // available limit and the user's overall available credit.
        return Math.min(product.availableLimit || 0, availableToBorrow);
    }, [product.availableLimit, availableToBorrow]);

    const maxPenaltyRule = useMemo(() => {
        if (!product.penaltyRules || product.penaltyRules.length === 0) return undefined;
        return product.penaltyRules.reduce((maxRule, currentRule) => {
            const maxValue = Number(maxRule.value) || 0;
            const currentValue = Number(currentRule.value) || 0;
            return currentValue > maxValue ? currentRule : maxRule;
        }, product.penaltyRules[0]);
    }, [product.penaltyRules]);

    const applicableTax = useMemo(() => {
        if (!taxConfigs || taxConfigs.length === 0) return null;
        // For simplicity, we'll assume the first tax config is the one to display.
        // A more complex system might link specific taxes to products.
        const tax = taxConfigs[0];
        const appliedTo = JSON.parse(tax.appliedTo || '[]') as string[];
        const isTaxable = appliedTo.some(item => ['serviceFee', 'interest'].includes(item));
        
        if (!isTaxable) return null;

        const taxableComponents = appliedTo
            .map(component => taxComponentLabels[component])
            .filter(Boolean);
        
        let componentsString = '';
        if (taxableComponents.length === 1) {
            componentsString = taxableComponents[0];
        } else if (taxableComponents.length > 1) {
            const last = taxableComponents.pop();
            componentsString = `${taxableComponents.join(', ')} & ${last}`;
        }
        
        return {
            ...tax,
            componentsString
        };
    }, [taxConfigs]);


    const applyButton = (
        <Button 
            onClick={onApply} 
            style={{ backgroundColor: `${providerColor}20`, color: providerColor, borderColor: providerColor }} 
            className="text-white border"
            size="sm"
            variant="outline"
            disabled={!isEligible || availableToBorrow <= 0}
        >
            Apply
        </Button>
    );

    if (activeLoan) {
        const instOutstanding = activeInstallment ? Math.max(0, (activeInstallment.amount || 0) - (activeInstallment.paidAmount || 0)) : null;
        const instPenalty = activeInstallment ? Math.max(0, activeInstallment.penaltyAmount || 0) : 0;
        return (
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-lg font-bold" style={{ color: providerColor }}>{product.name}</p>
                            <p className="text-sm text-muted-foreground">
                                Due Date: {activeInstallment ? format(new Date(activeInstallment.dueDate), 'yyyy-MM-dd') : format(new Date(activeLoan.dueDate), 'yyyy-MM-dd')}
                                {isOverdue && <span className="text-red-500 ml-2 font-semibold">Overdue</span>}
                            </p>
                            {activeInstallment && (
                                <p className="text-sm text-muted-foreground">
                                    Active installment: {activeInstallment.installmentNumber}
                                    {mergedNextInstallment && (
                                        <span className="ml-2">• Merged</span>
                                    )}
                                    {instPenalty > 0 && (
                                        <span className="ml-2">• Penalty: {formatCurrency(instPenalty)} ETB</span>
                                    )}
                                </p>
                            )}
                        </div>
                        <div className="text-right">
                             <p className="text-xl font-bold">{formatCurrency(balanceDue)}</p>
                             <p className="text-xs text-muted-foreground">Outstanding</p>
                             {activeInstallment && instOutstanding !== null && (
                                <p className="text-xs text-muted-foreground">Principal: {formatCurrency(instOutstanding)} ETB</p>
                             )}
                        </div>
                    </div>
                     <div className="flex justify-end mt-2">
                        <Button onClick={() => onRepay(activeLoan, balanceDue)} style={{ backgroundColor: providerColor }} className="text-white">Repay</Button>
                    </div>
                </CardContent>
            </Card>
        );
    }
    

    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <IconDisplayComponent iconName={product.icon} className="h-6 w-6" style={{ color: providerColor }} />
                        <div>
                            <p className="font-semibold">{product.name}</p>
                            <p className="text-xs text-muted-foreground">
                                Credit limit {formatCurrency(product.minLoan ?? 0)} to {formatCurrency((product.maxLoan && product.maxLoan > 0) ? product.maxLoan : (product.availableLimit ?? 0))}
                            </p>
                        </div>
                    </div>
                     {!isEligible ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span tabIndex={0}>{applyButton}</span>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{eligibilityReason}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        applyButton
                    )}
                </div>
                 <div className="flex justify-end mt-2">
                     <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center text-xs text-muted-foreground hover:text-primary">
                        More
                        {isExpanded ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                    </button>
                </div>
                {isExpanded && (
                    <div className="bg-muted/50 p-3 rounded-lg mt-2 text-xs text-muted-foreground space-y-1">
                        {Number(product.serviceFee?.value) > 0 && (
                             <div className="flex justify-between items-center">
                                <span>Service Fee:</span>
                                <span>{formatFee(product.serviceFee)}</span>
                            </div>
                        )}
                        {Number(product.dailyFee?.value) > 0 && (
                            <div className="flex justify-between items-center">
                                <span>Daily Fee:</span>
                                <span>{formatFee(product.dailyFee, ' daily')}</span>
                            </div>
                        )}
                        {product.penaltyRules.length > 0 && (
                             <div className="flex justify-between items-center">
                                <span>Penalty:</span>
                                <span>{formatPenaltyRule(maxPenaltyRule, 'summary')}</span>
                            </div>
                        )}
                         {applicableTax && (
                            <div className="flex justify-between items-center">
                                <span>Tax:</span>
                                <span>{applicableTax.rate}% on {applicableTax.componentsString}</span>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
