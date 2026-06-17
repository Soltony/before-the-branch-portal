"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/tax-transfer-utils";

export function TaxTransferBalanceSummary(props: {
  holdingBalance: number;
  postBalance?: number | null;
}) {
  const post =
    typeof props.postBalance === "number" ? props.postBalance : undefined;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          Collected Inclusive Tax Balance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-sm">Pre-transfer</div>
          <div className="font-mono font-semibold">
            {formatCurrency(props.holdingBalance)}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-sm">Post-transfer</div>
          <div className="font-mono font-semibold">
            {formatCurrency(post ?? props.holdingBalance)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

