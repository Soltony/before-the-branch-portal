"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/tax-transfer-utils";

function parseAmountLoose(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export type TaxTransferDraft = {
  providerId: string;
  transferAmount: string; // keep as string for input
  destinationAccountName: string;
  transferReference: string;
  transferDate: string; // YYYY-MM-DD
  notes: string;
};

export function TaxTransferForm(props: {
  providers: Array<{ id: string; name: string }>;
  destinationAccounts: Array<{ name: string }>;
  holdingBalance: number;
  draft: TaxTransferDraft;
  disabled?: boolean;
  canCreate?: boolean;
  onChange: (next: TaxTransferDraft) => void;
  onSubmit: () => void;
}) {
  const providerOptions = props.providers ?? [];

  const destinationSuggestions = useMemo(() => {
    return Array.from(
      new Set(
        (props.destinationAccounts ?? [])
          .map((a) => String(a.name || ""))
          .filter(Boolean)
          .map((name) => name.replace(/^Tax Destination:\s*/i, ""))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [props.destinationAccounts]);

  const parsedAmount = parseAmountLoose(props.draft.transferAmount);
  const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const exceeds = isAmountValid && parsedAmount > props.holdingBalance + 1e-9;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Manual Tax Transfer (Simulation)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select
              value={props.draft.providerId}
              onValueChange={(v) =>
                props.onChange({ ...props.draft, providerId: v })
              }
              disabled={props.disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Transfer amount</Label>
            <Input
              type="text"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={props.draft.transferAmount}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({ ...props.draft, transferAmount: e.target.value })
              }
              placeholder={`Max ${formatCurrency(props.holdingBalance)}`}
            />
            {exceeds ? (
              <div className="text-sm text-destructive">
                Amount exceeds available collected tax balance.
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Destination (real) account</Label>
            <Select
              value="__custom__"
              onValueChange={(v) => {
                const label = v === "__custom__" ? "" : v;
                props.onChange({
                  ...props.draft,
                  destinationAccountName: label,
                });
              }}
              disabled={props.disabled || destinationSuggestions.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick from previous destinations (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom__">Custom</SelectItem>
                {destinationSuggestions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={props.draft.destinationAccountName}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({
                  ...props.draft,
                  destinationAccountName: e.target.value,
                })
              }
              placeholder="e.g. NIB Tax Account (Account #...)"
            />
          </div>

          <div className="space-y-2">
            <Label>Transfer reference</Label>
            <Input
              value={props.draft.transferReference}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({
                  ...props.draft,
                  transferReference: e.target.value,
                })
              }
              placeholder="Unique reference / FT number"
            />
          </div>

          <div className="space-y-2">
            <Label>Transfer date</Label>
            <Input
              type="date"
              value={props.draft.transferDate}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({ ...props.draft, transferDate: e.target.value })
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Remarks / notes (optional)</Label>
          <Textarea
            value={props.draft.notes}
            disabled={props.disabled}
            onChange={(e) =>
              props.onChange({ ...props.draft, notes: e.target.value })
            }
            placeholder="Any details to keep in the audit trail"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={props.onSubmit}
            disabled={
              props.disabled ||
              !props.canCreate ||
              !props.draft.providerId ||
              !isAmountValid ||
              exceeds ||
              !props.draft.destinationAccountName.trim() ||
              !props.draft.transferReference.trim() ||
              !props.draft.transferDate
            }
          >
            Review & Post
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

