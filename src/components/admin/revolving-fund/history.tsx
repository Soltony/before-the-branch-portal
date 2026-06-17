"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  formatCurrency,
  FundReplenishmentRecord,
} from "@/lib/fund-replenishment-utils";

export function RevolvingFundHistory(props: {
  records: FundReplenishmentRecord[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.records;
    return props.records.filter((r) => {
      return (
        (r.remarks || "").toLowerCase().includes(q) ||
        (r.recordedByUser?.fullName || "").toLowerCase().includes(q)
      );
    });
  }, [props.records, query]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Replenishment history</CardTitle>
        <Input
          placeholder="Search by remarks or recorded by..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </CardHeader>
      <CardContent className="p-0">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance before</TableHead>
                <TableHead className="text-right">Balance after</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead>Recorded at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No replenishment records yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {format(new Date(r.replenishmentDate), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(r.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(r.balanceBefore)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(r.balanceAfter)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={r.remarks || ""}>
                      {r.remarks || "—"}
                    </TableCell>
                    <TableCell>{r.recordedByUser?.fullName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(r.createdAt), "dd MMM yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
