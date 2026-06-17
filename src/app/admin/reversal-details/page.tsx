"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams } from "next/navigation";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Users,
  Banknote,
  FileText,
  Shield,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

type ReversalDetails = {
  reversalId: string;
  reversalAction: string;
  reversalDate: string;
  loanId: string | null;
  borrowerId: string | null;
  loanAmount: number | null;
  providerName: string | null;
  providerId: string | null;
  productName: string | null;
  disbursedDate: string | null;
  dueDate: string | null;
  serviceFee: number | null;
  disbursementTransactionId: string | null;
  reversalJournalEntryId: string | null;
  creditAccount: string | null;
  statusCode: number | null;
  isPosted: boolean;
  hasRepaymentActivity: boolean;
  totalRepaid: number;
  reversedPaymentCount: number;
  reversedPayments: Array<{
    paymentId: string;
    amount: number;
    date: string;
    installmentId: string | null;
    outstandingBalanceBeforePayment: number | null;
  }>;
  requestedBy: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
  } | null;
  requestedAt: string | null;
  approvedBy: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
  } | null;
  approvedAt: string | null;
  reversedBy: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
  } | null;
  currentLoanStatus: string | null;
  currentRepaymentBehavior: string | null;
};

export default function ReversalDetailsPage() {
  useRequirePermission("reversals");

  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const entityId = searchParams?.get("id") ?? null;

  const [data, setData] = useState<ReversalDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityId) {
      setError("No entity ID provided");
      setIsLoading(false);
      return;
    }

    const fetchDetails = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reversals/${encodeURIComponent(entityId)}/details`
        );
        if (!res.ok) {
          const msg = await res.json().catch(() => ({}));
          throw new Error(msg?.error || "Failed to fetch reversal details");
        }
        const result = await res.json();
        setData(result);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        toast({
          title: "Error",
          description: String(e?.message ?? e),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDetails();
  }, [entityId, toast]);

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try {
      return format(new Date(d), "yyyy-MM-dd HH:mm:ss");
    } catch {
      return d;
    }
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount == null) return "—";
    return new Intl.NumberFormat("en-ET", {
      style: "currency",
      currency: "ETB",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 space-y-4 p-8 pt-6">
        <Button
          variant="ghost"
          className="mb-4"
          onClick={() => router.push("/admin/reversals")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Reversals
        </Button>
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-yellow-500" />
            <h3 className="text-lg font-semibold mb-2">
              Reversal Details Not Found
            </h3>
            <p className="text-muted-foreground">
              {error || "No reversal record found for this entity."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const reversalType =
    data.reversalAction === "LOAN_REVERSED"
      ? "Loan Reversal"
      : "Disbursement Reversal";

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/reversals")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Reversal Details
          </h2>
          <p className="text-muted-foreground">
            Detailed breakdown of this reversed transaction
          </p>
        </div>
      </div>

      {/* Status Banner */}
      <Card
        className={
          data.hasRepaymentActivity
            ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20"
            : "border-green-500 bg-green-50 dark:bg-green-950/20"
        }
      >
        <CardContent className="p-4 flex items-center gap-4">
          {data.hasRepaymentActivity ? (
            <AlertTriangle className="h-6 w-6 text-yellow-600 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
          )}
          <div>
            <p className="font-semibold text-sm">
              {reversalType} — {data.hasRepaymentActivity
                ? "Reversed with Repayment Activity"
                : "Reversed (No Repayment Activity)"}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.hasRepaymentActivity
                ? `This loan had ${data.reversedPaymentCount} payment(s) totalling ${formatCurrency(data.totalRepaid)} that were reversed along with the loan.`
                : "This loan had no repayment activity at the time of reversal."}
            </p>
          </div>
          <Badge variant="outline" className="ml-auto">
            {data.currentLoanStatus || "REVERSED"}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Loan Information */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Loan Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Loan ID</dt>
              <dd className="font-mono text-xs break-all">{data.loanId || "—"}</dd>

              <dt className="text-muted-foreground">Borrower ID</dt>
              <dd className="font-mono text-xs break-all">{data.borrowerId || "—"}</dd>

              <dt className="text-muted-foreground">Provider</dt>
              <dd>{data.providerName || data.providerId || "—"}</dd>

              <dt className="text-muted-foreground">Product</dt>
              <dd>{data.productName || "—"}</dd>

              <dt className="text-muted-foreground">Loan Amount</dt>
              <dd className="font-semibold">{formatCurrency(data.loanAmount)}</dd>

              <dt className="text-muted-foreground">Service Fee</dt>
              <dd>{formatCurrency(data.serviceFee)}</dd>

              <dt className="text-muted-foreground">Disbursed Date</dt>
              <dd>{formatDate(data.disbursedDate)}</dd>

              <dt className="text-muted-foreground">Due Date</dt>
              <dd>{formatDate(data.dueDate)}</dd>

              <dt className="text-muted-foreground">Credit Account</dt>
              <dd className="font-mono">{data.creditAccount || "—"}</dd>

              {data.disbursementTransactionId && (
                <>
                  <dt className="text-muted-foreground">Disbursement Txn ID</dt>
                  <dd className="font-mono text-xs break-all">
                    {data.disbursementTransactionId}
                  </dd>
                </>
              )}

              <dt className="text-muted-foreground">Type</dt>
              <dd>
                <Badge variant={data.isPosted ? "secondary" : "destructive"}>
                  {data.isPosted ? "Posted Loan" : "Failed Disbursement"}
                </Badge>
              </dd>
            </dl>
          </CardContent>
        </Card>

        {/* Reversal Actors */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> Reversal Authorization
            </CardTitle>
            <CardDescription>
              Maker-checker trail for this reversal
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Requested By (Maker) */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-sm">Requested By (Maker)</span>
              </div>
              {data.requestedBy ? (
                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-sm pl-6">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{data.requestedBy.fullName}</dd>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="text-xs">{data.requestedBy.email}</dd>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{data.requestedBy.phoneNumber}</dd>
                  <dt className="text-muted-foreground">Date</dt>
                  <dd>{formatDate(data.requestedAt)}</dd>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground pl-6">
                  Information not available
                </p>
              )}
            </div>

            {/* Approved By (Checker) */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="font-medium text-sm">
                  Approved By (Checker)
                </span>
              </div>
              {data.approvedBy ? (
                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-sm pl-6">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{data.approvedBy.fullName}</dd>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="text-xs">{data.approvedBy.email}</dd>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{data.approvedBy.phoneNumber}</dd>
                  <dt className="text-muted-foreground">Date</dt>
                  <dd>{formatDate(data.approvedAt)}</dd>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground pl-6">
                  Information not available
                </p>
              )}
            </div>

            {/* Reversal metadata */}
            <Separator />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Reversal Log ID</dt>
              <dd className="font-mono text-xs break-all">{data.reversalId}</dd>
              <dt className="text-muted-foreground">Reversal Date</dt>
              <dd>{formatDate(data.reversalDate)}</dd>
              {data.reversalJournalEntryId && (
                <>
                  <dt className="text-muted-foreground">Journal Entry ID</dt>
                  <dd className="font-mono text-xs break-all">
                    {data.reversalJournalEntryId}
                  </dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Reversed Repayment Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Banknote className="h-4 w-4" /> Reversed Repayment Activity
          </CardTitle>
          <CardDescription>
            {data.hasRepaymentActivity
              ? `${data.reversedPaymentCount} payment(s) were reversed as part of this transaction, totalling ${formatCurrency(data.totalRepaid)}.`
              : "No repayment activity was present when this reversal was performed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.hasRepaymentActivity && data.reversedPayments.length > 0 ? (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {data.reversedPaymentCount}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Payments Reversed
                  </p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">
                    {formatCurrency(data.totalRepaid)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Total Repaid (Reversed)
                  </p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {formatCurrency(data.loanAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Original Loan Amount
                  </p>
                </div>
              </div>

              {/* Payments table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Payment ID</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Balance Before</TableHead>
                    <TableHead>Installment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.reversedPayments.map((p, idx) => (
                    <TableRow key={p.paymentId || idx}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.paymentId || "—"}
                      </TableCell>
                      <TableCell>{formatDate(p.date)}</TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(p.amount)}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(p.outstandingBalanceBeforePayment)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.installmentId || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Banknote className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No repayment activity recorded for this reversal.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
