"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/fund-replenishment-utils";

export function RevolvingFundBalanceSummary(props: {
  startingCapital: number;
  initialBalance: number;
  totalReplenished: number;
  maxReplenishable: number;
  postBalance?: number | null;
}) {
  const post =
    typeof props.postBalance === "number" ? props.postBalance : undefined;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Fund balances</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Initial fund (fixed)</span>
          <span className="font-mono font-semibold">
            {formatCurrency(props.startingCapital)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Available for disbursement</span>
          <span className="font-mono font-semibold">
            {formatCurrency(post ?? props.initialBalance)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Max addable now</span>
          <span className="font-mono font-semibold">
            {formatCurrency(props.maxReplenishable)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-muted-foreground">Total replenishments recorded</span>
          <span className="font-mono font-semibold">
            {formatCurrency(props.totalReplenished)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
