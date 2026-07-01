'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { usePermissions } from '@/hooks/use-permissions';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  CheckCircle,
  XCircle,
  Pencil,
  Trash2,
  AlertTriangle,
  Eye,
  Users,
  RefreshCw,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────

interface InsurancePayment {
  id: string;
  batchId: string | null;
  insuranceName: string | null;
  insuranceId: string | null;
  creditAccount: string | null;
  insuranceAmount: number;
  status: string;
  loanId: string | null;
  remainingBalance: number | null;
  transactionId: string | null;
  transactionAmount: number | null;
  rejectionReason: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  lershaConfirmationSentAt: string | null;
  farmer: {
    id: string;
    farmerId: string;
    farmerName: string;
    phoneNumber: string;
    requestedLoanAmount: number;
    status: string;
  } | null;
  insuranceAccount: {
    id: string;
    insuranceName: string;
    insuranceId: string;
    accountNumber: string;
    status: string;
  } | null;
}

interface Batch {
  batchId: string;
  requestedAt: string | null;
  farmerCount: number;
  totalAmount: number;
  insurers: string[];
  statusCounts: Record<string, number>;
  requestedCount: number;
  approvableCount: number;
  payments: InsurancePayment[];
}

interface InsuranceAccount {
  id: string;
  insuranceName: string;
  insuranceId: string;
  accountNumber: string;
  status: string;
}

// ── Helpers ────────────────────────────────────────

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ETB';

const statusVariant = (
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status.toUpperCase()) {
    case 'SUCCESS':
      return 'default';
    case 'FAILED':
    case 'REJECTED':
      return 'destructive';
    case 'REQUESTED':
      return 'secondary';
    default:
      return 'outline';
  }
};

const isApprovable = (p: InsurancePayment) =>
  p.status === 'REQUESTED' && !!p.creditAccount;

const ITEMS_PER_PAGE = 20;

// ── Page ───────────────────────────────────────────

