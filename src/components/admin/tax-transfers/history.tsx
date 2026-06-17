"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, TaxTransferSimulation } from "@/lib/tax-transfer-utils";

export function TaxTransferHistory(props: {
  transfers: TaxTransferSimulation[];
  canReverse?: boolean;
  onReverse: (transferSimulationId: string, reason: string) => Promise<void>;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.transfers;
    return props.transfers.filter((t) => {
      return (
        t.transferReference.toLowerCase().includes(q) ||
        t.destinationAccountName.toLowerCase().includes(q) ||
        (t.recordedByUser?.fullName || "").toLowerCase().includes(q)
      );
    });
  }, [props.transfers, query]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Transfer history</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by reference, destination, recorded by..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    No transfers found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap">
                      {t.transferDate
                        ? format(new Date(t.transferDate), "yyyy-MM-dd")
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(t.transferAmount)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {t.transferReference}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      Tax Payable
                    </TableCell>
                    <TableCell>{t.destinationAccountName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t.recordedByUser?.fullName || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.status === "REVERSED" ? "destructive" : "default"
                        }
                      >
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {props.canReverse && t.status !== "REVERSED" ? (
                        <ReverseDialog
                          disabled={props.busy}
                          onConfirm={(reason) => props.onReverse(t.id, reason)}
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
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

function ReverseDialog(props: {
  disabled?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length >= 10;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={props.disabled}>
          Reverse
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reverse this simulation?</AlertDialogTitle>
          <AlertDialogDescription>
            This will post a reversal journal entry and restore the collected tax
            balance.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label>Reversal reason</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="At least 10 characters"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              if (!canConfirm) return;
              await props.onConfirm(reason.trim());
              setReason("");
            }}
            disabled={!canConfirm || props.disabled}
          >
            Reverse
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

