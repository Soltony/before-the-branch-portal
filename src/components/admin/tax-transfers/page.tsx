"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  clampNonNegative,
  formatCurrency,
  TaxTransferSimulation,
  TaxTransferSummary,
} from "@/lib/tax-transfer-utils";
import { TaxTransferForm, type TaxTransferDraft } from "./form";
import { TaxTransferBalanceSummary } from "./balance-summary";
import { TaxTransferHistory } from "./history";

type ProviderOption = { id: string; name: string };

function parseAmountLoose(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return 0;
  // allow users to paste formatted numbers like "29,947.10"
  const normalized = raw.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToIso(ymd: string) {
  // Date-only input from browser is local; normalize to ISO with noon to avoid timezone edge cases
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  if (!y || !m || !d) return new Date().toISOString();
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

export default function TaxTransfersPage() {
  useRequirePermission("tax-transfers");
  const { toast } = useToast();
  const { canModule } = usePermissions();
  const canCreate = canModule("tax-transfers", "create");
  const canReverse = canModule("tax-transfers", "update");

  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [summary, setSummary] = useState<TaxTransferSummary | null>(null);
  const [transfers, setTransfers] = useState<TaxTransferSimulation[]>([]);

  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [draft, setDraft] = useState<TaxTransferDraft>({
    providerId: "",
    transferAmount: "",
    destinationAccountName: "",
    transferReference: "",
    transferDate: todayYmd(),
    notes: "",
  });

  const holdingBalance = summary?.taxHoldingAccount?.balance ?? 0;
  const parsedAmount = parseAmountLoose(draft.transferAmount);
  const postBalance = useMemo(() => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return holdingBalance;
    return clampNonNegative(holdingBalance - parsedAmount);
  }, [holdingBalance, parsedAmount]);

  async function fetchProviders() {
    setLoadingProviders(true);
    try {
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed to load providers");
      const data = await res.json();
      const opts: ProviderOption[] = (data ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
      }));
      setProviders(opts);

      // Keep current provider if still valid; else set first
      setDraft((prev) => {
        const stillValid = opts.some((p) => p.id === prev.providerId);
        if (stillValid) return prev;
        return { ...prev, providerId: opts[0]?.id ?? "" };
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not load providers.",
        variant: "destructive",
      });
    } finally {
      setLoadingProviders(false);
    }
  }

  async function fetchSummary(providerId: string) {
    if (!providerId) return;
    setLoadingSummary(true);
    try {
      const res = await fetch(
        `/api/tax-transfers?summary=true&providerId=${encodeURIComponent(
          providerId
        )}`
      );
      if (!res.ok) throw new Error("Failed to load tax transfer summary");
      const data = (await res.json()) as TaxTransferSummary;
      setSummary(data);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not load balances.",
        variant: "destructive",
      });
    } finally {
      setLoadingSummary(false);
    }
  }

  async function fetchTransfers(providerId: string) {
    if (!providerId) return;
    setLoadingTransfers(true);
    try {
      const res = await fetch(
        `/api/tax-transfers?providerId=${encodeURIComponent(
          providerId
        )}&page=1&limit=100`
      );
      if (!res.ok) throw new Error("Failed to load transfer history");
      const json = await res.json();
      setTransfers((json?.data ?? []) as TaxTransferSimulation[]);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not load transfer history.",
        variant: "destructive",
      });
    } finally {
      setLoadingTransfers(false);
    }
  }

  async function refreshAll(providerId: string) {
    await Promise.all([fetchSummary(providerId), fetchTransfers(providerId)]);
  }

  useEffect(() => {
    fetchProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draft.providerId) return;
    refreshAll(draft.providerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.providerId]);

  async function postTransfer() {
    if (!draft.providerId) return;
    setPosting(true);
    try {
      const amount = parseAmountLoose(draft.transferAmount);
      const payload = {
        providerId: draft.providerId,
        transferAmount: amount,
        destinationAccountName: draft.destinationAccountName.trim(),
        transferReference: draft.transferReference.trim(),
        transferDate: ymdToIso(draft.transferDate),
        notes: draft.notes?.trim() || undefined,
      };

      const res = await fetch("/api/tax-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Failed to post transfer");
      }

      toast({
        title: "Posted",
        description: `Transfer recorded. Ref: ${payload.transferReference}`,
      });

      setConfirmOpen(false);
      setDraft((prev) => ({
        ...prev,
        transferAmount: "",
        transferReference: "",
        notes: "",
      }));
      await refreshAll(draft.providerId);
    } catch (e: any) {
      toast({
        title: "Posting failed",
        description: e?.message ?? "Could not post transfer.",
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  }

  async function reverseTransfer(transferSimulationId: string, reason: string) {
    setPosting(true);
    try {
      const res = await fetch("/api/tax-transfers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferSimulationId, reversalReason: reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to reverse transfer");

      toast({ title: "Reversed", description: "Transfer has been reversed." });
      if (draft.providerId) await refreshAll(draft.providerId);
    } catch (e: any) {
      toast({
        title: "Reversal failed",
        description: e?.message ?? "Could not reverse transfer.",
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  }

  const destinationAccounts = summary?.destinationAccounts ?? [];

  const confirmDetails = useMemo(() => {
    return {
      provider: providers.find((p) => p.id === draft.providerId)?.name ?? "",
      amount: parseAmountLoose(draft.transferAmount),
      destination: draft.destinationAccountName.trim(),
      reference: draft.transferReference.trim(),
      transferDate: draft.transferDate,
    };
  }, [draft, providers]);

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Tax Transfers</h2>
          <p className="text-muted-foreground">
            Simulate manual transfers of collected inclusive tax with
            double-entry journal postings and audit trail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => draft.providerId && refreshAll(draft.providerId)}
            disabled={!draft.providerId || loadingSummary || loadingTransfers}
          >
            {loadingSummary || loadingTransfers ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {loadingProviders ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <Loader2 className="h-6 w-6 animate-spin" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TaxTransferBalanceSummary
            holdingBalance={holdingBalance}
            postBalance={Number.isFinite(parsedAmount) ? postBalance : null}
          />
          <div className="lg:col-span-2">
            <TaxTransferForm
              providers={providers}
              destinationAccounts={destinationAccounts}
              holdingBalance={holdingBalance}
              draft={draft}
              onChange={setDraft}
              disabled={posting || loadingSummary || loadingTransfers}
              canCreate={canCreate}
              onSubmit={() => setConfirmOpen(true)}
            />
          </div>
        </div>
      )}

      <TaxTransferHistory
        transfers={transfers}
        canReverse={canReverse}
        onReverse={reverseTransfer}
        busy={posting}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm posting</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a balanced journal entry and update the collected
              inclusive tax holding balance.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium">{confirmDetails.provider}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Reference</span>
              <span className="font-mono">{confirmDetails.reference}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Transfer date</span>
              <span className="font-medium">{confirmDetails.transferDate}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-mono font-semibold">
                {formatCurrency(confirmDetails.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Destination</span>
              <span className="font-medium">{confirmDetails.destination}</span>
            </div>
            <div className="pt-2 space-y-1">
              <div className="text-muted-foreground text-xs">
                Balances (holding)
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pre</span>
                <span className="font-mono">{formatCurrency(holdingBalance)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Post</span>
                <span className="font-mono">
                  {formatCurrency(postBalance)}
                </span>
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={posting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={postTransfer} disabled={posting}>
              {posting ? "Posting..." : "Post"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

