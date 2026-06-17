'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { usePermissions } from '@/hooks/use-permissions';
import type { PendingChangeWithDetails } from './page';
import type { User } from '@/lib/types';
import { ArrowLeft, Loader2 } from 'lucide-react';

type RepaymentInfo = {
  hasRepayments: boolean;
  paymentCount: number;
  totalRepaid: number;
  installmentCount: number;
  paidInstallments: number;
  payments: Array<{
    id: string;
    amount: number;
    date: string;
    installmentNumber: number | null;
    outstandingBalanceBeforePayment: number | null;
  }>;
};

export default function ReversalApprovalDetailClient({ change, currentUser, repaymentInfo }: { change: PendingChangeWithDetails; currentUser: User; repaymentInfo?: RepaymentInfo }) {
  useRequirePermission("reversal-approval");
  
  const { toast } = useToast();
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  
  const { canModule } = usePermissions();
  const canProcessApprovals = canModule("approvals", "update") || canModule("reversal-approval", "update");

  const parsedPayload = useMemo(() => {
    try {
      return JSON.parse(change.payload);
    } catch {
      return null;
    }
  }, [change.payload]);

  const isCancel = change.entityType === "DisbursementCancel" || change.entityType === "LoanCancel";
  const isPostedLoan = change.entityType === "LoanReversal" || change.entityType === "LoanCancel";
  const displayType = isCancel ? "Cancel (Mark as Success)" : "Reversal";
  const displaySubtype = isPostedLoan ? " - Posted Loan" : " - Failed Disbursement";

  const whatRequestIs = useMemo(() => {
    const who = change.createdBy?.fullName || 'Someone';
    if (isCancel) {
      return `${who} requested to mark this ${isPostedLoan ? 'posted loan' : 'failed disbursement'} as successful`;
    }
    return `${who} requested to reverse this ${isPostedLoan ? 'posted loan' : 'failed disbursement'}`;
  }, [change, isCancel, isPostedLoan]);

  const impact = useMemo(() => {
    if (isCancel) {
      return 'Approving this will mark the disbursement as successful, updating the transaction status and allowing normal loan processing to continue.';
    }
    return 'Approving this will reverse the loan, undoing all journal entries and restoring the provider balance. The loan status will be set to REVERSED.';
  }, [isCancel]);

  const details = useMemo(() => {
    if (!parsedPayload?.created) return [];
    const created = parsedPayload.created;
    const items: { label: string; value: any }[] = [];
    
    if (created.loanId) items.push({ label: 'Loan ID', value: created.loanId });
    if (created.borrowerId) items.push({ label: 'Borrower ID', value: created.borrowerId });
    if (created.creditAccount) items.push({ label: 'Credit Account', value: created.creditAccount });
    if (created.transactionId) items.push({ label: 'Transaction ID', value: created.transactionId });
    if (created.cbsTransactionId) items.push({ label: 'CBS Transaction ID', value: created.cbsTransactionId });
    if (created.amount != null) items.push({ label: 'Amount', value: Number(created.amount).toLocaleString() });
    if (created.providerId) items.push({ label: 'Provider', value: created.providerId });
    if (created.originalProviderId) items.push({ label: 'Original Provider', value: created.originalProviderId });
    if (created.isPosted != null) items.push({ label: 'Posted Loan', value: created.isPosted ? 'Yes' : 'No' });
    if (created.createdAt) items.push({ label: 'Original Created At', value: format(new Date(created.createdAt), 'PPpp') });
    
    return items;
  }, [parsedPayload]);

  const handleApprove = async () => {
    if (!canProcessApprovals) {
      toast({ title: 'Not authorized', description: 'You do not have permission to approve changes.', variant: 'destructive' });
      return;
    }
    if (change.createdById === currentUser.id) {
      toast({ title: 'Cannot approve own request', description: 'You cannot approve your own changes.', variant: 'destructive' });
      return;
    }
    
    setProcessing(true);
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeId: change.id, approved: true }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve');
      }

      toast({ title: 'Approved', description: 'The reversal request has been approved and applied.' });
      router.push('/admin/reversal-approvals');
      router.refresh();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!canProcessApprovals) {
      toast({ title: 'Not authorized', description: 'You do not have permission to reject changes.', variant: 'destructive' });
      return;
    }
    if (!rejectionReason.trim()) {
      toast({ title: 'Reason required', description: 'Please provide a reason for rejection.', variant: 'destructive' });
      return;
    }
    
    setProcessing(true);
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeId: change.id, approved: false, rejectionReason }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject');
      }

      toast({ title: 'Rejected', description: 'The reversal request has been rejected.' });
      router.push('/admin/reversal-approvals');
      router.refresh();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
      setShowRejectDialog(false);
      setRejectionReason('');
    }
  };

  const canApproveOrReject = canProcessApprovals && change.createdById !== currentUser.id && change.status === 'PENDING';

  return (
    <>
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/admin/reversal-approvals')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-3xl font-bold tracking-tight">Reversal Approval Detail</h2>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{displayType}{displaySubtype}</CardTitle>
                <CardDescription className="mt-1">{whatRequestIs}</CardDescription>
              </div>
              <Badge variant={change.status === 'PENDING' ? 'default' : change.status === 'APPROVED' ? 'secondary' : 'destructive'}>
                {change.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Request Info */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Requested By</h4>
                <p className="text-sm">{change.createdBy?.fullName || 'Unknown'}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Requested At</h4>
                <p className="text-sm">{format(new Date(change.createdAt), 'PPpp')}</p>
              </div>
              {change.providerName && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Provider</h4>
                  <p className="text-sm">{change.providerName}</p>
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Request Type</h4>
                <p className="text-sm">{change.entityType}</p>
              </div>
            </div>

            {/* Impact Warning */}
            <div className="rounded-md bg-amber-50 dark:bg-amber-950 p-4 border border-amber-200 dark:border-amber-800">
              <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">Impact</h4>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">{impact}</p>
            </div>

            {/* Details Table */}
            {details.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Request Details</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/3">Field</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.label}</TableCell>
                        <TableCell>{String(item.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Repayment Activity Warning */}
            {repaymentInfo && repaymentInfo.hasRepayments && !isCancel && (
              <div className="rounded-md bg-red-50 dark:bg-red-950 p-4 border border-red-200 dark:border-red-800 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-red-600 text-white hover:bg-red-600">Repayments Found</Badge>
                  <h4 className="text-sm font-semibold text-red-800 dark:text-red-200">
                    This loan has {repaymentInfo.paymentCount} payment{repaymentInfo.paymentCount !== 1 ? 's' : ''} totalling{' '}
                    {Number(repaymentInfo.totalRepaid).toLocaleString('en-ET', { style: 'currency', currency: 'ETB' })}
                  </h4>
                </div>
                <p className="text-sm text-red-700 dark:text-red-300">
                  Approving this reversal will <strong>also reverse all repayments</strong>, delete payment records,
                  reset all installments, and restore the full loan amount to the provider balance.
                </p>
                {repaymentInfo.installmentCount > 0 && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {repaymentInfo.paidInstallments} of {repaymentInfo.installmentCount} installment{repaymentInfo.installmentCount !== 1 ? 's' : ''} have been paid or partially paid.
                  </p>
                )}

                {repaymentInfo.payments.length > 0 && (
                  <div className="border border-red-200 dark:border-red-800 rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-red-100/50 dark:bg-red-900/30">
                          <TableHead className="text-red-800 dark:text-red-200">#</TableHead>
                          <TableHead className="text-red-800 dark:text-red-200">Date</TableHead>
                          <TableHead className="text-red-800 dark:text-red-200">Amount</TableHead>
                          <TableHead className="text-red-800 dark:text-red-200">Balance Before</TableHead>
                          <TableHead className="text-red-800 dark:text-red-200">Installment</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {repaymentInfo.payments.slice(0, 10).map((p, idx) => (
                          <TableRow key={p.id}>
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell>{(() => { try { return format(new Date(p.date), 'yyyy-MM-dd HH:mm'); } catch { return p.date; } })()}</TableCell>
                            <TableCell className="font-semibold">{Number(p.amount).toLocaleString('en-ET', { style: 'currency', currency: 'ETB' })}</TableCell>
                            <TableCell>{p.outstandingBalanceBeforePayment != null ? Number(p.outstandingBalanceBeforePayment).toLocaleString('en-ET', { style: 'currency', currency: 'ETB' }) : '—'}</TableCell>
                            <TableCell>{p.installmentNumber != null ? `#${p.installmentNumber}` : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {repaymentInfo.payments.length > 10 && (
                      <div className="text-xs text-center py-2 text-red-600 dark:text-red-400">
                        Showing 10 of {repaymentInfo.payments.length} payments
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* No repayments info for reversals */}
            {repaymentInfo && !repaymentInfo.hasRepayments && !isCancel && (
              <div className="rounded-md bg-green-50 dark:bg-green-950 p-4 border border-green-200 dark:border-green-800">
                <h4 className="text-sm font-medium text-green-800 dark:text-green-200">No Repayment Activity</h4>
                <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                  This loan has no recorded repayments. The reversal will only undo the loan disbursement and any accrued interest/penalties.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            {change.status === 'PENDING' && (
              <div className="flex justify-end gap-2 pt-4 border-t">
                {canApproveOrReject ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setShowRejectDialog(true)}
                      disabled={processing}
                      className="text-red-600 border-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      Reject
                    </Button>
                    <Button
                      onClick={handleApprove}
                      disabled={processing}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Approve
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {change.createdById === currentUser.id 
                      ? 'You cannot approve or reject your own request.' 
                      : 'You do not have permission to process this request.'}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rejection Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Reversal Request</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this reversal request.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g., The disbursement was actually successful, no reversal needed..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)} disabled={processing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={processing || !rejectionReason.trim()}
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
