"use client";

import { useEffect, useState } from "react";

type ExternalAccount = {
  AccountNumber: number | string;
  Name: string;
  Status?: string;
};

type PhoneAccount = {
  id: string;
  phoneNumber: string;
  accountNumber: string;
  customerName?: string | null;
  isActive: boolean;
};

type Props = {
  phoneNumber: string;
  onSelected?: (account: PhoneAccount) => void;
};

export default function AccountSelector({ phoneNumber, onSelected }: Props) {
  const [externalAccounts, setExternalAccounts] = useState<
    ExternalAccount[] | null
  >(null);
  const [associations, setAssociations] = useState<PhoneAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!phoneNumber) return;
    console.info(`[AccountSelector] phoneNumber set: ${phoneNumber}`);
    fetchAssociations();
    fetchExternalAccounts();
  }, [phoneNumber]);

  async function fetchExternalAccounts() {
    setError(null);
    setExternalAccounts(null);
    try {
      console.info(
        `[AccountSelector] fetching external accounts for ${phoneNumber}`
      );
      const res = await fetch("/api/loan-accounts", {
        method: "POST",
        body: JSON.stringify({ phoneNumber }),
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const txt = await res.text();
        console.warn(
          `[AccountSelector] external service returned ${res.status} ${txt}`
        );
        setError(`External service error: ${res.status} ${txt}`);
        return;
      }
      const data = await res.json();
      // upstream returns { details: [...] }
      const list = data?.details ?? [];
      console.info(
        `[AccountSelector] external accounts fetched: ${list.length}`
      );
      setExternalAccounts(list);
    } catch (err: any) {
      console.error("[AccountSelector] fetchExternalAccounts error", err);
      setError(String(err?.message ?? err));
    }
  }

  async function fetchAssociations() {
    try {
      console.info(
        `[AccountSelector] fetching associations for ${phoneNumber}`
      );
      const url = `/api/phone-accounts?phoneNumber=${encodeURIComponent(
        phoneNumber
      )}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const items = await res.json();
      console.info(
        `[AccountSelector] associations fetched: ${items?.length ?? 0}`
      );
      setAssociations(items);
      const active = items.find((i: PhoneAccount) => i.isActive);
      if (active) setSelected(active.accountNumber);
    } catch (err) {
      console.error("[AccountSelector] fetchAssociations error", err);
      // ignore
    }
  }

  async function handleSave(accountNumber: string, customerName?: string) {
    setLoading(true);
    setError(null);
    console.info(
      `[AccountSelector] saving association ${accountNumber} for ${phoneNumber}`
    );
    try {
      const res = await fetch("/api/phone-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber,
          accountNumber,
          customerName,
          isActive: true,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.warn(`[AccountSelector] save failed ${res.status} ${txt}`);
        setError(`Save failed: ${res.status} ${txt}`);
        return;
      }
      const saved = await res.json();
      console.info("[AccountSelector] association saved", saved);
      // refresh
      await fetchAssociations();
      setSelected(saved.accountNumber);
      onSelected?.(saved);
      // fetch account statement for the selected account (last 12 months)
      // COMMENTED OUT: Statement fetching disabled
      // (async () => {
      //   try {
      //     const end = new Date();
      //     const start = new Date();
      //     start.setFullYear(end.getFullYear() - 1);
      //     const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      //       const resp = await fetch('/api/phone-accounts/fetch-statement', {
      //       method: 'POST',
      //       headers: { 'Content-Type': 'application/json' },
      //       body: JSON.stringify({ phoneNumber, accountNumber, startDate: fmt(start), endDate: fmt(end) })
      //     });
      //     if (!resp.ok) {
      //       const txt = await resp.text().catch(() => null);
      //       console.warn('[AccountSelector] fetch-statement failed', resp.status, txt);
      //     } else {
      //       console.info('[AccountSelector] fetch-statement triggered', await resp.json().catch(() => null));
      //     }
      //   } catch (e) {
      //     // ignore background errors
      //   }
      // })();
    } catch (err: any) {
      console.error("[AccountSelector] handleSave error", err);
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSetActive(accountNumber: string) {
    setLoading(true);
    console.info(
      `[AccountSelector] setting active account ${accountNumber} for ${phoneNumber}`
    );
    try {
      const res = await fetch("/api/phone-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, accountNumber }),
      });
      if (!res.ok) {
        console.warn(`[AccountSelector] setActive failed ${res.status}`);
        setError(`Set active failed: ${res.status}`);
      } else {
        const updated = await res.json();
        console.info("[AccountSelector] active set", updated);
        await fetchAssociations();
        setSelected(updated.accountNumber);
        onSelected?.(updated);
        // fetch account statement for the activated account (last 12 months)
        // COMMENTED OUT: Statement fetching disabled
        // (async () => {
        //   try {
        //     const end = new Date();
        //     const start = new Date();
        //     start.setFullYear(end.getFullYear() - 1);
        //     const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        //     const resp = await fetch('/api/phone-accounts/fetch-statement', {
        //       method: 'POST',
        //       headers: { 'Content-Type': 'application/json' },
        //       body: JSON.stringify({ phoneNumber, accountNumber, startDate: fmt(start), endDate: fmt(end) })
        //     });
        //     if (!resp.ok) {
        //       const txt = await resp.text().catch(() => null);
        //       console.warn('[AccountSelector] fetch-statement failed', resp.status, txt);
        //     } else {
        //       console.info('[AccountSelector] fetch-statement triggered', await resp.json().catch(() => null));
        //     }
        //   } catch (e) {}
        // })();
      }
    } catch (err: any) {
      console.error("[AccountSelector] handleSetActive error", err);
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <strong>Phone:</strong> <span className="font-mono">{phoneNumber}</span>
      </div>

      <div>
        <h4 className="font-medium">Existing associations</h4>
        {associations.length === 0 ? (
          <div className="text-sm text-muted-foreground">No saved accounts</div>
        ) : (
          <ul className="space-y-2 overflow-y-auto max-h-56 pr-2">
            {associations.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <div>
                  <div className="font-mono">{a.accountNumber}</div>
                  <div className="text-sm">{a.customerName}</div>
                </div>
                <div>
                  {a.isActive ? (
                    <span className="text-green-600 font-medium">Active</span>
                  ) : (
                    <button
                      className="btn"
                      onClick={() => handleSetActive(a.accountNumber)}
                      disabled={loading}
                    >
                      Set Active
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="font-medium">Accounts</h4>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {externalAccounts === null ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : externalAccounts.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No accounts found for this phone
          </div>
        ) : (
          <ul className="space-y-2 overflow-y-auto max-h-56 pr-2">
            {externalAccounts.map((ea, idx) => {
              const accNum = String(ea.AccountNumber);
              const associated = associations.find(
                (s) => s.accountNumber === accNum
              );
              return (
                <li key={idx} className="flex items-center justify-between">
                  <div>
                    <div className="font-mono">{accNum}</div>
                    <div className="text-sm">
                      {ea.Name} {ea.Status ? `(${ea.Status})` : ""}
                    </div>
                  </div>
                  <div>
                    {associated ? (
                      associated.isActive ? (
                        <span className="text-green-600">Selected</span>
                      ) : (
                        <button
                          className="btn"
                          onClick={() => handleSetActive(accNum)}
                          disabled={loading}
                        >
                          Use
                        </button>
                      )
                    ) : (
                      <button
                        className="btn"
                        onClick={() => handleSave(accNum, ea.Name)}
                        disabled={loading}
                      >
                        Select
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
