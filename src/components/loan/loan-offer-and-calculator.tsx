"use client";

import { useState, useEffect } from "react";
import type {
  LoanProduct,
  LoanDetails,
  CheckLoanEligibilityOutput,
  FeeRule,
  PenaltyRule,
  Tax,
} from "@/lib/types";
import { addDays, format, endOfDay } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calculateTotalRepayable,
  calculateInclusiveTax,
} from "@/lib/loan-calculator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

interface LoanOfferAndCalculatorProps {
  product: LoanProduct;
  taxConfigs: Tax[];
  isLoading: boolean;
  eligibilityResult: CheckLoanEligibilityOutput | null;
  onAccept: (
    details: Omit<
      LoanDetails,
      "id" | "providerName" | "productName" | "payments"
    >,
  ) => void;
  providerColor?: string;
  isSubmitting?: boolean;
}

const formatCurrency = (amount: number) => {
  if (amount === null || amount === undefined || isNaN(amount))
    return "0.00 ETB";
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + " ETB"
  );
};

const formatFee = (feeRule: FeeRule | undefined, suffix?: string): string => {
  if (!feeRule || feeRule.value === "" || feeRule.value === null) return "N/A";
  const numericValue = Number(feeRule.value);
  if (isNaN(numericValue)) return "N/A";

  if (feeRule.type === "percentage") {
    return `${numericValue}%${suffix || ""}`;
  }
  return formatCurrency(numericValue);
};

const formatPenaltyRule = (rule: PenaltyRule): string => {
  const value = rule.value === "" ? 0 : Number(rule.value);
  let valueString = "";
  let conditionString = "";

  if (rule.type === "fixed") {
    valueString = formatCurrency(value);
  } else if (rule.type === "percentageOfPrincipal") {
    valueString = `${value}% of principal`;
  } else if (rule.type === "percentageOfCompound") {
    valueString = `${value}% of outstanding balance`;
  }

  const fromDay = rule.fromDay === "" ? 1 : Number(rule.fromDay);
  const toDay =
    rule.toDay === "" || rule.toDay === null ? Infinity : Number(rule.toDay);

  if (toDay === Infinity) {
    conditionString = `from day ${fromDay} onwards after due date`;
  } else {
    conditionString = `from day ${fromDay} to day ${toDay} after due date`;
  }

  return `${valueString} ${conditionString}`;
};

