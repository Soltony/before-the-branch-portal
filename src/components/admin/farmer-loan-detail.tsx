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
import { ExternalLink, ArrowLeft, PencilLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  purposeStatusBadgeVariant,
  type PurposeDisplayStatus,
} from '@/lib/lersha/farmer-purpose-status';
import { farmerStatusLabel } from '@/lib/lersha/farmer-status';
import type {
  DiffValueKind,
  FieldChange,
  PendingUpdateDiff,
} from '@/lib/lersha/farmer-update-diff';

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

/** Renders a diffed value with kind-aware formatting. */
function DiffValue({
  value,
  kind,
  tone = 'current',
}: {
  value: string | number | null;
  kind: DiffValueKind;
  tone?: 'previous' | 'current';
}) {
  const toneClass =
    tone === 'previous'
      ? 'text-muted-foreground line-through decoration-muted-foreground/50'
      : 'font-medium';
  if (value == null || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  switch (kind) {
    case 'currency':
      return (
        <span className={cn('font-mono', toneClass)}>
          {formatCurrency(Number(value))}
        </span>
      );
    case 'date':
      return (
        <span className={toneClass}>
          {formatDateSafe(String(value), 'yyyy-MM-dd')}
        </span>
      );
    case 'url':
      // Keep replaced documents clickable so reviewers can compare them.
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center gap-1 hover:underline',
            tone === 'previous' ? 'text-muted-foreground' : 'text-primary font-medium',
          )}
        >
          View document
          <ExternalLink className="h-3 w-3" />
        </a>
      );
    case 'number':
      return <span className={cn('font-mono', toneClass)}>{String(value)}</span>;
    default:
      return <span className={toneClass}>{String(value)}</span>;
  }
}

