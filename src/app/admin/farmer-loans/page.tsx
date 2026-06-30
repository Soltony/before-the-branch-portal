'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useRequirePermission } from '@/hooks/use-require-permission';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Eye,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { format } from 'date-fns';
import {
  isFarmerPendingApproval,
  farmerStatusLabel,
} from '@/lib/lersha/farmer-status';

// ── Types ──────────────────────────────────────────

interface LoanPurpose {
  id: string;
  productId: string | null;
  loanPurpose: string;
  specificVarietyName: string | null;
  quantity: number | null;
  unitOfMeasurement: string | null;
  unitPrice: number | null;
  totalCost: number;
  agroDealerName: string | null;
  agroDealerAccountNo: string | null;
  insuranceName: string | null;
}

interface LoanRequest {
  id: string;
  status: string;
  referenceNo: string | null;
  otpVerified: boolean;
  lershaDecisionSentAt: string | null;
  createdAt: string;
}

interface LoanContract {
  id: string;
  status: string;
  contractCode: string;
  languageCode: string;
  signedAt: string | null;
  createdAt: string;
}

interface Farmer {
  id: string;
  farmerId: string;
  farmerName: string;
  phoneNumber: string;
  primaryCropType: string;
  totalFarmSizeInHectare: number;
  cultivatedAreaInHectare: number;
  requestedLoanAmount: number;
  requestedLoanTermInMonth: number;
  creditScoreValue: number;
  applicationChannel: string;
  status: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  createdAt: string;
  updatedAt: string;
  isUpdated?: boolean;
  loanPurposes: LoanPurpose[];
  loanRequests: LoanRequest[];
  loanContracts: LoanContract[];
}

// ── Helpers ────────────────────────────────────────

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ETB';

const statusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status.toUpperCase()) {
    case 'APPROVED':
    case 'DISBURSED':
    case 'SIGNED':
      return 'default';
    case 'DECLINED':
    case 'REJECTED':
    case 'EXPIRED':
      return 'destructive';
    case 'PENDING':
    case 'PENDING_UPDATE':
    case 'PENDING_OTP':
    case 'OTP_VERIFIED':
      return 'secondary';
    default:
      return 'outline';
  }
};

const statusLabel = (status: string): string => {
  if (status.toUpperCase() === 'OTP_VERIFIED') return 'AUTO DISBURSING';
  if (status.toUpperCase() === 'PENDING_OTP') return 'PENDING OTP';
  return farmerStatusLabel(status);
};

const contractStatusLabel = (status: string): string => {
  switch (status.toUpperCase()) {
    case 'SIGNED':
      return 'SIGNED';
    case 'PENDING':
      return 'AWAITING SIGNATURE';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return status.replace(/_/g, ' ');
  }
};

const ITEMS_PER_PAGE = 20;

// ── Main Page ──────────────────────────────────────