export default function InsurancePaymentsPage() {
  useRequirePermission('insurance-payments');
  const { toast } = useToast();
  const { canModule } = usePermissions();
  const canApprove = canModule('insurance-payments', 'update');
  const canManageAccounts =
    canModule('insurance-payments', 'create') ||
    canModule('insurance-payments', 'update') ||
    canModule('insurance-payments', 'delete');

  const [batches, setBatches] = useState<Batch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [approveTarget, setApproveTarget] = useState<string[] | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string[] | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [detailPayment, setDetailPayment] = useState<InsurancePayment | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchBatches = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(ITEMS_PER_PAGE),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/insurance-payments?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch insurance payments.');
      const data = await res.json();
      setBatches(data.batches);
      setTotalPages(data.totalPages);
      setTotal(data.total);
      setSelectedIds(new Set());
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, toast]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleBatch = (batch: Batch, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of batch.payments) {
        if (isApprovable(p)) {
          checked ? next.add(p.id) : next.delete(p.id);
        }
      }
      return next;
    });
  };

  const submitApprove = async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/insurance-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIds: ids, action: 'APPROVE' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval failed.');

      const softErrors = (data.results || []).filter((r: any) => r.softError);
      toast({
        title: 'Insurance Payments Processed',
        description:
          `${data.approvedCount} approved` +
          (softErrors.length
            ? `, ${softErrors.length} could not be processed (e.g. unmapped insurer or insufficient funds).`
            : '.') +
          (data.lershaNotified ? ' Lersha notified.' : ''),
        variant: softErrors.length ? 'destructive' : 'default',
      });
      fetchBatches();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      setApproveTarget(null);
    }
  };

  const submitReject = async (ids: string[], reason: string) => {
    if (ids.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/insurance-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIds: ids,
          action: 'REJECT',
          rejectionReason: reason || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rejection failed.');
      toast({
        title: 'Insurance Payments Rejected',
        description: `${data.rejectedCount} rejected.${data.lershaNotified ? ' Lersha notified.' : ''}`,
      });
      fetchBatches();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      setRejectTarget(null);
      setRejectReason('');
    }
  };

  const hasActiveFilters = debouncedSearch || statusFilter;

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Insurance Payments</h2>
        <p className="text-muted-foreground">
          Each request from Lersha (a batch of farmers) is grouped below. Open a batch to
          review every farmer&apos;s insurance request and approve or reject — individually
          or all at once. Manage per-insurer account mappings in the Insurance Accounts tab.
        </p>
      </div>

      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList>
          <TabsTrigger value="requests">Payment Requests</TabsTrigger>
          <TabsTrigger value="accounts">Insurance Accounts</TabsTrigger>
        </TabsList>

        {/* ── Payment Requests ── */}
        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Search</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by farmer, insurer, account..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="w-full md:w-[200px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                  <Select
                    value={statusFilter || 'ALL'}
                    onValueChange={(v) => {
                      setStatusFilter(v === 'ALL' ? '' : v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All statuses</SelectItem>
                      <SelectItem value="REQUESTED">Requested</SelectItem>
                      <SelectItem value="SUCCESS">Success</SelectItem>
                      <SelectItem value="REJECTED">Rejected</SelectItem>
                      <SelectItem value="FAILED">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchQuery('');
                      setDebouncedSearch('');
                      setStatusFilter('');
                      setPage(1);
                    }}
                    className="h-10 gap-1"
                  >
                    <X className="h-4 w-4" />
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Insurance Payment Requests</CardTitle>
                <CardDescription>
                  {total} request batch{total !== 1 ? 'es' : ''} — newest first
                </CardDescription>
              </div>
              {canApprove && selectedIds.size > 0 && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => setApproveTarget(Array.from(selectedIds))}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Approve Selected ({selectedIds.size})
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isSubmitting}
                    onClick={() => setRejectTarget(Array.from(selectedIds))}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Reject Selected
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-24 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : batches.length === 0 ? (
                <div className="h-24 flex items-center justify-center text-muted-foreground">
                  No insurance payment requests found.
                </div>
              ) : (
                <Accordion type="multiple" className="space-y-2">
                  {batches.map((batch) => (
                    <BatchRow
                      key={batch.batchId}
                      batch={batch}
                      canApprove={canApprove}
                      isSubmitting={isSubmitting}
                      selectedIds={selectedIds}
                      onToggleOne={toggleOne}
                      onToggleBatch={toggleBatch}
                      onApprove={(ids) => setApproveTarget(ids)}
                      onReject={(ids) => setRejectTarget(ids)}
                      onViewDetails={(p) => setDetailPayment(p)}
                    />
                  ))}
                </Accordion>
              )}
            </CardContent>
            <CardFooter>
              <div className="flex items-center justify-end w-full space-x-2">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── Insurance Accounts ── */}
        <TabsContent value="accounts">
          <InsuranceAccountsTab canManage={canManageAccounts} />
        </TabsContent>
      </Tabs>

      {/* Approve confirmation */}
      <AlertDialog
        open={!!approveTarget}
        onOpenChange={(open) => !open && setApproveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve insurance payment(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              {approveTarget?.length === 1
                ? 'This payment will be booked as a loan and the insurer account will be credited.'
                : `${approveTarget?.length} payments will be booked as loans and their insurer accounts credited.`}{' '}
              Lersha will be notified of the result.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => approveTarget && submitApprove(approveTarget)}
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject dialog */}
      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject insurance payment(s)</DialogTitle>
            <DialogDescription>
              Optionally provide a reason. Lersha will be notified that the payment failed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="rejectReason">Reason (optional)</Label>
            <Textarea
              id="rejectReason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={isSubmitting}
              onClick={() => rejectTarget && submitReject(rejectTarget, rejectReason)}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-payment details */}
      <PaymentDetailsDialog
        payment={detailPayment}
        onClose={() => setDetailPayment(null)}
      />
    </div>
  );
}

// ── Batch row (accordion item) ─────────────────────

