export function formatCurrency(amount: number | null | undefined) {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function clampNonNegative(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

export type TaxTransferStatus = "SIMULATED" | "REVERSED";

export type TaxTransferSimulation = {
  id: string;
  providerId: string;
  transferAmount: number;
  destinationAccountName: string;
  transferReference: string;
  transferDate: string;
  status: TaxTransferStatus;
  notes?: string | null;
  createdAt: string;
  recordedByUser?: { id: string; fullName: string; email: string } | null;
  reversedByUser?: { id: string; fullName: string; email: string } | null;
  reversalReason?: string | null;
  reversedAt?: string | null;
};

export type TaxTransferSummary = {
  providerId: string;
  taxHoldingAccount: { id: string; name: string; balance: number } | null;
  destinationAccounts: Array<{ id: string; name: string; balance: number }>;
};

