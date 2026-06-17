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
import { Loader2, ChevronLeft, ChevronRight, Search, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReversalRow = {
  id: string;
  transactionId: string | null;
  providerId: string;
  originalProviderId: string | null;
  creditAccount: string | null;
  amount: number | null;
  statusCode: number | null;
  createdAt: string;
  borrowerId: string | null;
  loanId: string | null;
  reversed: { reversedAt: string; reversedBy: string } | null;
  cancelled: { cancelledAt: string; cancelledBy: string } | null;
  pendingApproval: {
    changeId: string;
    requestedAt: string;
    requestedBy: string;
    type: string;
  } | null;
  isFailure: boolean;
  isPosted?: boolean;
  disbursementStatus?: string;
};

type FilterMode = "failed" | "all" | "posted";

const ITEMS_PER_PAGE = 20;

export default function ReversalsPage() {
  // Check for reversals permission
  useRequirePermission("reversals");

  const { toast } = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<ReversalRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("failed");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellingRow, setCancellingRow] = useState<ReversalRow | null>(null);
  const [cancelTransactionId, setCancelTransactionId] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(ITEMS_PER_PAGE));
    p.set("filter", filterMode);
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    if (debouncedSearch) p.set("search", debouncedSearch);
    return p.toString();
  }, [page, fromDate, toDate, filterMode, debouncedSearch]);

  useEffect(() => {
    const fetchRows = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/reversals?${query}`);
        if (!res.ok) throw new Error("Failed to fetch reversal rows");
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

  const reverseTx = async (row: ReversalRow) => {
    setReversingId(row.id);
    try {
      const isPosted = row.isPosted || row.disbursementStatus === "POSTED";
      const res = await fetch("/api/reversals/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isPosted
            ? { loanId: row.loanId, isPosted: true }
            : { id: row.id }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Reversal failed");

      toast({
        title: "Submitted",
        description: "Reversal request submitted for approval.",
      });

      // Refresh page
      const refresh = await fetch(`/api/reversals?${query}`);
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
      setReversingId(null);
    }
  };

  const openCancelDialog = (row: ReversalRow) => {
    setCancellingRow(row);
    setCancelTransactionId("");
    setCancelDialogOpen(true);
  };

  const cancelTx = async () => {
    if (!cancellingRow || !cancelTransactionId.trim()) {
      toast({
        title: "Error",
        description: "Please enter a valid CBS transaction ID",
        variant: "destructive",
      });
      return;
    }

    setIsCancelling(true);
    try {
      const isPosted = cancellingRow.isPosted || cancellingRow.disbursementStatus === "POSTED";
      const res = await fetch("/api/reversals/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isPosted
            ? {
                loanId: cancellingRow.loanId,
                isPosted: true,
                transactionId: cancelTransactionId.trim(),
              }
            : {
                id: cancellingRow.id,
                transactionId: cancelTransactionId.trim(),
              }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Cancel failed");

      toast({
        title: "Submitted",
        description: "Cancel request submitted for approval.",
      });
      setCancelDialogOpen(false);
      setCancellingRow(null);
      setCancelTransactionId("");

      // Refresh page
      const refresh = await fetch(`/api/reversals?${query}`);
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
      setIsCancelling(false);
    }
  };

  const statusBadge = (row: ReversalRow) => {
    if (row.reversed)
      return <Badge className="bg-green-600 text-white">Reversed</Badge>;
    if (row.cancelled)
      return <Badge className="bg-blue-600 text-white">Cancelled</Badge>;
    if (row.pendingApproval) {
      const type =
        row.pendingApproval.type === "DisbursementCancel"
          ? "Cancel"
          : "Reversal";
      return <Badge variant="outline">Pending {type}</Badge>;
    }
    // Show "Posted" for loans without disbursement transaction
    if (row.isPosted || row.disbursementStatus === "POSTED")
      return <Badge className="bg-yellow-600 text-white">Posted</Badge>;
    if (row.disbursementStatus === "SUCCESS")
      return <Badge className="bg-green-600 text-white">Success</Badge>;
    if (row.statusCode == null)
      return <Badge className="bg-red-600 text-white">Failed</Badge>;
    if (row.statusCode >= 200 && row.statusCode < 300)
      return <Badge className="bg-green-600 text-white">OK</Badge>;
    return <Badge className="bg-red-600 text-white">Failed</Badge>;
  };

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reversals</h2>
          <p className="text-muted-foreground">
            {filterMode === "posted" 
              ? "Loans posted internally without external disbursement."
              : filterMode === "all"
                ? "All disbursement transactions."
                : "Failed external disbursements that can be reversed internally."}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Filter</span>
            <Select value={filterMode} onValueChange={(v) => { setFilterMode(v as FilterMode); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="failed">Failed Only</SelectItem>
                <SelectItem value="posted">Posted Only</SelectItem>
                <SelectItem value="all">All Transactions</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
            placeholder="Search by account number or phone number..."
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
          <CardTitle>
            {filterMode === "posted" 
              ? "Posted Loans (No Disbursement Record)" 
              : filterMode === "all"
                ? "All Disbursements"
                : "Failed Disbursements"}
          </CardTitle>
          <CardDescription>
            {filterMode === "posted"
              ? "These loans were posted internally but have no external disbursement transaction record."
              : filterMode === "all"
                ? "View all disbursement transactions regardless of status."
                : "Submit a reversal request for approval to undo internal postings for failed upstream transfers."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Credit Account</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Txn ID</TableHead>
                <TableHead>Loan</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : rows.length ? (
                rows.map((r) => {
                  const internalProviderId =
                    r.originalProviderId || r.providerId;
                  const isPostedOnly = r.isPosted || r.disbursementStatus === "POSTED";
                  // For posted loans, allow reverse/cancel if not already processed
                  const canActOnPosted = isPostedOnly && !r.reversed && !r.cancelled && !r.pendingApproval;
                  // For failed disbursements, same as before
                  const canReverse =
                    !r.reversed &&
                    !r.cancelled &&
                    !r.pendingApproval &&
                    (r.isFailure || isPostedOnly);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        {format(new Date(r.createdAt), "yyyy-MM-dd HH:mm:ss")}
                      </TableCell>
                      <TableCell>{statusBadge(r)}</TableCell>
                      <TableCell className="font-mono">
                        {internalProviderId}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.creditAccount || "—"}
                      </TableCell>
                      <TableCell>{r.amount ?? "—"}</TableCell>
                      <TableCell className="font-mono">
                        {r.transactionId ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.loanId ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {r.reversed ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const detailId = r.loanId || r.id;
                                router.push(`/admin/reversal-details?id=${encodeURIComponent(detailId)}`);
                              }}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View Details
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                disabled={!canReverse || reversingId === r.id}
                                onClick={() => void reverseTx(r)}
                              >
                                {reversingId === r.id ? (
                                  <span className="inline-flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />{" "}
                                    Submitting
                                  </span>
                                ) : (
                                  "Reverse"
                                )}
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={!canReverse}
                                onClick={() => openCancelDialog(r)}
                              >
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    {filterMode === "posted" 
                      ? "No posted loans without disbursement records found."
                      : filterMode === "all"
                        ? "No disbursement transactions found."
                        : "No failed disbursements found."}
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

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Failed Disbursement</DialogTitle>
            <DialogDescription>
              Enter the CBS transaction ID to mark this disbursement as
              successful. Use this when the external disbursement actually
              succeeded but was recorded as failed.
            </DialogDescription>
          </DialogHeader>
          {cancellingRow && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Credit Account:</div>
                <div className="font-mono">{cancellingRow.creditAccount}</div>
                <div className="text-muted-foreground">Amount:</div>
                <div>{cancellingRow.amount ?? "—"}</div>
                <div className="text-muted-foreground">Loan ID:</div>
                <div className="font-mono">{cancellingRow.loanId ?? "—"}</div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transactionId">CBS Transaction ID</Label>
                <Input
                  id="transactionId"
                  placeholder="Enter the transaction ID from CBS"
                  value={cancelTransactionId}
                  onChange={(e) => setCancelTransactionId(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={isCancelling}
            >
              Close
            </Button>
            <Button
              onClick={cancelTx}
              disabled={isCancelling || !cancelTransactionId.trim()}
            >
              {isCancelling ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </span>
              ) : (
                "Mark as Successful"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
