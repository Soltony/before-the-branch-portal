"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LoanProvider, LoanDetails, Tax } from "@/lib/types";
import { Loader2 } from "lucide-react";
import { LoanOfferAndCalculator } from "@/components/loan/loan-offer-and-calculator";
import { LoanDetailsView } from "@/components/loan/loan-details-view";
import { useToast } from "@/hooks/use-toast";
import AccountSelector from "@/components/loan/account-selector";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Step = "calculator" | "details";

export function ApplyClient({
  provider,
  taxConfigs,
}: {
  provider: LoanProvider;
  taxConfigs: Tax[] | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const productId = searchParams.get("product");
  const borrowerId = searchParams.get("borrowerId");

  const selectedProduct = useMemo(() => {
    if (!provider || !productId) return null;
    return provider.products.find((p) => p.id === productId) || null;
  }, [provider, productId]);

  const initialStep: Step = (searchParams.get("step") as Step) || "calculator";

  const [step, setStep] = useState<Step>(initialStep);
  const [loanDetails, setLoanDetails] = useState<LoanDetails | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // When the super-app provides a borrowerId (phone), check for an active associated account.
    // If none exists, open a blocking modal to force the user to select one.
    const checkActive = async () => {
      if (!borrowerId) return;
      try {
        const res = await fetch(
          `/api/phone-accounts?phoneNumber=${encodeURIComponent(borrowerId)}`,
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
            fetch("/api/phone-accounts/fetch-customer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                phoneNumber: borrowerId,
                accountNumber: active.accountNumber,
                providerId: provider?.id,
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
  }, [borrowerId]);

  const eligibilityResult = useMemo(() => {
    const min = searchParams.get("min");
    const max = searchParams.get("max");

    return {
      isEligible: true,
      suggestedLoanAmountMin: min
        ? parseFloat(min)
        : (selectedProduct?.minLoan ?? 0),
      suggestedLoanAmountMax: max
        ? parseFloat(max)
        : (selectedProduct?.maxLoan ?? 0),
      reason: "You are eligible for a loan.",
    };
  }, [searchParams, selectedProduct]);

  const handleLoanAccept = async (
    details: Omit<
      LoanDetails,
      "id" | "providerName" | "productName" | "payments"
    >,
  ) => {
    if (!selectedProduct || !borrowerId) {
      toast({
        title: "Error",
        description: "Missing required information.",
        variant: "destructive",
      });
      return;
    }

    // Prevent double-submission
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Personal Loan Flow: Disburse the loan directly
      const finalDetails = {
        borrowerId,
        productId: selectedProduct.id,
        loanAmount: details.loanAmount,
        disbursedDate: details.disbursedDate,
        dueDate: details.dueDate,
        creditAccount: selectedAccount?.accountNumber || undefined,
      };

      const response = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalDetails),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save the loan.");
      }

      const savedLoan = await response.json();

      const displayLoan: LoanDetails = {
        ...savedLoan,
        providerName: provider.name,
        productName: selectedProduct.name,
        disbursedDate: new Date(savedLoan.disbursedDate),
        dueDate: new Date(savedLoan.dueDate),
        payments: [],
      };
      setLoanDetails(displayLoan);
      setStep("details");
      // Inform user and attempt to call external disbursement proxy if an account was selected
      toast({ title: "Success!", description: "Your loan has been saved." });

      try {
        if (selectedAccount && selectedAccount.accountNumber) {
          // Disburse the net amount (after inclusive tax deduction) if available, otherwise full amount
          const disbursementAmount =
            savedLoan.netDisbursedAmount != null && savedLoan.taxDeducted > 0
              ? savedLoan.netDisbursedAmount
              : savedLoan.loanAmount;
          const disRes = await fetch("/api/external/disbursement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              creditAccount: selectedAccount.accountNumber,
              providerId: provider.id,
              amount: disbursementAmount,
              loanId: savedLoan.id,
            }),
          });

          if (!disRes.ok) {
            const err = await disRes.json().catch(() => null);
            toast({
              title: "Disbursement failed",
              description:
                err?.error ||
                JSON.stringify(err) ||
                "Upstream disbursement failed",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Disbursement sent",
              description: "External disbursement request was sent.",
            });
          }
        } else {
          toast({
            title: "No account selected",
            description:
              "No disbursement account was selected; external transfer was not attempted.",
            variant: "warning",
          });
        }
      } catch (err: any) {
        toast({
          title: "Disbursement error",
          description: String(err?.message ?? err),
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("product");
    params.delete("step");
    router.push(`/loan?${params.toString()}`);
  };

  const handleReset = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("product");
    params.delete("step");
    router.push(`/loan?${params.toString()}`);
  };

  const renderStep = () => {
    switch (step) {
      case "calculator":
        if (selectedProduct) {
          return (
            <LoanOfferAndCalculator
              product={selectedProduct}
              taxConfigs={taxConfigs || []}
              isLoading={false}
              eligibilityResult={eligibilityResult}
              onAccept={handleLoanAccept}
              providerColor={provider.colorHex}
              isSubmitting={isSubmitting}
            />
          );
        }
        if (productId && !selectedProduct) {
          return (
            <div className="text-center">
              Product not found. Please{" "}
              <button
                onClick={() => router.push("/loan")}
                className="underline"
                style={{ color: "hsl(var(--primary))" }}
              >
                start over
              </button>
              .
            </div>
          );
        }
        return (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        );

      case "details":
        if (loanDetails && selectedProduct) {
          return (
            <LoanDetailsView
              details={loanDetails}
              product={selectedProduct}
              onReset={handleReset}
              providerColor={provider.colorHex}
              selectedAccount={selectedAccount}
            />
          );
        }
        return (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        );
      default:
        return <div className="text-center">Invalid step.</div>;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <main className="flex-1">
        <div className="container py-8 md:py-12">
          {/* If borrowerId is provided by the super-app, automatically show account selector */}

          {renderStep()}

          {/* Blocking modal: forces account selection when there is no active account */}
          <Dialog
            open={showAccountModal}
            onOpenChange={(open) => {
              // prevent closing unless an account is selected
              if (!open && !selectedAccount) return;
              setShowAccountModal(open);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select disbursement account</DialogTitle>
                <DialogDescription>
                  Please choose the account to receive disbursements for this
                  loan. This selection is required.
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
                          const res = await fetch(
                            "/api/phone-accounts/fetch-customer",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                phoneNumber: borrowerId,
                                accountNumber: acc.accountNumber,
                                providerId: provider?.id,
                              }),
                            },
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
        </div>
      </main>
    </div>
  );
}