function BatchRow({
  batch,
  canApprove,
  isSubmitting,
  selectedIds,
  onToggleOne,
  onToggleBatch,
  onApprove,
  onReject,
  onViewDetails,
}: {
  batch: Batch;
  canApprove: boolean;
  isSubmitting: boolean;
  selectedIds: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleBatch: (batch: Batch, checked: boolean) => void;
  onApprove: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  onViewDetails: (p: InsurancePayment) => void;
}) {
  const approvableIds = useMemo(
    () => batch.payments.filter(isApprovable).map((p) => p.id),
    [batch.payments],
  );
  const requestedIds = useMemo(
    () => batch.payments.filter((p) => p.status === 'REQUESTED').map((p) => p.id),
    [batch.payments],
  );
  const allBatchSelected =
    approvableIds.length > 0 && approvableIds.every((id) => selectedIds.has(id));

  return (
    <AccordionItem value={batch.batchId} className="rounded-md border px-2">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1 pr-4 text-left">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Users className="h-4 w-4 text-muted-foreground" />
            {batch.farmerCount} farmer{batch.farmerCount !== 1 ? 's' : ''}
          </span>
          <span className="text-sm text-muted-foreground">
            {batch.insurers.join(', ') || '—'}
          </span>
          <span className="font-mono text-sm font-semibold">
            {formatCurrency(batch.totalAmount)}
          </span>
          <span className="flex flex-wrap gap-1">
            {Object.entries(batch.statusCounts).map(([s, n]) => (
              <Badge key={s} variant={statusVariant(s)} className="text-[10px]">
                {n} {s}
              </Badge>
            ))}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {batch.requestedAt
              ? format(new Date(batch.requestedAt), 'yyyy-MM-dd HH:mm')
              : '—'}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {canApprove && batch.requestedCount > 0 && (
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allBatchSelected}
                onCheckedChange={(v) => onToggleBatch(batch, !!v)}
                disabled={approvableIds.length === 0}
                aria-label="Select all approvable in batch"
              />
              Select all approvable ({approvableIds.length})
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={approvableIds.length === 0 || isSubmitting}
                onClick={() => onApprove(approvableIds)}
              >
                <CheckCircle className="h-4 w-4 mr-1 text-green-600" />
                Approve all ({approvableIds.length})
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={requestedIds.length === 0 || isSubmitting}
                onClick={() => onReject(requestedIds)}
              >
                <XCircle className="h-4 w-4 mr-1 text-red-600" />
                Reject all ({requestedIds.length})
              </Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {canApprove && <TableHead className="w-[40px]" />}
                <TableHead>Farmer</TableHead>
                <TableHead>Insurer</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.payments.map((p) => {
                const unmapped = !p.creditAccount;
                const requested = p.status === 'REQUESTED';
                return (
                  <TableRow key={p.id}>
                    {canApprove && (
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => onToggleOne(p.id)}
                          disabled={!isApprovable(p)}
                          aria-label={`Select ${p.farmer?.farmerName}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">
                      <div>{p.farmer?.farmerName ?? '—'}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {p.farmer?.farmerId}
                      </div>
                    </TableCell>
                    <TableCell>{p.insuranceName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.creditAccount ?? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />
                          Not configured
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(p.insuranceAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {p.remainingBalance != null
                        ? formatCurrency(p.remainingBalance)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="View details"
                          onClick={() => onViewDetails(p)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canApprove && requested && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-600 hover:text-green-700"
                              title={
                                unmapped
                                  ? 'Configure the insurer account first'
                                  : 'Approve payment'
                              }
                              disabled={unmapped || isSubmitting}
                              onClick={() => onApprove([p.id])}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:text-red-700"
                              title="Reject payment"
                              disabled={isSubmitting}
                              onClick={() => onReject([p.id])}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// ── Payment details dialog ─────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="col-span-2 text-sm break-words">{value ?? '—'}</dd>
    </div>
  );
}

function PaymentDetailsDialog({
  payment,
  onClose,
}: {
  payment: InsurancePayment | null;
  onClose: () => void;
}) {
  const fmtDate = (d: string | null) =>
    d ? format(new Date(d), 'yyyy-MM-dd HH:mm') : '—';

  return (
    <Dialog open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Insurance Request Details</DialogTitle>
          <DialogDescription>
            {payment?.farmer?.farmerName} · {payment?.farmer?.farmerId}
          </DialogDescription>
        </DialogHeader>
        {payment && (
          <dl className="max-h-[60vh] overflow-y-auto pr-1">
            <DetailRow
              label="Status"
              value={<Badge variant={statusVariant(payment.status)}>{payment.status}</Badge>}
            />
            <DetailRow label="Farmer" value={payment.farmer?.farmerName} />
            <DetailRow label="Farmer ID" value={payment.farmer?.farmerId} />
            <DetailRow label="Phone" value={payment.farmer?.phoneNumber} />
            <DetailRow label="Insurer" value={payment.insuranceName} />
            <DetailRow label="Insurance ID" value={payment.insuranceId} />
            <DetailRow
              label="Credit Account"
              value={
                payment.creditAccount ?? (
                  <span className="text-amber-600">Not configured</span>
                )
              }
            />
            <DetailRow
              label="Insurance Amount"
              value={
                <span className="font-mono font-semibold">
                  {formatCurrency(payment.insuranceAmount)}
                </span>
              }
            />
            <DetailRow
              label="Remaining Balance"
              value={
                payment.remainingBalance != null
                  ? formatCurrency(payment.remainingBalance)
                  : '—'
              }
            />
            <DetailRow
              label="Transaction ID"
              value={payment.transactionId ?? '—'}
            />
            <DetailRow
              label="Transaction Amount"
              value={
                payment.transactionAmount != null
                  ? formatCurrency(payment.transactionAmount)
                  : '—'
              }
            />
            <DetailRow
              label="Booked Loan ID"
              value={
                payment.loanId ? (
                  <span className="font-mono text-xs">{payment.loanId}</span>
                ) : (
                  '—'
                )
              }
            />
            {payment.rejectionReason && (
              <DetailRow label="Rejection Reason" value={payment.rejectionReason} />
            )}
            <DetailRow label="Requested At" value={fmtDate(payment.requestedAt)} />
            <DetailRow label="Confirmed At" value={fmtDate(payment.confirmedAt)} />
            <DetailRow
              label="Lersha Notified At"
              value={fmtDate(payment.lershaConfirmationSentAt)}
            />
            <DetailRow
              label="Batch ID"
              value={
                <span className="font-mono text-xs">{payment.batchId ?? '—'}</span>
              }
            />
          </dl>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Insurance Accounts tab ─────────────────────────

function InsuranceAccountsTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<InsuranceAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Insurer name + account number are sourced from approved farmers; only the
  // NIB insurance id and status are editable here.
  const emptyForm = { id: '', insuranceName: '', insuranceId: '', accountNumber: '', status: 'ACTIVE' };
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InsuranceAccount | null>(null);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/insurance-accounts');
      if (!res.ok) throw new Error('Failed to fetch insurance accounts.');
      const data = await res.json();
      setAccounts(data.accounts);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Fetch insurer name + account number from approved farmers and upsert them.
  const syncFromFarmers = useCallback(
    async (opts?: { silent?: boolean }) => {
      setIsSyncing(true);
      try {
        const res = await fetch('/api/insurance-accounts/sync', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to sync insurance accounts.');
        setAccounts(data.accounts ?? []);
        if (!opts?.silent) {
          const changed = (data.created ?? 0) + (data.updated ?? 0);
          toast({
            title: 'Synced from farmers',
            description: changed > 0
              ? `${data.created} added, ${data.updated} updated (${data.total} insurer${data.total === 1 ? '' : 's'}).`
              : `Up to date — ${data.total} insurer${data.total === 1 ? '' : 's'}.`,
          });
        }
      } catch (error: any) {
        if (!opts?.silent) toast({ title: 'Error', description: error.message, variant: 'destructive' });
        // Fall back to whatever is already stored.
        fetchAccounts();
      } finally {
        setIsSyncing(false);
        setIsLoading(false);
      }
    },
    [toast, fetchAccounts],
  );

  useEffect(() => {
    // Auto-fetch from approved farmers on open; falls back to the stored list.
    syncFromFarmers({ silent: true });
  }, [syncFromFarmers]);

  const openEdit = (a: InsuranceAccount) => {
    setForm({
      id: a.id,
      insuranceName: a.insuranceName,
      insuranceId: a.insuranceId,
      accountNumber: a.accountNumber,
      status: a.status,
    });
    setDialogOpen(true);
  };

  const saveForm = async () => {
    if (!form.insuranceId.trim()) {
      toast({ title: 'Error', description: 'NIB insurance ID is required.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/insurance-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id, insuranceId: form.insuranceId, status: form.status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      toast({ title: 'Account updated' });
      setDialogOpen(false);
      fetchAccounts();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/insurance-accounts?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      toast({ title: 'Account deleted' });
      fetchAccounts();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Insurance Accounts</CardTitle>
          <CardDescription>
            Auto-fetched from approved farmers: the insurer name and account number
            come from each farmer&apos;s insurance loan purpose. Only the NIB insurance
            ID and ACTIVE/INACTIVE status are editable here.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => syncFromFarmers()} disabled={isSyncing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync from Farmers
          </Button>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insurer Name</TableHead>
              <TableHead>Insurance ID</TableHead>
              <TableHead>Account Number</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : accounts.length > 0 ? (
              accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.insuranceName}</TableCell>
                  <TableCell className="font-mono text-xs">{a.insuranceId}</TableCell>
                  <TableCell className="font-mono text-xs">{a.accountNumber}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'ACTIVE' ? 'default' : 'secondary'}>
                      {a.status}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Edit"
                          onClick={() => openEdit(a)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          title="Delete"
                          onClick={() => setDeleteTarget(a)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No insurers found yet. They appear automatically once farmers with an
                  insurance purpose are approved. Use &quot;Sync from Farmers&quot; to refresh.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Insurance Account</DialogTitle>
            <DialogDescription>
              The insurer name and account number are sourced from farmer registration
              and can&apos;t be edited here. Set the NIB insurance ID used to credit
              this insurer, and the status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="insuranceName">Insurer Name</Label>
              <Input
                id="insuranceName"
                value={form.insuranceName}
                readOnly
                disabled
                className="mt-1 bg-muted"
              />
            </div>
            <div>
              <Label htmlFor="accountNumber">Account Number (from farmer)</Label>
              <Input
                id="accountNumber"
                value={form.accountNumber}
                readOnly
                disabled
                className="mt-1 bg-muted font-mono"
              />
            </div>
            <div>
              <Label htmlFor="insuranceId">NIB Insurance ID</Label>
              <Input
                id="insuranceId"
                value={form.insuranceId}
                onChange={(e) => setForm((f) => ({ ...f, insuranceId: e.target.value }))}
                placeholder="e.g. INSURANCE001"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger id="status" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={saveForm} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete insurance account?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the mapping for{' '}
              <span className="font-semibold">{deleteTarget?.insuranceName}</span>. If it is
              referenced by existing payments, set it inactive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
