'use client';

import React, { useState } from 'react';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Check, X, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { PendingChangeWithDetails, PaginatedPendingChanges } from './page';
import type { User } from '@/lib/types';
import { usePermissions } from '@/hooks/use-permissions';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';


// Detailed change dialog and diff/preview helpers removed — details now live on
// /admin/approvals/[id] as a simplified, accessible full-page view.


export function ApprovalsClient({
  paginatedData: initialData,
  currentUser,
}: {
  paginatedData: PaginatedPendingChanges;
  currentUser: User;
}) {
  useRequirePermission('approvals');
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const changes = initialData.data.filter(c => !removedIds.has(c.id));
  const [rejectionReason, setRejectionReason] = useState('');
  const [changeToReject, setChangeToReject] = useState<PendingChangeWithDetails | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const { canModule } = usePermissions();
  const canProcessApprovals = canModule('approvals', 'update');


  const handleProcessChange = async (changeId: string, approved: boolean, reason?: string) => {
    if (!canProcessApprovals) {
      toast({ title: 'Not authorized', description: 'You are not authorized to approve or reject changes.', variant: 'destructive' });
      return;
    }
    setProcessingId(changeId);
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeId, approved, rejectionReason: reason }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${approved ? 'approve' : 'reject'} change.`);
      }

      setRemovedIds(prev => new Set([...prev, changeId]));
      toast({
        title: 'Success',
        description: `Change has been successfully ${approved ? 'approved' : 'rejected'}.`,
      });

      if (approved) {
          router.refresh();
      }

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
      setChangeToReject(null);
      setRejectionReason('');
    }
  };

  const handlePageChange = (page: number) => {
    router.push(`?page=${page}`);
  };

  const renderPaginationItems = () => {
    const items = [];
    const maxVisible = 5;
    const { page, totalPages } = initialData;

    // Always show first page
    if (page > 1) {
      items.push(
        <PaginationItem key="prev">
          <PaginationPrevious
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handlePageChange(page - 1);
            }}
          />
        </PaginationItem>
      );
    }

    // Calculate page range
    let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    // Show ellipsis before
    if (startPage > 1) {
      items.push(
        <PaginationItem key="ellipsis-start">
          <PaginationEllipsis />
        </PaginationItem>
      );
    }

    // Show page numbers
    for (let i = startPage; i <= endPage; i++) {
      items.push(
        <PaginationItem key={i}>
          <PaginationLink
            href="#"
            isActive={i === page}
            onClick={(e) => {
              e.preventDefault();
              handlePageChange(i);
            }}
          >
            {i}
          </PaginationLink>
        </PaginationItem>
      );
    }

    // Show ellipsis after
    if (endPage < totalPages) {
      items.push(
        <PaginationItem key="ellipsis-end">
          <PaginationEllipsis />
        </PaginationItem>
      );
    }

    // Always show next button
    if (page < totalPages) {
      items.push(
        <PaginationItem key="next">
          <PaginationNext
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handlePageChange(page + 1);
            }}
          />
        </PaginationItem>
      );
    }

    return items;
  };

  return (
    <>
      <div className="flex-1 space-y-4 p-8 pt-6">
        <h2 className="text-3xl font-bold tracking-tight">Pending Approvals</h2>
        <Card>
          <CardHeader>
            <CardTitle>Change Requests</CardTitle>
            <CardDescription>Review and approve or reject pending changes made by other users.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Requested At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : changes.length > 0 ? (
                  changes.map(change => (
                    <TableRow key={change.id}>
                      <TableCell className="font-medium">
                        <div>{change.entityType}</div>
                        <div className="text-sm text-muted-foreground">{change.entityName}</div>
                         {change.providerName && <div className="text-xs text-muted-foreground">({change.providerName})</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={change.changeType === 'DELETE' ? 'destructive' : 'secondary'}>{change.changeType}</Badge>
                      </TableCell>
                      <TableCell>{change.createdBy?.fullName || 'Unknown User'}</TableCell>
                      <TableCell>{formatDistanceToNow(new Date(change.createdAt), { addSuffix: true })}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(`/admin/approvals/${change.id}`)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canProcessApprovals && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleProcessChange(change.id, true)}
                              disabled={processingId === change.id || change.createdById === currentUser.id}
                              className="text-green-600 border-green-600 hover:bg-green-50 hover:text-green-700"
                            >
                              {processingId === change.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setChangeToReject(change)}
                              disabled={processingId === change.id || change.createdById === currentUser.id}
                               className="text-red-600 border-red-600 hover:bg-red-50 hover:text-red-700"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No pending approvals for you to review.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {initialData.totalPages > 1 && (
              <div className="mt-6 flex justify-center">
                <Pagination>
                  <PaginationContent>{renderPaginationItems()}</PaginationContent>
                </Pagination>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog open={!!changeToReject} onOpenChange={() => setChangeToReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Change</DialogTitle>
            <DialogDescription>Please provide a reason for rejecting this change.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="e.g., Incorrect configuration..."
              disabled={!canProcessApprovals}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeToReject(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => handleProcessChange(changeToReject!.id, false, rejectionReason)}
              disabled={!canProcessApprovals || !rejectionReason.trim()}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Approval details are now on their own page: /admin/approvals/[id] */}
    </>
  );
}