export default function FarmerLoansPage() {
  useRequirePermission('farmer-loans');
  const router = useRouter();

  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  type ActionType = 'approveRegistration' | 'rejectRegistration';
  const [actionState, setActionState] = useState<{
    type: ActionType;
    farmer: Farmer | null;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedReason, setSelectedReason] = useState('');

  const rejectionReasons = [
    'Incorrect User Information',
    'Incorrect Document Information',
    'Documents Expired',
    'Other',
  ];

  const { toast } = useToast();
  const { canModule } = usePermissions();
  const canDecide = canModule('farmer-loans', 'update');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value === 'ALL' ? '' : value);
    setPage(1);
  }, []);

  const clearFilters = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    setStatusFilter('');
    setPage(1);
  };

  const hasActiveFilters = debouncedSearch || statusFilter;

  // Fetch
  const fetchFarmers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(ITEMS_PER_PAGE),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);

      const response = await fetch(`/api/farmer-loans?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch farmers.');
      const data = await response.json();
      setFarmers(data.farmers);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, toast]);

  useEffect(() => {
    fetchFarmers();
  }, [fetchFarmers]);

  // NOTE: Loan disbursement is fully automatic after OTP verification.
  // No manual admin decision is required for the loan itself.

  // Handle farmer registration approval/rejection
  const handleFarmerApproval = async (
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ) => {
    const farmer = actionState?.farmer;
    if (!farmer || !canDecide) return;

    if (!isFarmerPendingApproval(farmer.status)) {
      toast({
        title: 'Error',
        description: 'Only pending registrations or pending updates can be approved or rejected.',
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

      const result = await response.json();

      toast({
        title: decision === 'APPROVED' ? 'Farmer Approved' : 'Farmer Rejected',
        description: `${farmer.farmerName} has been ${decision.toLowerCase()}.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        variant: decision === 'APPROVED' ? 'default' : 'destructive',
      });

      fetchFarmers();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
      setActionState(null);
    }
  };

  return (
    <>
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Farmer Loans</h2>
          <p className="text-muted-foreground">
            Registered farmers from Lersha integration. Re-sending Send Farmer Details
            for the same Farmer ID updates the existing record (upsert).
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground mb-1 block">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, ID, phone, crop..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="w-full md:w-[200px]">
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <Select value={statusFilter || 'ALL'} onValueChange={handleStatusChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="PENDING_UPDATE">Update Pending Approval</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="DECLINED">Declined</SelectItem>
                    <SelectItem value="DISBURSED">Disbursed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-10 gap-1">
                  <X className="h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Registered Farmers</CardTitle>
            <CardDescription>
              {total} farmer{total !== 1 ? 's' : ''} registered — sorted by most
              recently updated
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Farmer ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Crop</TableHead>
                  <TableHead className="text-right">Loan Amount</TableHead>
                  <TableHead>Credit Score</TableHead>
                  <TableHead>Registration</TableHead>
                  <TableHead>Loan Status</TableHead>
                  <TableHead>Contract</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : farmers.length > 0 ? (
                  farmers.map((farmer) => {
                    const latestRequest = farmer.loanRequests[0];
                    const latestContract = farmer.loanContracts?.[0];
                    const isUpdated =
                      farmer.isUpdated ??
                      new Date(farmer.updatedAt).getTime() -
                        new Date(farmer.createdAt).getTime() >
                        60_000;

                    return (
                      <TableRow key={farmer.id}>
                        <TableCell className="font-mono text-xs">
                          {farmer.farmerId}
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            {farmer.farmerName}
                            {isUpdated && farmer.status === 'PENDING_UPDATE' && (
                              <Badge variant="outline" className="text-xs border-amber-500 text-amber-700">
                                Re-approval required
                              </Badge>
                            )}
                            {isUpdated && farmer.status !== 'PENDING_UPDATE' && (
                              <Badge variant="outline" className="text-xs">
                                Updated
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{farmer.phoneNumber}</TableCell>
                        <TableCell>{farmer.primaryCropType}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(farmer.requestedLoanAmount)}
                        </TableCell>
                        <TableCell className="font-mono">
                          {farmer.creditScoreValue}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(farmer.status)}>
                            {statusLabel(farmer.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {latestRequest ? (
                            <Badge variant={statusVariant(latestRequest.status)}>
                              {statusLabel(latestRequest.status)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No loan request
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {latestContract ? (
                            <div className="flex flex-col gap-1">
                              <Badge variant={statusVariant(latestContract.status)}>
                                {contractStatusLabel(latestContract.status)}
                              </Badge>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {latestContract.contractCode}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No contract
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {format(new Date(farmer.createdAt), 'yyyy-MM-dd')}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              isUpdated ? 'font-medium text-foreground' : ''
                            }
                          >
                            {format(new Date(farmer.updatedAt), 'yyyy-MM-dd HH:mm')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="View full farmer details"
                              onClick={() =>
                                router.push(`/admin/farmer-loans/${farmer.id}`)
                              }
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canDecide && isFarmerPendingApproval(farmer.status) && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-green-600 hover:text-green-700"
                                  title="Approve farmer registration"
                                  onClick={() =>
                                    setActionState({ type: 'approveRegistration', farmer })
                                  }
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-600 hover:text-red-700"
                                  title="Reject farmer registration"
                                  onClick={() =>
                                    setActionState({ type: 'rejectRegistration', farmer })
                                  }
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {/* Loan disbursement is automatic after OTP — no manual action needed here */}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={12} className="h-24 text-center">
                      No farmers found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
      </div>

      <AlertDialog
        open={actionState?.type === 'approveRegistration' && !!actionState.farmer}
        onOpenChange={(open) => !open && setActionState(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Farmer Registration?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to approve the farmer registration for{' '}
              <span className="font-bold">{actionState?.farmer?.farmerName}</span>
              . Once approved, this farmer can proceed to request a loan.
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
              Approve Registration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Reject Farmer Registration Dialog ── */}
      <Dialog
        open={actionState?.type === 'rejectRegistration' && !!actionState.farmer}
        onOpenChange={(open) => {
          if (!open) {
            setActionState(null);
            setRejectReason('');
            setSelectedReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Farmer Registration</DialogTitle>
            <DialogDescription>
              Please select a reason for rejecting the registration of{' '}
              <span className="font-semibold">{actionState?.farmer?.farmerName}</span>.
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
              onClick={() => {
                const finalReason =
                  selectedReason === 'Other'
                    ? rejectReason.trim()
                    : selectedReason;
                if (finalReason) {
                  handleFarmerApproval('REJECTED', finalReason);
                  setRejectReason('');
                  setSelectedReason('');
                }
              }}
              disabled={
                !selectedReason ||
                (selectedReason === 'Other' && !rejectReason.trim()) ||
                isSubmitting
              }
              variant="destructive"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Reject Registration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
