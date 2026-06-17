'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRequirePermission } from '@/hooks/use-require-permission';
import { usePermissions } from '@/hooks/use-permissions';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { isFarmerPendingApproval } from '@/lib/lersha/farmer-status';
import {
  FarmerLoanDetail,
  type FarmerDetailData,
} from '@/components/admin/farmer-loan-detail';

export default function FarmerLoanDetailPage() {
  useRequirePermission('farmer-loans');

  const params = useParams();
  const router = useRouter();
  const farmerId = params.farmerId as string;
  const { toast } = useToast();
  const { canModule } = usePermissions();
  const canDecide = canModule('farmer-loans', 'update');

  const [farmer, setFarmer] = useState<FarmerDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const rejectionReasons = [
    'Incorrect User Information',
    'Incorrect Document Information',
    'Documents Expired',
    'Other',
  ];

  const fetchFarmer = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/farmer-loans/${encodeURIComponent(farmerId)}`,
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load farmer details.');
      }
      const data = await response.json();
      setFarmer(data.farmer);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      setFarmer(null);
    } finally {
      setIsLoading(false);
    }
  }, [farmerId, toast]);

  useEffect(() => {
    fetchFarmer();
  }, [fetchFarmer]);

  const handleFarmerApproval = async (
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ) => {
    if (!farmer || !canDecide) return;

    if (!isFarmerPendingApproval(farmer.status)) {
      toast({
        title: 'Error',
        description:
          'Only pending registrations or pending updates can be approved or rejected.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/farmer/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: farmer.farmerId,
          decision,
          rejectionReason: rejectionReason || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process decision.');
      }

      toast({
        title: decision === 'APPROVED' ? 'Farmer Approved' : 'Farmer Rejected',
        description: `${farmer.farmerName} has been ${decision.toLowerCase()}.`,
        variant: decision === 'APPROVED' ? 'default' : 'destructive',
      });

      setApproveOpen(false);
      setRejectOpen(false);
      setSelectedReason('');
      setRejectReason('');
      await fetchFarmer();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!farmer) {
    return (
      <div className="p-8 pt-6 space-y-4">
        <p className="text-muted-foreground">Farmer not found.</p>
        <Button variant="outline" onClick={() => router.push('/admin/farmer-loans')}>
          Back to list
        </Button>
      </div>
    );
  }

  const headerActions =
    canDecide && isFarmerPendingApproval(farmer.status) ? (
      <div className="flex gap-2">
        <Button
          className="gap-1"
          onClick={() => setApproveOpen(true)}
          disabled={isSubmitting}
        >
          <CheckCircle className="h-4 w-4" />
          Approve Registration
        </Button>
        <Button
          variant="destructive"
          className="gap-1"
          onClick={() => setRejectOpen(true)}
          disabled={isSubmitting}
        >
          <XCircle className="h-4 w-4" />
          Reject Registration
        </Button>
      </div>
    ) : null;

  return (
    <>
      <FarmerLoanDetail
        farmer={farmer}
        backHref="/admin/farmer-loans"
        headerActions={headerActions}
      />

      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Farmer Registration?</AlertDialogTitle>
            <AlertDialogDescription>
              Approve registration for <strong>{farmer.farmerName}</strong>.
              Once approved, this farmer can request loans for their purposes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleFarmerApproval('APPROVED')}
              disabled={isSubmitting}
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) {
            setSelectedReason('');
            setRejectReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Farmer Registration</DialogTitle>
            <DialogDescription>
              Select a reason for rejecting {farmer.farmerName}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label htmlFor="reasonSelect">Select Reason</Label>
              <Select value={selectedReason} onValueChange={setSelectedReason}>
                <SelectTrigger id="reasonSelect" className="mt-2">
                  <SelectValue placeholder="Choose a rejection reason..." />
                </SelectTrigger>
                <SelectContent>
                  {rejectionReasons.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedReason === 'Other' && (
              <div>
                <Label htmlFor="customReason">Custom Reason</Label>
                <Textarea
                  id="customReason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Please specify the rejection reason..."
                  className="mt-2"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={
                !selectedReason ||
                (selectedReason === 'Other' && !rejectReason.trim()) ||
                isSubmitting
              }
              onClick={() => {
                const finalReason =
                  selectedReason === 'Other'
                    ? rejectReason.trim()
                    : selectedReason;
                if (finalReason) handleFarmerApproval('REJECTED', finalReason);
              }}
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