function DetailField({
  label,
  value,
  className,
  change,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  /** When set, the field is part of a pending update and gets highlighted. */
  change?: FieldChange;
}) {
  return (
    <div
      className={cn(
        className,
        change &&
          'rounded-md bg-amber-50 ring-1 ring-inset ring-amber-300 -mx-2 -my-1.5 px-2 py-1.5 dark:bg-amber-950/40 dark:ring-amber-800',
      )}
    >
      <dt className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1.5">
        {label}
        {change && (
          <span className="rounded-sm bg-amber-200/80 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900 dark:text-amber-200">
            Updated
          </span>
        )}
      </dt>
      <dd className="text-sm break-words">{value ?? '—'}</dd>
      {change && (
        <dd className="mt-1 text-xs text-muted-foreground break-words">
          Was: <DiffValue value={change.previous} kind={change.kind} tone="previous" />
        </dd>
      )}
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
  /** Borrower's own account, credited for loans and insurance alike. */
  disbursementAccountNo: string | null;
  disbursementAccountName: string | null;
  disbursementAccountSelectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  purposesTotal: number;
  isUpdated?: boolean;
  /** Diff of the unreviewed Lersha update, if one is awaiting approval. */
  pendingUpdate?: PendingUpdateDiff | null;
  loanPurposes: {
    id: string;
    productId: string | null;
    changeKind?: 'added' | 'modified' | null;
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
  // Pending-update review support: quick lookup of changed profile fields so
  // each detail field can highlight itself and show the previous value.
  const pendingUpdate = farmer.pendingUpdate?.hasChanges
    ? farmer.pendingUpdate
    : null;
  const changedFields = new Map(
    (pendingUpdate?.fields ?? []).map((c) => [c.field, c]),
  );
  const purposeChangeCount = pendingUpdate
    ? pendingUpdate.purposes.added.length +
      pendingUpdate.purposes.removed.length +
      pendingUpdate.purposes.modified.length
    : 0;
  const totalChangeCount = (pendingUpdate?.fields.length ?? 0) + purposeChangeCount;

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
            {changedFields.has('farmerName') && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Name updated — was{' '}
                <span className="line-through">
                  {changedFields.get('farmerName')!.previous}
                </span>
              </p>
            )}
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
            {pendingUpdate && (
              <Badge
                variant="outline"
                className="border-amber-500 text-amber-700"
              >
                <PencilLine className="mr-1 h-3 w-3" />
                Update pending review · {totalChangeCount}{' '}
                {totalChangeCount === 1 ? 'change' : 'changes'}
              </Badge>
            )}
            {!pendingUpdate &&
              farmer.isUpdated &&
              farmer.status !== 'PENDING_UPDATE' && (
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

      {(farmer.status === 'PENDING_UPDATE' || pendingUpdate) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          This farmer&apos;s profile was updated from Lersha.{' '}
          {pendingUpdate
            ? 'The changed fields are listed and highlighted below. Approve or reject the update'
            : 'Approve or reject the update'}{' '}
          before they can request loans, confirm OTP, or receive disbursements.
        </div>
      )}

      {pendingUpdate && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PencilLine className="h-5 w-5 text-amber-600" />
              What Changed in This Update ({totalChangeCount})
            </CardTitle>
            <CardDescription>
              Compared against the record as it was before the update
              {pendingUpdate.baselineCapturedAt
                ? ` (received ${formatDateSafe(
                    pendingUpdate.baselineCapturedAt,
                    'yyyy-MM-dd HH:mm',
                  )})`
                : ''}
              . Approving accepts the new values shown on this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {pendingUpdate.fields.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Previous Value</TableHead>
                      <TableHead>Updated Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingUpdate.fields.map((change) => (
                      <TableRow key={change.field}>
                        <TableCell className="font-medium">
                          {change.label}
                        </TableCell>
                        <TableCell>
                          <DiffValue
                            value={change.previous}
                            kind={change.kind}
                            tone="previous"
                          />
                        </TableCell>
                        <TableCell>
                          <DiffValue value={change.current} kind={change.kind} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {purposeChangeCount > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Loan Purposes ({purposeChangeCount}{' '}
                  {purposeChangeCount === 1 ? 'change' : 'changes'})
                </p>
                <ul className="space-y-2">
                  {pendingUpdate.purposes.added.map((p) => (
                    <li
                      key={`added-${p.matchKey}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">
                        Added
                      </Badge>
                      <span>{p.label}</span>
                      <span className="font-mono font-semibold">
                        {formatCurrency(p.totalCost)}
                      </span>
                    </li>
                  ))}
                  {pendingUpdate.purposes.removed.map((p) => (
                    <li
                      key={`removed-${p.matchKey}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <Badge variant="destructive">Removed</Badge>
                      <span className="line-through text-muted-foreground">
                        {p.label}
                      </span>
                      <span className="font-mono text-muted-foreground line-through">
                        {formatCurrency(p.totalCost)}
                      </span>
                    </li>
                  ))}
                  {pendingUpdate.purposes.modified.map((p) => (
                    <li key={`modified-${p.matchKey}`} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-amber-500 text-amber-700"
                        >
                          Changed
                        </Badge>
                        <span>{p.label}</span>
                        <span className="font-mono font-semibold">
                          {formatCurrency(p.totalCost)}
                        </span>
                      </div>
                      {p.changes && p.changes.length > 0 && (
                        <ul className="mt-1 ml-6 space-y-0.5 text-xs text-muted-foreground">
                          {p.changes.map((c) => (
                            <li key={c.field}>
                              {c.label}:{' '}
                              <DiffValue
                                value={c.previous}
                                kind={c.kind}
                                tone="previous"
                              />{' '}
                              →{' '}
                              <DiffValue value={c.current} kind={c.kind} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Personal Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField
                label="Phone Number"
                value={farmer.phoneNumber}
                change={changedFields.get('phoneNumber')}
              />
              <DetailField
                label="Address"
                value={farmer.address}
                change={changedFields.get('address')}
              />
              <DetailField
                label="Application Channel"
                value={farmer.applicationChannel}
                change={changedFields.get('applicationChannel')}
              />
              <DetailField
                label="Credit Score"
                value={
                  <span className="font-mono">{farmer.creditScoreValue}</span>
                }
                change={changedFields.get('creditScoreValue')}
              />
              <DetailField
                label="Score Calculation Date"
                value={formatDateSafe(farmer.scoreCalculationDate, 'yyyy-MM-dd')}
                change={changedFields.get('scoreCalculationDate')}
              />
              <DetailField
                label="Marriage Certificate"
                value={
                  <DocLink
                    url={farmer.marriageCertificateUrl}
                    label="View document"
                  />
                }
                change={changedFields.get('marriageCertificateUrl')}
              />
              <DetailField
                label="Disbursement Account"
                className="sm:col-span-2"
                value={
                  farmer.disbursementAccountNo ? (
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono font-semibold">
                        {farmer.disbursementAccountNo}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {farmer.disbursementAccountName ?? '—'}
                        {farmer.disbursementAccountSelectedAt
                          ? ` · selected ${formatDateSafe(
                              farmer.disbursementAccountSelectedAt,
                              'yyyy-MM-dd HH:mm',
                            )}`
                          : ''}
                      </span>
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                      Not selected — disbursements are blocked until an account is
                      chosen
                    </span>
                  )
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
              <DetailField
                label="Primary Crop"
                value={farmer.primaryCropType}
                change={changedFields.get('primaryCropType')}
              />
              <DetailField
                label="Farm Registry Number"
                value={farmer.farmRegistryNumber}
                change={changedFields.get('farmRegistryNumber')}
              />
              <DetailField
                label="Total Farm Size"
                value={`${farmer.totalFarmSizeInHectare} ha`}
                change={changedFields.get('totalFarmSizeInHectare')}
              />
              <DetailField
                label="Cultivated Area"
                value={`${farmer.cultivatedAreaInHectare} ha`}
                change={changedFields.get('cultivatedAreaInHectare')}
              />
              <DetailField
                label="Requested Loan Term"
                value={`${farmer.requestedLoanTermInMonth} months`}
                change={changedFields.get('requestedLoanTermInMonth')}
              />
              <DetailField
                label="Repayment Source"
                value={farmer.repaymentSource}
                change={changedFields.get('repaymentSource')}
              />
              <DetailField
                label="Requested Loan Amount"
                value={
                  <span className="font-mono font-semibold">
                    {formatCurrency(farmer.requestedLoanAmount)}
                  </span>
                }
                className="sm:col-span-2"
                change={changedFields.get('requestedLoanAmount')}
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
              <DetailField
                label="Name"
                value={farmer.emergencyContactName}
                change={changedFields.get('emergencyContactName')}
              />
              <DetailField
                label="Phone"
                value={farmer.emergencyContactPhone}
                change={changedFields.get('emergencyContactPhone')}
              />
              <DetailField
                label="Relationship"
                value={farmer.emergencyContactRelationship}
                change={changedFields.get('emergencyContactRelationship')}
              />
              <DetailField
                label="Address"
                value={farmer.emergencyContactAddress}
                className="sm:col-span-2"
                change={changedFields.get('emergencyContactAddress')}
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
                change={changedFields.get('kebeleIdDocUrl')}
              />
              <DetailField
                label="Land Certificate"
                value={
                  <DocLink
                    url={farmer.landCertificateDocUrl}
                    label="View land certificate"
                  />
                }
                change={changedFields.get('landCertificateDocUrl')}
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
            Line items from registration with current status per purpose. The
            agro dealer / insurer details are informational — disbursements are
            credited to the farmer&apos;s own account shown above.
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
                <TableRow
                  key={lp.id}
                  className={cn(
                    lp.changeKind && 'bg-amber-50/60 dark:bg-amber-950/20',
                  )}
                >
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant={purposeStatusBadgeVariant(lp.displayStatus)}
                      >
                        {lp.displayStatus}
                      </Badge>
                      {lp.changeKind === 'added' && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500 text-emerald-700"
                        >
                          New
                        </Badge>
                      )}
                      {lp.changeKind === 'modified' && (
                        <Badge
                          variant="outline"
                          className="border-amber-500 text-amber-700"
                        >
                          Updated
                        </Badge>
                      )}
                    </div>
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
