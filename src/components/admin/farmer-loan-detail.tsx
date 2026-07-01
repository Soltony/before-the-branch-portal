'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { ExternalLink, ArrowLeft } from 'lucide-react';
import {
  purposeStatusBadgeVariant,
  type PurposeDisplayStatus,
} from '@/lib/lersha/farmer-purpose-status';
import { farmerStatusLabel } from '@/lib/lersha/farmer-status';

export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ETB';

export const farmerStatusVariant = (
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status.toUpperCase()) {
    case 'APPROVED':
    case 'DISBURSED':
      return 'default';
    case 'DECLINED':
    case 'REJECTED':
      return 'destructive';
    case 'EXPIRED':
      return 'outline';
    case 'PENDING':
    case 'PENDING_UPDATE':
      return 'secondary';
    default:
      return 'outline';
  }
};

function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground mb-0.5">{label}</dt>
      <dd className="text-sm break-words">{value ?? '—'}</dd>
    </div>
  );
}

function DocLink({ url, label }: { url: string | null; label: string }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function formatDateSafe(
  value: string | Date | null | undefined,
  pattern: string,
): string {
  if (value == null) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, pattern);
}

export interface FarmerDetailData {
  id: string;
  farmerId: string;
  farmerName: string;
  phoneNumber: string;
  kebeleIdDocUrl: string;
  landCertificateDocUrl: string;
  totalFarmSizeInHectare: number;
  cultivatedAreaInHectare: number;
  primaryCropType: string;
  farmRegistryNumber: string;
  requestedLoanAmount: number;
  repaymentSource: string;
  requestedLoanTermInMonth: number;
  applicationChannel: string;
  creditScoreValue: number;
  scoreCalculationDate: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  emergencyContactAddress: string;
  status: string;
  marriageCertificateUrl: string | null;
  address: string;
  createdAt: string;
  updatedAt: string;
  purposesTotal: number;
  isUpdated?: boolean;
  loanPurposes: {
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
    createdAt: string;
    displayStatus: PurposeDisplayStatus;
    loanRequest: {
      id: string;
      status: string;
      referenceNo: string | null;
      otpVerified: boolean;
      remainingBalance: number | null;
      disbursementConfirmedAt: string | null;
      lershaDecisionSentAt: string | null;
      createdAt: string;
    } | null;
    linkedLoan: {
      id: string;
      loanAmount: number;
      repaymentStatus: string;
      disbursedDate: string;
      dueDate: string;
      repaidAmount: number;
      productName: string | null;
    } | null;
    insurancePayment: {
      id: string;
      status: string;
      insuranceName: string | null;
      transactionId: string | null;
      remainingBalance: number | null;
      requestedAt: string;
      confirmedAt: string | null;
    } | null;
  }[];
  loanRequests: {
    id: string;
    productId: string;
    status: string;
    displayStatus: string;
    referenceNo: string | null;
    otpVerified: boolean;
    remainingBalance: number | null;
    disbursementConfirmedAt: string | null;
    lershaDecisionSentAt: string | null;
    createdAt: string;
  }[];
  borrowerLoans: {
    id: string;
    loanAmount: number;
    repaymentStatus: string;
    disbursedDate: string;
    dueDate: string;
    productName: string | null;
  }[];
}

interface FarmerLoanDetailProps {
  farmer: FarmerDetailData;
  backHref?: string;
  headerActions?: React.ReactNode;
}

