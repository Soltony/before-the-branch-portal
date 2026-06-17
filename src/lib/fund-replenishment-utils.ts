export { formatCurrency } from "@/lib/tax-transfer-utils";

export type FundReplenishmentRecord = {
  id: string;
  providerId: string;
  amount: number;
  remarks?: string | null;
  replenishmentDate: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: string;
  recordedByUser?: { id: string; fullName: string; email: string } | null;
};

export type FundReplenishmentSummary = {
  providerId: string;
  providerName: string;
  startingCapital: number;
  initialBalance: number;
  totalReplenished: number;
  maxReplenishable: number;
};
