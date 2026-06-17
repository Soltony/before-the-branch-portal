"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { useRouter } from "next/navigation";
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
import { Loader2, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";

type PhoneChangeRequestRow = {
  id: string;
  oldPhoneNumber: string;
  newPhoneNumber: string;
  reason: string;
  status: string;
  requestedById: string;
  requestedByName: string;
  approvedById: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export default function PhoneChangeApprovalsPage() {
  useRequirePermission("phone-change-approvals");

  const { toast } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const { canModule } = usePermissions();
  const canProcess =
    canModule("phone-change-approvals", "update") ||
    canModule("phone-change-approvals", "approve");

  const [requests, setRequests] = useState<PhoneChangeRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  // Rejection dialog state
  const [rejectionReason, setRejectionReason] = useState("");
  const [requestToReject, setRequestToReject] = useState<PhoneChangeRequestRow | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/phone-change/approvals?status=PENDING&page=${page}&limit=10`
      );
      if (!res.ok) throw new Error("Failed to fetch requests");
      const data = await res.json();
      setRequests(data.data || []);
      setTotalPages(data.totalPages || 1);
    } catch (e: any) {
      toast({ title: "Error", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const visibleRequests = requests.filter((r) => !removedIds.has(r.id));

  const handleProcess = async (
    requestId: string,
    approved: boolean,
    reason?: string
  ) => {
    if (!canProcess) {
      toast({
        title: "Not authorized",
        description: "You are not authorized to process phone change requests.",
        variant: "destructive",
      });
      return;
    }

    setProcessingId(requestId);
    try {
      const res = await fetch("/api/phone-change/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          approved,
          rejectionReason: reason,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to ${approved ? "approve" : "reject"}`);

      setRemovedIds((prev) => new Set([...prev, requestId]));
      toast({
        title: "Success",
        description: `Phone change request has been ${approved ? "approved" : "rejected"}.`,
      });

      if (approved) {
        router.refresh();
      }
    } catch (e: any) {
      toast({ title: "Error", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setProcessingId(null);
      setRequestToReject(null);
      setRejectionReason("");
    }
  };

  return (
    <>
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Phone Change Approvals
          </h2>
          <p className="text-muted-foreground">
            Review and approve or reject pending phone number change requests.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending Requests</CardTitle>
            <CardDescription>
              Each request must be approved by a different user than the one who submitted it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Old Phone</TableHead>
                  <TableHead>New Phone</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : visibleRequests.length > 0 ? (
                  visibleRequests.map((req) => {
                    const isSelf = req.requestedById === user?.id;
                    return (
                      <TableRow key={req.id}>
                        <TableCell className="font-mono">
                          {req.oldPhoneNumber}
                        </TableCell>
                        <TableCell className="font-mono">
                          {req.newPhoneNumber}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {req.reason}
                        </TableCell>
                        <TableCell>{req.requestedByName}</TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(req.createdAt), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          {canProcess && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleProcess(req.id, true)}
                                disabled={processingId === req.id || isSelf}
                                className="text-green-600 border-green-600 hover:bg-green-50 hover:text-green-700"
                                title={isSelf ? "Cannot approve own request" : "Approve"}
                              >
                                {processingId === req.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRequestToReject(req)}
                                disabled={processingId === req.id || isSelf}
                                className="text-red-600 border-red-600 hover:bg-red-50 hover:text-red-700"
                                title={isSelf ? "Cannot reject own request" : "Reject"}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      No pending phone change requests.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          {totalPages > 1 && (
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
          )}
        </Card>
      </div>

      {/* Rejection Dialog */}
      <Dialog
        open={!!requestToReject}
        onOpenChange={() => setRequestToReject(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Phone Change Request</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this phone number change request.
            </DialogDescription>
          </DialogHeader>
          {requestToReject && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">Old Phone:</span>
                <span className="font-mono">{requestToReject.oldPhoneNumber}</span>
                <span className="text-muted-foreground">New Phone:</span>
                <span className="font-mono">{requestToReject.newPhoneNumber}</span>
              </div>
            </div>
          )}
          <div className="py-2">
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Reason for rejection..."
              disabled={!!processingId}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestToReject(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                handleProcess(requestToReject!.id, false, rejectionReason)
              }
              disabled={!!processingId || !rejectionReason.trim()}
            >
              {processingId ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing...
                </span>
              ) : (
                "Confirm Rejection"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