export function FarmerLoanDetail({
  farmer,
  backHref = '/admin/farmer-loans',
  headerActions,
}: FarmerLoanDetailProps) {
  // The Loan Requests table lists both loan requests and insurance payments.
  // Insurance is funded via a LershaInsurancePayment (no loan request / OTP),
  // so normalise both into a common row shape and sort newest-first.
  type RequestRow = {
    key: string;
    kind: 'loan' | 'insurance';
    displayStatus: string;
    productId: string;
    reference: string | null;
    otpVerified: boolean | null;
    remainingBalance: number | null;
    disbursedAt: string | null;
    requestedAt: string;
  };

  const insuranceStatusLabel = (status: string): string => {
    switch (status.toUpperCase()) {
      case 'SUCCESS':
        return 'DISBURSED';
      case 'REQUESTED':
        return 'PENDING';
      default:
        return status.toUpperCase();
    }
  };

  const requestRows: RequestRow[] = [
    ...farmer.loanRequests.map((req) => ({
      key: `req-${req.id}`,
      kind: 'loan' as const,
      displayStatus: req.displayStatus,
      productId: req.productId,
      reference: req.referenceNo,
      otpVerified: req.otpVerified,
      remainingBalance: req.remainingBalance,
      disbursedAt: req.disbursementConfirmedAt,
      requestedAt: req.createdAt,
    })),
    ...farmer.loanPurposes
      .filter((lp) => lp.insurancePayment)
      .map((lp) => {
        const p = lp.insurancePayment!;
        return {
          key: `ins-${p.id}`,
          kind: 'insurance' as const,
          displayStatus: insuranceStatusLabel(p.status),
          productId: lp.productId ?? '—',
          reference: p.transactionId,
          otpVerified: null,
          remainingBalance: p.remainingBalance,
          disbursedAt: p.confirmedAt,
          requestedAt: p.requestedAt,
        };
      }),
  ].sort(
    (a, b) =>
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
  );

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 gap-1" asChild>
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              Back to Farmer Loans
            </Link>
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              {farmer.farmerName}
            </h2>
            <p className="text-muted-foreground font-mono text-sm">
              Farmer ID: {farmer.farmerId}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={farmerStatusVariant(farmer.status)}>
              Registration: {farmerStatusLabel(farmer.status)}
            </Badge>
            {farmer.status === 'PENDING_UPDATE' && (
              <Badge variant="outline" className="border-amber-500 text-amber-700">
                Loan processing blocked until re-approved
              </Badge>
            )}
            {farmer.isUpdated && farmer.status !== 'PENDING_UPDATE' && (
              <Badge variant="outline">Profile updated from Lersha</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Registered {formatDateSafe(farmer.createdAt, 'yyyy-MM-dd HH:mm')}
            </span>
            <span className="text-xs text-muted-foreground">
              Last updated {formatDateSafe(farmer.updatedAt, 'yyyy-MM-dd HH:mm')}
            </span>
          </div>
        </div>
        {headerActions}
      </div>

      {farmer.status === 'PENDING_UPDATE' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          This farmer&apos;s profile was updated from Lersha. Approve or reject the
          update before they can request loans, confirm OTP, or receive disbursements.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Personal Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField label="Phone Number" value={farmer.phoneNumber} />
              <DetailField label="Address" value={farmer.address} />
              <DetailField
                label="Application Channel"
                value={farmer.applicationChannel}
              />
              <DetailField
                label="Credit Score"
                value={
                  <span className="font-mono">{farmer.creditScoreValue}</span>
                }
              />
              <DetailField
                label="Score Calculation Date"
                value={formatDateSafe(farmer.scoreCalculationDate, 'yyyy-MM-dd')}
              />
              <DetailField
                label="Marriage Certificate"
                value={
                  <DocLink
                    url={farmer.marriageCertificateUrl}
                    label="View document"
                  />
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Farm Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField label="Primary Crop" value={farmer.primaryCropType} />
              <DetailField
                label="Farm Registry Number"
                value={farmer.farmRegistryNumber}
              />
              <DetailField
                label="Total Farm Size"
                value={`${farmer.totalFarmSizeInHectare} ha`}
              />
              <DetailField
                label="Cultivated Area"
                value={`${farmer.cultivatedAreaInHectare} ha`}
              />
              <DetailField
                label="Requested Loan Term"
                value={`${farmer.requestedLoanTermInMonth} months`}
              />
              <DetailField
                label="Repayment Source"
                value={farmer.repaymentSource}
              />
              <DetailField
                label="Requested Loan Amount"
                value={
                  <span className="font-mono font-semibold">
                    {formatCurrency(farmer.requestedLoanAmount)}
                  </span>
                }
                className="sm:col-span-2"
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Emergency Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField label="Name" value={farmer.emergencyContactName} />
              <DetailField label="Phone" value={farmer.emergencyContactPhone} />
              <DetailField
                label="Relationship"
                value={farmer.emergencyContactRelationship}
              />
              <DetailField
                label="Address"
                value={farmer.emergencyContactAddress}
                className="sm:col-span-2"
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Documents</CardTitle>
            <CardDescription>
              Links from the registration payload
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <DetailField
                label="Kebele ID"
                value={
                  <DocLink url={farmer.kebeleIdDocUrl} label="View Kebele ID" />
                }
              />
              <DetailField
                label="Land Certificate"
                value={
                  <DocLink
                    url={farmer.landCertificateDocUrl}
                    label="View land certificate"
                  />
                }
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Loan Purposes ({farmer.loanPurposes.length})
          </CardTitle>
          <CardDescription>
            Line items from registration with current status per purpose
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Product ID</TableHead>
                <TableHead>Variety / Provider</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Agro Dealer</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {farmer.loanPurposes.map((lp) => (
                <TableRow key={lp.id}>
                  <TableCell>
                    <Badge variant={purposeStatusBadgeVariant(lp.displayStatus)}>
                      {lp.displayStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{lp.loanPurpose}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[120px] truncate">
                    {lp.productId ?? '—'}
                  </TableCell>
                  <TableCell>
                    {lp.specificVarietyName ||
                      lp.insuranceName ||
                      '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {lp.quantity != null
                      ? `${lp.quantity} ${lp.unitOfMeasurement || ''}`.trim()
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {lp.unitPrice != null ? formatCurrency(lp.unitPrice) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatCurrency(lp.totalCost)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {lp.agroDealerName ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {lp.agroDealerAccountNo ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {lp.loanRequest?.referenceNo ??
                      lp.insurancePayment?.transactionId ??
                      '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-4 text-sm">
            <span className="text-muted-foreground">
              Sum of purpose totals:{' '}
              <span className="font-mono font-semibold text-foreground">
                {formatCurrency(farmer.purposesTotal)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Requested total:{' '}
              <span className="font-mono font-semibold text-foreground">
                {formatCurrency(farmer.requestedLoanAmount)}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      {requestRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Loan Requests</CardTitle>
            <CardDescription>
              All loan and insurance requests submitted for this farmer
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Product ID</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>OTP Verified</TableHead>
                  <TableHead className="text-right">Remaining Balance</TableHead>
                  <TableHead>Disbursed At</TableHead>
                  <TableHead>Requested At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requestRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <Badge variant={farmerStatusVariant(row.displayStatus)}>
                        {row.displayStatus.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.kind === 'insurance' ? 'Insurance' : 'Loan'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.productId}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.reference ?? '—'}
                    </TableCell>
                    <TableCell>
                      {row.otpVerified == null
                        ? 'N/A'
                        : row.otpVerified
                          ? 'Yes'
                          : 'No'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.remainingBalance != null
                        ? formatCurrency(row.remainingBalance)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {formatDateSafe(row.disbursedAt, 'yyyy-MM-dd HH:mm')}
                    </TableCell>
                    <TableCell>
                      {formatDateSafe(row.requestedAt, 'yyyy-MM-dd HH:mm')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {farmer.borrowerLoans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">MLS Loan Records</CardTitle>
            <CardDescription>
              Loans booked in the microcredit system for this borrower
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loan ID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Repayment Status</TableHead>
                  <TableHead>Disbursed</TableHead>
                  <TableHead>Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {farmer.borrowerLoans.map((loan) => (
                  <TableRow key={loan.id}>
                    <TableCell className="font-mono text-xs">
                      {loan.id.slice(-8)}
                    </TableCell>
                    <TableCell>{loan.productName ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(loan.loanAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={farmerStatusVariant(loan.repaymentStatus)}>
                        {loan.repaymentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDateSafe(loan.disbursedDate, 'yyyy-MM-dd')}
                    </TableCell>
                    <TableCell>
                      {formatDateSafe(loan.dueDate, 'yyyy-MM-dd')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Record Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailField
              label="Internal ID"
              value={<span className="font-mono text-xs">{farmer.id}</span>}
            />
            <DetailField
              label="Last Updated"
              value={formatDateSafe(farmer.updatedAt, 'yyyy-MM-dd HH:mm')}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
