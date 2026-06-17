"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  LoanDetails,
  LoanProvider,
  LoanProduct,
  TermsAndConditions,
  Tax,
} from "@/lib/types";
import { IconDisplay } from "@/components/icons";
import { ChevronRight, Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductCard } from "@/components/loan/product-card";
import { RepaymentDialog } from "@/components/loan/repayment-dialog";
import { checkLoanEligibility } from "@/actions/eligibility";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../ui/dialog";
import AccountSelector from "@/components/loan/account-selector";
import { ScrollArea } from "../ui/scroll-area";
import { Checkbox } from "../ui/checkbox";
import { Skeleton } from "../ui/skeleton";

const formatCurrency = (amount: number | null | undefined) => {
  if (amount === null || amount === undefined || isNaN(amount))
    return "0.00 ETB";
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + " ETB"
  );
};

interface DashboardClientProps {
  providers: LoanProvider[];
  initialLoanHistory: LoanDetails[];
  taxConfigs: Tax[];
  asOfDate: Date;
}

interface EligibilityState {
  limits: Record<string, number>;
  reasons: Record<string, string>;
}

interface AgreementState {
  terms?: TermsAndConditions;
  hasAgreed?: boolean;
}

export function DashboardClient({
  providers,
  initialLoanHistory,
  taxConfigs,
  asOfDate,
}: DashboardClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const providerIdFromUrl = searchParams.get("providerId");
  const borrowerId = searchParams.get("borrowerId");
  const { toast } = useToast();

  const [loanHistory, setLoanHistory] = useState(initialLoanHistory);
  const [selectedProviderId, setSelectedProviderId] = useState(
    providerIdFromUrl ?? providers[0]?.id
  );
  const [isRepayDialogOpen, setIsRepayDialogOpen] = useState(false);
  const [repayingLoanInfo, setRepayingLoanInfo] = useState<{
    loan: LoanDetails;
    balanceDue: number;
  } | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityState>({
    limits: {},
    reasons: {},
  });

  const [agreementState, setAgreementState] = useState<AgreementState>({});
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [isAgreementDialogOpen, setIsAgreementDialogOpen] = useState(false);
  const [productToApply, setProductToApply] = useState<LoanProduct | null>(
    null
  );
  const [agreementChecked, setAgreementChecked] = useState(false);

  const [isMaxLimitVisible, setIsMaxLimitVisible] = useState(true);
  const [isAvailableVisible, setIsAvailableVisible] = useState(true);

  const checkAgreement = useCallback(
    async (providerId: string) => {
      if (!borrowerId) return;

      try {
        const response = await fetch(
          `/api/borrowers/agreements?providerId=${providerId}&borrowerId=${borrowerId}`
        );
        if (!response.ok) throw new Error("Failed to check agreement status");
        const data = await response.json();
        setAgreementState(data);
      } catch (error) {
        console.error(error);
        toast({
          title: "Error",
          description: "Could not verify agreement status.",
          variant: "destructive",
        });
      }
    },
    [borrowerId, toast]
  );

  const handleAcceptAgreement = async () => {
    if (!borrowerId || !agreementState.terms) return;
    try {
      const response = await fetch("/api/borrowers/agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId, termsId: agreementState.terms.id }),
      });
      if (!response.ok) throw new Error("Failed to accept agreement.");

      setAgreementState((prev) => ({ ...prev, hasAgreed: true }));
      setIsAgreementDialogOpen(false);

      // Now proceed with the original action
      if (productToApply) {
        handleApply(productToApply);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Could not save agreement.",
        variant: "destructive",
      });
    }
  };

  const recalculateEligibility = useCallback(
    async (providerId: string) => {
      if (!borrowerId) return;

      setIsRecalculating(true);
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        setIsRecalculating(false);
        return;
      }

      try {
        const newLimits: Record<string, number> = {};
        const newReasons: Record<string, string> = {};

        for (const product of provider.products) {
          const { isEligible, reason, maxLoanAmount } =
            await checkLoanEligibility(borrowerId, providerId, product.id);
          newLimits[product.id] = isEligible ? maxLoanAmount : 0;
          newReasons[product.id] = reason;
        }

        setEligibility({ limits: newLimits, reasons: newReasons });
      } catch (error) {
        console.error("Error recalculating eligibility:", error);
        const defaultReason =
          "Could not calculate loan eligibility for this provider.";
        const newReasons = provider.products.reduce(
          (acc, p) => ({ ...acc, [p.id]: defaultReason }),
          {}
        );
        setEligibility({ limits: {}, reasons: newReasons });
        toast({
          title: "Calculation Error",
          description: defaultReason,
          variant: "destructive",
        });
      } finally {
        setIsRecalculating(false);
      }
    },
    [borrowerId, providers, toast]
  );

  useEffect(() => {
    setLoanHistory(initialLoanHistory);
  }, [initialLoanHistory]);

  const refreshLoanHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/loan-history", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setLoanHistory(data);
      }
    } catch {
      // ignore network errors; UI will still work with initial data
    }
  }, []);

  useEffect(() => {
    // When the super-app provides a borrowerId (phone), check for an active associated account.
    // If none exists, open a blocking modal to force the user to select one.
    const checkActive = async () => {
      if (!borrowerId) return;
      try {
        const res = await fetch(
          `/api/phone-accounts?phoneNumber=${encodeURIComponent(borrowerId)}`
        );
        if (!res.ok) {
          setShowAccountModal(true);
          return;
        }
        const items = await res.json();
        const active = items && items.find((i: any) => i.isActive);
        if (active) {
          setSelectedAccount(active);
          // Ensure customer info is provisioned for this active account
          try {
            const providerIdToUse = providerIdFromUrl || providers[0]?.id;
            fetch("/api/phone-accounts/fetch-customer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                phoneNumber: borrowerId,
                accountNumber: active.accountNumber,
                providerId: providerIdToUse,
              }),
            })
              .then(() => {
                /* fire-and-forget */
              })
              .catch(() => {
                /* ignore */
              });
          } catch (e) {
            // ignore
          }
        } else {
          setShowAccountModal(true);
        }
      } catch (err) {
        setShowAccountModal(true);
      }
    };

    checkActive();
  }, [borrowerId, providerIdFromUrl, providers]);

  useEffect(() => {
    if (providers.length > 0 && borrowerId) {
      const providerIdToUse = providerIdFromUrl || providers[0]?.id;
      if (providerIdToUse) {
        setSelectedProviderId(providerIdToUse);
        if (Object.keys(eligibility.limits).length === 0) {
          // Only run on initial load
          recalculateEligibility(providerIdToUse);
        }
        checkAgreement(providerIdToUse);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, borrowerId, providerIdFromUrl]);

  const { overallMaxLimit, totalBorrowed, availableToBorrow } = useMemo(() => {
    const unpaidLoans = loanHistory.filter(
      (loan) => loan.repaymentStatus === "Unpaid"
    );
    const outstandingPrincipal = unpaidLoans.reduce(
      (acc, loan) => acc + (loan.loanAmount - (loan.repaidAmount || 0)),
      0
    );

    const maxLimitFromTiers = Object.values(eligibility.limits).reduce(
      (max, limit) => Math.max(max, limit),
      0
    );

    // Correct logic as per user's request
    const availableToBorrow = maxLimitFromTiers - outstandingPrincipal;

    return {
      overallMaxLimit: maxLimitFromTiers,
      totalBorrowed: outstandingPrincipal,
      availableToBorrow: Math.max(0, availableToBorrow),
    };
  }, [eligibility.limits, loanHistory]);

  const activeLoansByProduct = useMemo(() => {
    const unpaidLoans = loanHistory.filter(
      (loan) => loan.repaymentStatus === "Unpaid"
    );
    return unpaidLoans.reduce((acc, loan) => {
      // Use the active installment due date when present, otherwise fall back to loan.dueDate
      const activeInst = Array.isArray((loan as any).installments)
        ? (loan as any).installments.find((i: any) => i.isActive)
        : undefined;
      const effectiveDue = activeInst
        ? new Date(activeInst.dueDate)
        : new Date(loan.dueDate);
      const existing = acc[loan.product.id];
      const existingEffectiveDue = existing
        ? Array.isArray(existing.installments)
          ? existing.installments.find((i: any) => i.isActive)?.dueDate
            ? new Date(
                existing.installments.find((i: any) => i.isActive)?.dueDate
              )
            : new Date(existing.dueDate)
          : new Date(existing.dueDate)
        : null;
      if (
        !acc[loan.product.id] ||
        effectiveDue > (existingEffectiveDue || new Date(0))
      ) {
        acc[loan.product.id] = loan;
      }
      return acc;
    }, {} as Record<string, LoanDetails>);
  }, [loanHistory]);

  const selectedProvider = useMemo(() => {
    return (
      providers.find((p) => p.id === selectedProviderId) || providers[0] || null
    );
  }, [selectedProviderId, providers]);

  const handleApply = async (product: LoanProduct) => {
    if (agreementState.terms && !agreementState.hasAgreed) {
      setProductToApply(product);
      setIsAgreementDialogOpen(true);
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("providerId", selectedProviderId);
    params.set("product", product.id);

    // Fetch fresh eligibility for this borrower + provider to ensure UI uses up-to-date limit
    let productLimit = eligibility.limits[product.id] ?? 0;
    try {
      if (borrowerId && selectedProviderId) {
        const res = await fetch(
          `/api/ussd/borrowers/${encodeURIComponent(
            borrowerId
          )}/eligibility?providerId=${encodeURIComponent(selectedProviderId)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.limits)) {
            const found = data.limits.find(
              (l: any) => l.productId === product.id
            );
            if (found && typeof found.limit === "number") {
              productLimit = found.limit;
            }
          }
        }
      }
    } catch (e) {
      // ignore network errors and fall back to existing limit
      console.error("Failed to fetch fresh eligibility:", e);
    }

    params.set("min", String(product.minLoan ?? 0));
    params.set("max", String(productLimit));
    router.push(`/apply?${params.toString()}`);
  };

  const handleProviderSelect = (providerId: string) => {
    setSelectedProviderId(providerId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("providerId", providerId);
    router.push(`/loan?${params.toString()}`, { scroll: false });
    recalculateEligibility(providerId);
    checkAgreement(providerId);
  };

  const handleRepay = (loan: LoanDetails, balanceDue: number) => {
    setRepayingLoanInfo({ loan, balanceDue });
    setIsRepayDialogOpen(true);
  };

  const handleConfirmRepayment = async (amount: number) => {
    if (!repayingLoanInfo) return;
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loanId: repayingLoanInfo.loan.id, amount }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to process payment.");
      }

      const updatedLoanData = await response.json();

      const finalLoanObject: LoanDetails = {
        ...updatedLoanData,
        providerName: repayingLoanInfo.loan.providerName,
        productName: repayingLoanInfo.loan.productName,
        product: repayingLoanInfo.loan.product,
        provider: repayingLoanInfo.loan.provider,
        disbursedDate: new Date(updatedLoanData.disbursedDate),
        dueDate: new Date(updatedLoanData.dueDate),
        payments: updatedLoanData.payments,
      };

      setLoanHistory((prevHistory) =>
        prevHistory.map((l) =>
          l.id === updatedLoanData.id ? finalLoanObject : l
        )
      );

      // Re-check eligibility after repayment
      if (selectedProviderId) {
        recalculateEligibility(selectedProviderId);
      }

      toast({
        title: "Payment Successful",
        description: `${formatCurrency(
          amount
        )} has been paid towards your loan.`,
      });

      try {
        if (typeof window !== "undefined") {
          const event = new CustomEvent("payment:completed", {
            detail: { loanId: updatedLoanData.id },
          });
          window.dispatchEvent(event);
          try {
            const bc = new BroadcastChannel("payments");
            bc.postMessage({ loanId: updatedLoanData.id });
            bc.close();
          } catch (e) {
            // BroadcastChannel may not be available in some environments, ignore
          }
        }
      } catch (e) {
        // ignore
      }
    } catch (error: any) {
      toast({
        title: "Payment Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRepayDialogOpen(false);
      setRepayingLoanInfo(null);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onCustom = () => {
      // Prefer client refresh so UI updates even if navigation cache sticks
      refreshLoanHistory();
      router.refresh();
    };

    window.addEventListener("payment:completed", onCustom as EventListener);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("payments");
      bc.addEventListener("message", onCustom as EventListener);
    } catch (e) {
      // ignore if BroadcastChannel not supported
    }

    return () => {
      window.removeEventListener(
        "payment:completed",
        onCustom as EventListener
      );
      try {
        bc?.close();
      } catch (e) {
        // ignore
      }
    };
  }, [router, refreshLoanHistory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // When user returns to the miniapp (after paying elsewhere), refresh balances
    const onFocus = () => refreshLoanHistory();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshLoanHistory();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshLoanHistory]);

  const renderAmount = (amount: number, isVisible: boolean) => {
    if (!isVisible) {
      return "******";
    }
    return formatCurrency(amount);
  };

  return (
    <>
      <div className="flex flex-col min-h-screen bg-background">
        <main className="flex-1">
          <div className="container py-2 md:py-4">
            <div className="flex flex-col">
              <div className="py-2">
                <div className="flex justify-center space-x-4 overflow-x-auto">
                  {providers.map((provider) => (
                    <div
                      key={provider.id}
                      onClick={() => handleProviderSelect(provider.id)}
                      className="flex flex-col items-center space-y-2 cursor-pointer flex-shrink-0"
                    >
                      <div
                        className={cn(
                          "h-20 w-20 rounded-full flex items-center justify-center border-2 transition-all",
                          selectedProviderId === provider.id
                            ? `border-current`
                            : "border-transparent"
                        )}
                        style={{
                          color:
                            selectedProviderId === provider.id
                              ? provider.colorHex
                              : "transparent",
                        }}
                      >
                        <div
                          className={cn(
                            "h-16 w-16 rounded-full bg-card flex items-center justify-center transition-all shadow-md hover:shadow-lg",
                            selectedProviderId === provider.id
                              ? "shadow-lg"
                              : ""
                          )}
                        >
                          {isRecalculating &&
                          selectedProviderId === provider.id ? (
                            <Loader2 className="h-8 w-8 animate-spin" />
                          ) : (
                            <IconDisplay
                              iconName={provider.icon}
                              className="h-8 w-8 text-muted-foreground"
                            />
                          )}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-medium",
                          selectedProviderId === provider.id
                            ? ""
                            : "text-muted-foreground"
                        )}
                        style={{
                          color:
                            selectedProviderId === provider.id
                              ? provider.colorHex
                              : "",
                        }}
                      >
                        {provider.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {selectedAccount && (
                <Card
                  className="my-4 cursor-pointer relative overflow-hidden"
                  onClick={() => setShowAccountModal(true)}
                  style={{
                    backgroundColor: selectedProvider?.colorHex,
                    color: "#ffffff",
                  }}
                >
                  <div className="absolute inset-0 z-0 opacity-10">
                    <svg
                      width="100%"
                      height="100%"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <defs>
                        <pattern
                          id="hex-pattern"
                          patternUnits="userSpaceOnUse"
                          width="40"
                          height="69.28"
                          patternTransform="scale(1) rotate(0)"
                        >
                          <polygon
                            points="20,0 40,17.32 40,51.96 20,69.28 0,51.96 0,17.32"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                          />
                        </pattern>
                      </defs>
                      <rect
                        width="100%"
                        height="100%"
                        fill="url(#hex-pattern)"
                      />
                    </svg>
                  </div>
                  <CardContent className="p-4 relative z-10">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs opacity-80">
                          {selectedAccount.customerName}
                        </p>
                        <p className="font-semibold">
                          {selectedAccount.accountNumber}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge className="bg-white/20 text-white border-none">
                          Active
                        </Badge>
                      </div>
                    </div>
                    <Separator className="my-3 bg-white/20" />
                    <div className="flex items-center justify-between w-full">
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <p className="text-sm opacity-80 mb-1">Max Limit</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsMaxLimitVisible((v) => !v);
                            }}
                            className="focus:outline-none"
                          >
                            {isMaxLimitVisible ? (
                              <Eye className="h-4 w-4 opacity-80" />
                            ) : (
                              <EyeOff className="h-4 w-4 opacity-80" />
                            )}
                          </button>
                        </div>
                        {isRecalculating ? (
                          <Skeleton className="h-7 w-32 bg-white/20" />
                        ) : (
                          <p className="text-xl font-semibold tracking-tight">
                            {renderAmount(overallMaxLimit, isMaxLimitVisible)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <p className="text-sm opacity-80 mb-1">Available</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsAvailableVisible((v) => !v);
                            }}
                            className="focus:outline-none"
                          >
                            {isAvailableVisible ? (
                              <Eye className="h-4 w-4 opacity-80" />
                            ) : (
                              <EyeOff className="h-4 w-4 opacity-80" />
                            )}
                          </button>
                        </div>
                        {isRecalculating ? (
                          <Skeleton className="h-7 w-32 bg-white/20" />
                        ) : (
                          <p className="text-xl font-semibold tracking-tight">
                            {renderAmount(
                              availableToBorrow,
                              isAvailableVisible
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-end mt-4">
                <Link
                  href={`/history?${searchParams.toString()}`}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: selectedProvider
                      ? `${selectedProvider.colorHex}20`
                      : "#fdb91320",
                    color: selectedProvider?.colorHex || "#fdb913",
                  }}
                >
                  <span>Loan History</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="grid gap-8 grid-cols-1 mt-4">
                <div className="md:col-span-2">
                  {selectedProvider && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Available Loan Products</CardTitle>
                        <CardDescription>
                          Select a product from {selectedProvider.name} to
                          apply.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {selectedProvider.products
                          .filter((p) => p.status === "Active")
                          .map((product) => {
                            const productLimit =
                              eligibility.limits[product.id] ?? 0;
                            const isEligible = productLimit > 0;
                            const reason =
                              eligibility.reasons[product.id] || "";

                            return (
                              <ProductCard
                                key={product.id}
                                product={{
                                  ...product,
                                  availableLimit: productLimit,
                                }}
                                taxConfigs={taxConfigs}
                                providerColor={selectedProvider.colorHex}
                                activeLoan={activeLoansByProduct[product.id]}
                                onApply={() => handleApply(product)}
                                onRepay={handleRepay}
                                IconDisplayComponent={IconDisplay}
                                isEligible={isEligible}
                                eligibilityReason={reason}
                                availableToBorrow={availableToBorrow}
                                asOfDate={asOfDate}
                              />
                            );
                          })}
                        {selectedProvider.products.filter(
                          (p) => p.status === "Active"
                        ).length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-8">
                            No active loan products available from this
                            provider.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
      {repayingLoanInfo && (
        <RepaymentDialog
          isOpen={isRepayDialogOpen}
          onClose={() => setIsRepayDialogOpen(false)}
          onConfirm={handleConfirmRepayment}
          loan={repayingLoanInfo.loan}
          totalBalanceDue={repayingLoanInfo.balanceDue}
          providerColor={selectedProvider?.colorHex}
          taxConfigs={taxConfigs}
          asOfDate={asOfDate}
        />
      )}
      <Dialog
        open={isAgreementDialogOpen}
        onOpenChange={setIsAgreementDialogOpen}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Terms &amp; Conditions</DialogTitle>
            <DialogDescription>
              Please read and accept the terms and conditions of{" "}
              {selectedProvider?.name} to proceed.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96 border rounded-md p-4 whitespace-pre-wrap">
            {agreementState.terms?.content}
          </ScrollArea>
          <div className="flex items-center space-x-2 mt-4">
            <Checkbox
              id="terms"
              checked={agreementChecked}
              onCheckedChange={(checked) => setAgreementChecked(!!checked)}
            />
            <label
              htmlFor="terms"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I have read and agree to the terms and conditions.
            </label>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleAcceptAgreement}
              style={{ backgroundColor: selectedProvider?.colorHex }}
              className="text-white"
              disabled={!agreementChecked}
            >
              I Agree
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showAccountModal}
        onOpenChange={(open) => {
          if (!open && !selectedAccount) return;
          setShowAccountModal(open);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select disbursement account</DialogTitle>
            <DialogDescription>
              Please choose the account to receive disbursements for this loan.
              This selection is required.
            </DialogDescription>
          </DialogHeader>
          {borrowerId && (
            <div className="mt-4">
              <AccountSelector
                phoneNumber={borrowerId}
                onSelected={(acc) => {
                  (async () => {
                    setSelectedAccount(acc);
                    try {
                      const providerIdToUse =
                        selectedProviderId ||
                        providerIdFromUrl ||
                        providers[0]?.id;
                      const res = await fetch(
                        "/api/phone-accounts/fetch-customer",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            phoneNumber: borrowerId,
                            accountNumber: acc.accountNumber,
                            providerId: providerIdToUse,
                          }),
                        }
                      );
                      const data = await res.json();
                      if (!res.ok) {
                        toast({
                          title: "Provisioning failed",
                          description: data?.error || JSON.stringify(data),
                          variant: "destructive",
                        });
                      } else {
                        toast({
                          title: "Customer data saved",
                          description:
                            "Customer details were saved for scoring.",
                        });
                      }
                    } catch (err: any) {
                      toast({
                        title: "Provisioning error",
                        description: String(err?.message ?? err),
                        variant: "destructive",
                      });
                    }
                    setShowAccountModal(false);
                  })();
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
