"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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
  formatCurrency,
  FundReplenishmentRecord,
  FundReplenishmentSummary,
} from "@/lib/fund-replenishment-utils";
import { RevolvingFundForm, type FundReplenishmentDraft } from "./form";
import { RevolvingFundBalanceSummary } from "./balance-summary";
import { RevolvingFundHistory } from "./history";

type ProviderOption = { id: string; name: string };

function parseAmountLoose(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return 0;
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
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  if (!y || !m || !d) return new Date().toISOString();
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

export default function RevolvingFundPage() {
  useRequirePermission("revolving-fund");
  const { toast } = useToast();
  const { canModule } = usePermissions();
  const canCreate = canModule("revolving-fund", "create");

  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [summary, setSummary] = useState<FundReplenishmentSummary | null>(null);
  const [records, setRecords] = useState<FundReplenishmentRecord[]>([]);

  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [draft, setDraft] = useState<FundReplenishmentDraft>({
    providerId: "",
    amount: "",
    remarks: "",
    replenishmentDate: todayYmd(),
  });

  const parsedAmount = parseAmountLoose(draft.amount);
  const postBalance = useMemo(() => {
    if (!summary) return null;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return summary.initialBalance;
    }
    return summary.initialBalance + parsedAmount;
  }, [summary, parsedAmount]);

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
        `/api/fund-replenishments?summary=true&providerId=${encodeURIComponent(providerId)}`,
      );
      if (!res.ok) throw new Error("Failed to load fund summary");
      const data = (await res.json()) as FundReplenishmentSummary;
      setSummary(data);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not load fund balances.",
        variant: "destructive",
      });
    } finally {
      setLoadingSummary(false);
    }
  }

  async function fetchRecords(providerId: string) {
    if (!providerId) return;
    setLoadingRecords(true);
    try {
      const res = await fetch(
        `/api/fund-replenishments?providerId=${encodeURIComponent(providerId)}&page=1&limit=100`,
      );
      if (!res.ok) throw new Error("Failed to load replenishment history");
      const json = await res.json();
      setRecords((json?.data ?? []) as FundReplenishmentRecord[]);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not load history.",
        variant: "destructive",
      });
    } finally {
      setLoadingRecords(false);
    }
  }

  async function refreshAll(providerId: string) {
    await Promise.all([fetchSummary(providerId), fetchRecords(providerId)]);
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

  async function postReplenishment() {
    if (!draft.providerId) return;
    setPosting(true);
    try {
      const amount = parseAmountLoose(draft.amount);
      const payload = {
        providerId: draft.providerId,
        amount,
        remarks: draft.remarks?.trim() || undefined,
        replenishmentDate: ymdToIso(draft.replenishmentDate),
      };

      const res = await fetch("/api/fund-replenishments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Failed to record replenishment");
      }

      toast({
        title: "Fund replenished",
        description: `${formatCurrency(amount)} added to available fund balance.`,
      });

      setConfirmOpen(false);
      setDraft((prev) => ({
        ...prev,
        amount: "",
        remarks: "",
      }));
      await refreshAll(draft.providerId);
    } catch (e: any) {
      toast({
        title: "Failed",
        description: e?.message ?? "Could not record replenishment.",
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  }

  const confirmDetails = useMemo(() => {
    return {
      provider: providers.find((p) => p.id === draft.providerId)?.name ?? "",
      amount: parseAmountLoose(draft.amount),
      date: draft.replenishmentDate,
      remarks: draft.remarks.trim(),
    };
  }, [draft, providers]);

  const maxReplenishable = summary?.maxReplenishable ?? 0;

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Revolving Fund</h2>
          <p className="text-muted-foreground">
            Replenish the available disbursement balance from collected loan
            repayments. Initial fund amount remains unchanged.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => draft.providerId && refreshAll(draft.providerId)}
          disabled={!draft.providerId || loadingSummary || loadingRecords}
        >
          {(loadingSummary || loadingRecords) ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {loadingProviders ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading providers...
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">
            {summary ? (
              <RevolvingFundBalanceSummary
                startingCapital={summary.startingCapital}
                initialBalance={summary.initialBalance}
                totalReplenished={summary.totalReplenished}
                maxReplenishable={summary.maxReplenishable}
                postBalance={postBalance}
              />
            ) : (
              <RevolvingFundBalanceSummary
                startingCapital={0}
                initialBalance={0}
                totalReplenished={0}
                maxReplenishable={0}
              />
            )}
          </div>
          <div className="lg:col-span-2">
            <RevolvingFundForm
              providers={providers}
              maxReplenishable={maxReplenishable}
              draft={draft}
              disabled={posting || loadingSummary}
              canCreate={canCreate}
              onChange={setDraft}
              onSubmit={() => setConfirmOpen(true)}
            />
          </div>
        </div>
      )}

      <RevolvingFundHistory records={records} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm fund replenishment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Add <strong>{formatCurrency(confirmDetails.amount)}</strong> to
                  the available fund for <strong>{confirmDetails.provider}</strong>?
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Date: {confirmDetails.date}</li>
                  {confirmDetails.remarks ? (
                    <li>Remarks: {confirmDetails.remarks}</li>
                  ) : null}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={posting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={posting}
              onClick={(e) => {
                e.preventDefault();
                postReplenishment();
              }}
            >
              {posting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
