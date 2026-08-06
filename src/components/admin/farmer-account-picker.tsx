'use client';

import { useCallback, useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

export interface FarmerBankAccount {
  accountNumber: string;
  accountName: string | null;
  status: string | null;
}

interface FarmerAccountPickerProps {
  /** LershaFarmer.id or the external farmerId — the API accepts either. */
  farmerId: string;
  /** Currently selected account number, if the farmer already has one. */
  value: string | null;
  onChange: (accountNumber: string | null) => void;
  /** Reported so callers can disable their confirm button while loading/empty. */
  onAccountsLoaded?: (accounts: FarmerBankAccount[]) => void;
  label?: string;
  description?: string;
}

/**
 * Lists the bank accounts the core banking system holds against a farmer's phone
 * number and lets the approver pick the one to credit. Lersha does not send an
 * account at registration, so this is where the borrower's own account is chosen.
 */
export function FarmerAccountPicker({
  farmerId,
  value,
  onChange,
  onAccountsLoaded,
  label = 'Account to credit',
  description = "Accounts registered against this farmer's phone number. The selected account is credited for the agri-input loan and for insurance payments.",
}: FarmerAccountPickerProps) {
  const [accounts, setAccounts] = useState<FarmerBankAccount[]>([]);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/farmer-loans/${encodeURIComponent(farmerId)}/accounts`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load accounts.');

      const list: FarmerBankAccount[] = data.accounts ?? [];
      setAccounts(list);
      setPhoneNumber(data.phoneNumber ?? null);
      onAccountsLoaded?.(list);

      // Preselect what the farmer already has, else the only account on offer —
      // the approver still has to confirm, but there is nothing to choose from.
      const alreadySelected: string | null = data.selected?.accountNumber ?? null;
      if (alreadySelected && list.some((a) => a.accountNumber === alreadySelected)) {
        onChange(alreadySelected);
      } else if (list.length === 1) {
        onChange(list[0].accountNumber);
      } else {
        onChange(null);
      }
    } catch (err: any) {
      setError(err.message);
      setAccounts([]);
      onAccountsLoaded?.([]);
      onChange(null);
    } finally {
      setIsLoading(false);
    }
    // onChange/onAccountsLoaded are called, not depended on: callers pass inline
    // closures and including them would refetch the upstream on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmerId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={fetchAccounts}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {description}
        {phoneNumber ? ` (${phoneNumber})` : ''}
      </p>

      {isLoading ? (
        <div className="flex h-20 items-center justify-center rounded-md border">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No bank account is registered against this farmer&apos;s phone number.
            They need an account before a disbursement can be credited to them.
          </span>
        </div>
      ) : (
        <RadioGroup
          value={value ?? ''}
          onValueChange={(v) => onChange(v)}
          className="max-h-56 gap-0 overflow-y-auto rounded-md border"
        >
          {accounts.map((account) => (
            <label
              key={account.accountNumber}
              htmlFor={`acct-${account.accountNumber}`}
              className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/50"
            >
              <RadioGroupItem
                id={`acct-${account.accountNumber}`}
                value={account.accountNumber}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm">
                  {account.accountNumber}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {account.accountName ?? '—'}
                </span>
              </span>
              {account.status && (
                <Badge variant="outline" className="text-[10px]">
                  {account.status}
                </Badge>
              )}
            </label>
          ))}
        </RadioGroup>
      )}
    </div>
  );
}
