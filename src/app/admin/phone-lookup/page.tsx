"use client";

import { useState } from "react";
import { useRequirePermission } from "@/hooks/use-require-permission";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type ActiveLoan = {
  id: string;
  loanAmount: number;
  repaidAmount: number | null;
  disbursedDate: string;
  dueDate: string;
  productName: string;
  providerName: string;
};

type LookupResult = {
  phone: string;
  borrowerExists: boolean;
  customerName: string | null;
  accountNumber: string | null;
  activeLoans: ActiveLoan[];
};

export default function PhoneLookupPage() {
  useRequirePermission("phone-lookup");

  const { toast } = useToast();
  const [searchPhone, setSearchPhone] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    const phone = searchPhone.trim();
    if (!phone) {
      toast({ title: "Error", description: "Please enter a phone number", variant: "destructive" });
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    try {
      const res = await fetch(`/api/phone-change?phone=${encodeURIComponent(phone)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Lookup failed");
      }
      const data: LookupResult = await res.json();
      setLookupResult(data);
    } catch (e: any) {
      toast({ title: "Error", description: String(e?.message ?? e), variant: "destructive" });
      setLookupResult(null);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Phone Number Lookup</h2>
        <p className="text-muted-foreground">
          Look up a phone number to check if there are any active loans associated with it.
        </p>
      </div>

      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle>Phone Number Lookup</CardTitle>
          <CardDescription>
            Enter a phone number to check if there are any active loans associated with it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-sm">
              <Label htmlFor="phone-search">Phone Number</Label>
              <div className="relative mt-1">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="phone-search"
                  type="text"
                  placeholder="Enter phone number (e.g., 0912345678)"
                  value={searchPhone}
                  onChange={(e) => setSearchPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-9"
                />
              </div>
            </div>
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Section */}
      {hasSearched && lookupResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Results for {lookupResult.phone}</span>
              {lookupResult.activeLoans.length > 0 ? (
                <Badge className="bg-red-600 text-white">Has Active Loans</Badge>
              ) : lookupResult.borrowerExists ? (
                <Badge className="bg-green-600 text-white">No Active Loans</Badge>
              ) : (
                <Badge variant="secondary">No Borrower Found</Badge>
              )}
            </CardTitle>
            {lookupResult.customerName && (
              <CardDescription>
                Customer: {lookupResult.customerName}
                {lookupResult.accountNumber && ` • Account: ${lookupResult.accountNumber}`}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {lookupResult.activeLoans.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  This phone number has {lookupResult.activeLoans.length} active loan(s).
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Loan Amount</TableHead>
                      <TableHead>Repaid</TableHead>
                      <TableHead>Disbursed</TableHead>
                      <TableHead>Due Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lookupResult.activeLoans.map((loan) => (
                      <TableRow key={loan.id}>
                        <TableCell className="font-medium">{loan.productName}</TableCell>
                        <TableCell>{loan.providerName}</TableCell>
                        <TableCell>{loan.loanAmount.toLocaleString()}</TableCell>
                        <TableCell>{(loan.repaidAmount ?? 0).toLocaleString()}</TableCell>
                        <TableCell>
                          {format(new Date(loan.disbursedDate), "yyyy-MM-dd")}
                        </TableCell>
                        <TableCell>
                          {format(new Date(loan.dueDate), "yyyy-MM-dd")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : lookupResult.borrowerExists ? (
              <p className="text-sm text-muted-foreground">
                No active loans found for this phone number.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No borrower record found for this phone number.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {hasSearched && !lookupResult && !isSearching && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No results. Try a different phone number.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
