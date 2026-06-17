"use client";

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
import { formatCurrency } from "@/lib/fund-replenishment-utils";

function parseAmountLoose(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export type FundReplenishmentDraft = {
  providerId: string;
  amount: string;
  remarks: string;
  replenishmentDate: string;
};

export function RevolvingFundForm(props: {
  providers: Array<{ id: string; name: string }>;
  maxReplenishable: number;
  draft: FundReplenishmentDraft;
  disabled?: boolean;
  canCreate?: boolean;
  onChange: (next: FundReplenishmentDraft) => void;
  onSubmit: () => void;
}) {
  const parsedAmount = parseAmountLoose(props.draft.amount);
  const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const exceeds =
    isAmountValid && parsedAmount > props.maxReplenishable + 1e-9;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record collected repayment</CardTitle>
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
                {(props.providers ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Amount collected (ETB)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={props.draft.amount}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({ ...props.draft, amount: e.target.value })
              }
              placeholder="0.00"
            />
            {exceeds && (
              <p className="text-sm text-destructive">
                Amount exceeds maximum addable ({formatCurrency(props.maxReplenishable)}).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Date of addition</Label>
            <Input
              type="date"
              value={props.draft.replenishmentDate}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({
                  ...props.draft,
                  replenishmentDate: e.target.value,
                })
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Remarks / description</Label>
          <Textarea
            value={props.draft.remarks}
            disabled={props.disabled}
            onChange={(e) =>
              props.onChange({ ...props.draft, remarks: e.target.value })
            }
            placeholder="e.g. Principal collections transferred to revolving fund for week ending..."
            rows={3}
          />
        </div>

        <Button
          type="button"
          disabled={
            props.disabled ||
            !props.canCreate ||
            !props.draft.providerId ||
            !isAmountValid ||
            exceeds
          }
          onClick={props.onSubmit}
        >
          Add to available fund
        </Button>
      </CardContent>
    </Card>
  );
}