export function LoanOfferAndCalculator({
  product,
  taxConfigs,
  isLoading,
  eligibilityResult,
  onAccept,
  providerColor = "hsl(var(--primary))",
  isSubmitting = false,
}: LoanOfferAndCalculatorProps) {
  const [loanAmount, setLoanAmount] = useState<number | string>("");
  const [amountError, setAmountError] = useState("");
  const [isPenaltyDetailsOpen, setIsPenaltyDetailsOpen] = useState(false);
  const [calculationResult, setCalculationResult] = useState<any>(null);

  const { suggestedLoanAmountMin = 0, suggestedLoanAmountMax = 0 } =
    eligibilityResult || {};

  // If product.maxLoan is not configured (0 or negative), treat it as no cap and rely on suggestedLoanAmountMax
  const effectiveProductMax =
    typeof product.maxLoan === "number" && product.maxLoan > 0
      ? product.maxLoan
      : Infinity;
  const minLoan = Math.max(product.minLoan ?? 0, suggestedLoanAmountMin);
  const maxLoan = Math.min(effectiveProductMax, suggestedLoanAmountMax);

  useEffect(() => {
    const initialAmount = Math.min(product.availableLimit ?? maxLoan, maxLoan);
    setLoanAmount(initialAmount);
  }, [product.id, product.availableLimit, maxLoan]);

  useEffect(() => {
    const calculate = () => {
      const numericLoanAmount =
        typeof loanAmount === "string" ? parseFloat(loanAmount) : loanAmount;
      if (
        !eligibilityResult?.isEligible ||
        isNaN(numericLoanAmount) ||
        numericLoanAmount <= 0
      ) {
        setCalculationResult(null);
        return;
      }

      const disbursedDate = new Date();
      const duration = product.duration ?? 30;
      const dueDate =
        duration === 0
          ? endOfDay(disbursedDate)
          : addDays(disbursedDate, duration);

      let serviceFee = 0;
      if (
        product.serviceFeeEnabled &&
        product.serviceFee &&
        product.serviceFee.value
      ) {
        const feeValue =
          typeof product.serviceFee.value === "string"
            ? parseFloat(product.serviceFee.value)
            : product.serviceFee.value || 0;
        serviceFee =
          product.serviceFee.type === "fixed"
            ? feeValue
            : numericLoanAmount * (feeValue / 100);
      }

      const tempLoan: LoanDetails = {
        id: "temp",
        loanAmount: numericLoanAmount,
        serviceFee: serviceFee,
        disbursedDate,
        dueDate,
        repaymentStatus: "Unpaid",
        payments: [],
        productName: product.name,
        providerName: "",
        repaidAmount: 0,
        penaltyAmount: 0,
        product: product,
      };

      const result = calculateTotalRepayable(
        tempLoan,
        product,
        taxConfigs,
        dueDate,
      );

      // Calculate inclusive tax (deducted from principal before disbursement)
      const inclusiveTax = calculateInclusiveTax(numericLoanAmount, taxConfigs);

      setCalculationResult({
        ...result,
        disbursedDate,
        dueDate,
        penaltyAmount: 0,
        inclusiveTaxAmount: inclusiveTax.taxAmount,
        netDisbursedAmount: inclusiveTax.netDisbursedAmount,
      });
    };

    calculate();
  }, [loanAmount, eligibilityResult, product, taxConfigs]);

  const validateAmount = (amount: number | string) => {
    const numericAmount =
      typeof amount === "string" ? parseFloat(amount) : amount;
    if (
      isNaN(numericAmount) ||
      numericAmount > maxLoan ||
      numericAmount < minLoan
    ) {
      setAmountError(
        `Please enter an amount between ${formatCurrency(
          minLoan,
        )} and ${formatCurrency(maxLoan)}.`,
      );
      return false;
    }
    setAmountError("");
    return true;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "") {
      setLoanAmount("");
      setAmountError(
        `Please enter an amount between ${formatCurrency(
          minLoan,
        )} and ${formatCurrency(maxLoan)}.`,
      );
    } else {
      setLoanAmount(value);
      validateAmount(value);
    }
  };

  const handleAccept = () => {
    const numericLoanAmount =
      typeof loanAmount === "string" ? parseFloat(loanAmount) : loanAmount;
    if (calculationResult && !isNaN(numericLoanAmount)) {
      if (!validateAmount(numericLoanAmount)) {
        return;
      }
      onAccept({
        loanAmount: numericLoanAmount,
        repaymentStatus: "Unpaid",
        repaidAmount: 0,
        ...calculationResult,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-10 w-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-16 w-full" />
            </div>
          </CardContent>
          <CardFooter>
            <Skeleton className="h-10 w-32" />
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!eligibilityResult) {
    return null; // Or some other placeholder
  }

  if (!eligibilityResult.isEligible) {
    return (
      <div className="max-w-2xl mx-auto">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not Eligible for Loan</AlertTitle>
          <AlertDescription>
            {eligibilityResult.reason ||
              "We're sorry, but you are not eligible for this loan product at this time."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold font-headline">
            {product.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <Label htmlFor="loanAmount" className="text-sm font-medium">
              Enter Your Desired Loan Amount
            </Label>
            <Input
              id="loanAmount"
              type="number"
              value={loanAmount}
              onChange={handleAmountChange}
              className={cn(
                "w-full text-xl font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                amountError ? "border-destructive ring-destructive ring-2" : "",
              )}
              min={minLoan}
              max={maxLoan}
              style={
                {
                  "--ring": amountError
                    ? "hsl(var(--destructive))"
                    : providerColor,
                } as React.CSSProperties
              }
            />
            {amountError ? (
              <p className="text-sm text-destructive">{amountError}</p>
            ) : (
              <p className="text-sm text-muted-foreground text-center">
                Credit Limit: {formatCurrency(minLoan ?? 0)} -{" "}
                {formatCurrency(maxLoan ?? 0)}
              </p>
            )}
          </div>

          {calculationResult && (
            <div className="space-y-2">
              <div className="space-y-4 text-sm bg-secondary p-4 rounded-lg">
                {Number(product.serviceFee?.value) > 0 && (
                  <div className="flex justify-between items-center">
                    <div className="font-medium">Service Fee</div>
                    <div className="text-right">
                      {formatFee(product.serviceFee)}
                    </div>
                  </div>
                )}

                {Number(product.dailyFee?.value) > 0 && (
                  <div className="flex justify-between items-center">
                    <div className="font-medium">Daily Fee</div>
                    <div className="text-right">
                      {formatFee(product.dailyFee)}
                    </div>
                  </div>
                )}

                {calculationResult.tax > 0 && (
                  <div className="flex justify-between items-center">
                    <div className="font-medium">Tax</div>
                    <div className="text-right">
                      {formatCurrency(calculationResult.tax)}
                    </div>
                  </div>
                )}

                <Collapsible
                  open={isPenaltyDetailsOpen}
                  onOpenChange={setIsPenaltyDetailsOpen}
                >
                  {product.penaltyRules && product.penaltyRules.length > 0 && (
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "font-medium w-full flex justify-between items-center",
                          product.penaltyRules &&
                            product.penaltyRules.length > 0 &&
                            "text-destructive",
                        )}
                      >
                        <span className="flex items-center">
                          Penalty Rules
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 ml-1 transition-transform",
                              isPenaltyDetailsOpen && "rotate-180",
                            )}
                          />
                        </span>
                      </button>
                    </CollapsibleTrigger>
                  )}
                  <CollapsibleContent>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground/80 pl-4">
                      {(product.penaltyRules || []).map((rule) => (
                        <p key={rule.id}>- {formatPenaltyRule(rule)}</p>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* Inclusive Tax Breakdown - show when tax is deducted from principal */}
              {calculationResult.inclusiveTaxAmount > 0 && (
                <div className="space-y-2 text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 rounded-lg">
                  <div className="font-medium text-amber-800 dark:text-amber-300 mb-2">
                    Tax Deduction at Disbursement
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="text-muted-foreground">
                      Gross Loan Amount
                    </div>
                    <div className="text-right font-medium">
                      {formatCurrency(calculationResult.principal)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-amber-700 dark:text-amber-400">
                    <div>
                      {taxConfigs
                        .filter((t) => t.isInclusive && t.rate > 0)
                        .map((t) => t.name || `Tax (${t.rate}%)`)
                        .join(" + ")}
                    </div>
                    <div className="text-right font-medium">
                      − {formatCurrency(calculationResult.inclusiveTaxAmount)}
                    </div>
                  </div>
                  <div className="border-t border-amber-200 dark:border-amber-700 pt-2 flex justify-between items-center">
                    <div className="font-semibold">Net Amount Disbursed</div>
                    <div
                      className="text-right font-bold"
                      style={{ color: providerColor }}
                    >
                      {formatCurrency(calculationResult.netDisbursedAmount)}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center p-4 rounded-lg border">
                <div>
                  <span className="text-base font-semibold">
                    Total Repayable Amount
                  </span>
                  <p className="text-xs text-muted-foreground">
                    on {format(calculationResult.dueDate, "PPP")}
                  </p>
                </div>
                <span
                  className="text-2xl font-bold"
                  style={{ color: providerColor }}
                >
                  {formatCurrency(calculationResult.total)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            size="lg"
            className="w-full text-white"
            onClick={handleAccept}
            disabled={!!amountError || isSubmitting}
            style={{ backgroundColor: providerColor }}
          >
            {isSubmitting ? "Processing..." : "Accept and Disburse Loan"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
