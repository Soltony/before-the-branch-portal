"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequirePermission } from "@/hooks/use-require-permission";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ChevronLeft, ChevronRight, Search, Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, startOfDay } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

type PendingPaymentRow = {
  id: string;
  transactionId: string;
  loanId: string;
  borrowerId: string;
  amount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  loan: {
    id: string;
    loanAmount: number;
    repaidAmount: number | null;
    repaymentStatus: string;
    dueDate: string | null;
    disbursedDate: string | null;
    productName: string | null;
    providerName: string | null;
    providerId: string | null;
  } | null;
  phoneNumber: string;
  accountNumber: string | null;
  pendingApproval: {
    changeId: string;
    requestedAt: string;
  } | null;
};

const ITEMS_PER_PAGE = 20;

export default function PendingPaymentsPage() {
  useRequirePermission("reversals");

  const { toast } = useToast();
  const [rows, setRows] = useState<PendingPaymentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolvingRow, setResolvingRow] = useState<PendingPaymentRow | null>(
    null
  );
  const [ftReference, setFtReference] = useState("");
  const [paymentDate, setPaymentDate] = useState<Date | undefined>(new Date());
  const [isResolving, setIsResolving] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(ITEMS_PER_PAGE));
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    if (debouncedSearch) p.set("search", debouncedSearch);
    return p.toString();
  }, [page, fromDate, toDate, debouncedSearch]);

  useEffect(() => {
    const fetchRows = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/pending-payments?${query}`);
        if (!res.ok) throw new Error("Failed to fetch pending payments");
        const data = await res.json();
        setRows(data.rows || []);
        setTotalPages(data.totalPages || 1);
      } catch (e: any) {
        toast({
          title: "Error",
          description: String(e?.message ?? e),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void fetchRows();
  }, [query, toast]);

  const openResolveDialog = (row: PendingPaymentRow) => {
    setResolvingRow(row);
    setFtReference("");
    setPaymentDate(new Date(row.createdAt));
    setResolveDialogOpen(true);
  };

  const submitResolve = async () => {
    if (!resolvingRow || !ftReference.trim()) {
      toast({
        title: "Error",
        description: "Please enter a valid FT reference number",
        variant: "destructive",
      });
      return;
    }

    setIsResolving(true);
    try {
      const res = await fetch("/api/pending-payments/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingPaymentId: resolvingRow.id,
          ftReference: ftReference.trim(),
          paymentDate: paymentDate?.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Resolve request failed");

      toast({
        title: "Submitted",
        description: "Resolve request submitted for approval.",
      });
      setResolveDialogOpen(false);
      setResolvingRow(null);
      setFtReference("");

      // Refresh page
      const refresh = await fetch(`/api/pending-payments?${query}`);
      const refreshed = await refresh.json();
      setRows(refreshed.rows || []);
      setTotalPages(refreshed.totalPages || 1);
    } catch (e: any) {
      toast({
        title: "Error",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setIsResolving(false);
    }
  };

  const statusBadge = (row: PendingPaymentRow) => {
    if (row.pendingApproval) {
      return <Badge variant="outline">Pending Approval</Badge>;
    }
    return <Badge className="bg-yellow-600 text-white">Pending</Badge>;
  };

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Pending Payments
          </h2>
          <p className="text-muted-foreground">
            Pending payments that can be marked as successful by providing the FT
            reference number.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">From</span>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">To</span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by transaction ID, borrower ID, loan ID, or account number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearchQuery("")}
          >
            Clear
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Payments</CardTitle>
          <CardDescription>
            Submit a resolve request with an FT reference number to mark a
            pending payment as successful. Requires approval from another user.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Borrower</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Loan</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Txn ID</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : rows.length ? (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {format(new Date(r.createdAt), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>{statusBadge(r)}</TableCell>
                    <TableCell className="font-mono">
                      {r.phoneNumber}
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.accountNumber || "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.loanId}
                    </TableCell>
                    <TableCell>
                      {r.loan?.productName || "—"}
                      {r.loan?.providerName && (
                        <div className="text-xs text-muted-foreground">
                          ({r.loan.providerName})
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{r.amount}</TableCell>
                    <TableCell className="font-mono">
                      {r.transactionId}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!!r.pendingApproval}
                        onClick={() => openResolveDialog(r)}
                      >
                        {r.pendingApproval
                          ? "Pending Approval"
                          : "Mark Successful"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center">
                    No pending payments found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Payment as Successful</DialogTitle>
            <DialogDescription>
              Enter the FT reference number to mark this pending payment as
              successful. This will record the repayment against the loan.
            </DialogDescription>
          </DialogHeader>
          {resolvingRow && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Borrower:</div>
                <div className="font-mono">{resolvingRow.phoneNumber}</div>
                <div className="text-muted-foreground">Loan ID:</div>
                <div className="font-mono">{resolvingRow.loanId}</div>
                <div className="text-muted-foreground">Amount:</div>
                <div>{resolvingRow.amount} ETB</div>
                <div className="text-muted-foreground">Product:</div>
                <div>{resolvingRow.loan?.productName || "—"}</div>
                <div className="text-muted-foreground">
                  Original Transaction ID:
                </div>
                <div className="font-mono">{resolvingRow.transactionId}</div>
              </div>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="ftRef" className="text-right">
                    FT Reference
                  </Label>
                  <Input
                    id="ftRef"
                    value={ftReference}
                    onChange={(e) => setFtReference(e.target.value)}
                    className="col-span-3"
                    placeholder="e.g. FT123456789"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                   <Label className="text-right">
                     Payment Date
                   </Label>
                   <div className="col-span-3">
                     <Button
                       variant={"outline"}
                       disabled
                       className={cn(
                         "w-full justify-start text-left font-normal cursor-not-allowed opacity-100",
                         !paymentDate && "text-muted-foreground"
                       )}
                     >
                       <CalendarIcon className="mr-2 h-4 w-4" />
                       {paymentDate ? format(paymentDate, "PPP") : <span>Pick a date</span>}
                     </Button>
                     <p className="text-[10px] text-muted-foreground mt-1">
                       Locked to the date the payment was recorded.
                     </p>
                   </div>
                 </div>
               </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResolveDialogOpen(false)}
              disabled={isResolving}
            >
              Close
            </Button>
            <Button
              onClick={submitResolve}
              disabled={isResolving || !ftReference.trim()}
            >
              {isResolving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting...
                </span>
              ) : (
                "Submit for Approval"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
