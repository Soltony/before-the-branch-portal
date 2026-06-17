"use client";

import type { LoanDetails, LoanProduct, PenaltyRule } from "@/lib/types";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle } from "lucide-react";

interface LoanDetailsViewProps {
  details: LoanDetails;
  product: LoanProduct;
  onReset: () => void;
  providerColor?: string;
  selectedAccount?: { accountNumber?: string; customerName?: string } | null;
}

const formatCurrency = (amount: number) => {
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + " ETB"
  );
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
    conditionString = `from day ${fromDay} onwards`;
  } else {
    conditionString = `from day ${fromDay} to day ${toDay}`;
  }

  return `${valueString} ${conditionString}`;
};

export function LoanDetailsView({
  details,
  product,
  onReset,
  providerColor = "hsl(var(--primary))",
  selectedAccount = null,
}: LoanDetailsViewProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-xl shadow-amber-200/50">
          <CheckCircle className="h-10 w-10" />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-600">
          Successful!
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your loan has been disbursed successfully.
        </p>
      </div>
      {/* Selected account card placed under success hero */}
      {selectedAccount && selectedAccount.accountNumber ? (
        <Card className="mb-6 shadow-sm">
          <CardContent className="py-3">
            <div className="text-sm text-muted-foreground">Selected account for disbursement</div>
            <div className="mt-1 font-mono text-sm">{selectedAccount.accountNumber} — {selectedAccount.customerName}</div>
          </CardContent>
        </Card>
      ) : null}
      <Card className="shadow-lg">
        <CardContent className="space-y-4">
          <div className="flex justify-between items-baseline p-4 bg-secondary rounded-lg">
            <span className="text-muted-foreground">Loan Amount</span>
            <span
              className="text-xl font-bold"
              style={{ color: providerColor }}
            >
              {formatCurrency(details.loanAmount)}
            </span>
          </div>

          {/* Inclusive Tax Breakdown */}
          {details.taxDeducted != null && details.taxDeducted > 0 && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="text-sm font-medium text-foreground">
                Tax Deduction at Disbursement
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross Loan Amount</span>
                  <span className="font-medium">{formatCurrency(details.loanAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax Deducted</span>
                  <span className="font-medium text-destructive">
                    − {formatCurrency(details.taxDeducted)}
                  </span>
                </div>
                <div className="border-t border-border pt-2 flex justify-between">
                  <span className="font-semibold">Net Amount Disbursed</span>
                  <span
                    className="font-bold"
                    style={{ color: providerColor }}
                  >
                    {formatCurrency(
                      details.netDisbursedAmount ??
                        details.loanAmount - details.taxDeducted,
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <div className="text-muted-foreground">Repayment Status</div>
              <div className="text-right font-medium">
                <Badge
                  variant={
                    details.repaymentStatus === "Unpaid"
                      ? "destructive"
                      : "default"
                  }
                >
                  {details.repaymentStatus}
                </Badge>
              </div>
            </div>

            <div className="flex justify-between">
              <div className="text-muted-foreground">Service Fee Applied</div>
              <div className="text-right font-medium">
                {formatCurrency(details.serviceFee)}
              </div>
            </div>

            <div className="flex justify-between">
              <div className="text-muted-foreground">Daily Fee Rule</div>
              <div className="text-right font-medium">
                {product.dailyFee.value
                  ? `${product.dailyFee.value}${product.dailyFee.type === "percentage" ? "%" : ""}`
                  : "N/A"}
              </div>
            </div>

            <div>
              <div className="text-muted-foreground mb-1">Penalty Rules</div>
              {product.penaltyRulesEnabled &&
              product.penaltyRules.length > 0 ? (
                <div className="mt-1 space-y-1 text-xs text-muted-foreground/80 pl-4 bg-secondary p-2 rounded-md">
                  {(product.penaltyRules || []).map((rule) => (
                    <p key={rule.id}>- {formatPenaltyRule(rule)}</p>
                  ))}
                </div>
              ) : (
                <div className="text-right font-medium">N/A</div>
              )}
            </div>

            <div className="flex justify-between">
              <div className="text-muted-foreground">Due Date</div>
              <div className="text-right font-medium">
                {format(details.dueDate, "PPP")}
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full text-white"
            onClick={onReset}
            style={{ backgroundColor: providerColor }}
          >
            Start New Application
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
