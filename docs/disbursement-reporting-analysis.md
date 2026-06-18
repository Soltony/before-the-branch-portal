# Disbursement Reporting Issue — Technical & Functional Analysis

## Executive Summary

The Disbursement Report shows **POSTED** for all disbursement rows and sometimes shows the wrong account because:

1. **Status** is derived only from **ledger state** (JournalEntry with no Payment), not from the **business outcome** (DisbursementTransaction).
2. **Direct matching by loanId never runs** — the report API does not select `loanId` when loading DisbursementTransaction, so the loanId-based map is always empty and matching falls back to account+amount+timestamp, which fails for many rows.
3. When no DisbursementTransaction match is found, the report keeps **transactionStatus = "POSTED"** and uses the borrower’s **default** account (PhoneAccount/provisioned) instead of the actual disbursed account.

The Reversal page is correct because it reads **DisbursementTransaction** directly and shows its status and reference.

---

## 1. What POSTED Represents in the System

### 1.1 Ledger state vs business outcome

| Concept | Meaning in this system |
|--------|-------------------------|
| **Ledger state** | “We have posted a disbursement in our books.” Represented by a **JournalEntry** with `loanId` set and **no** linked `Payment` (debit Principal Receivable, etc.). Created when the loan is created. |
| **Business outcome** | “What actually happened with the bank/CBS.” Represented by **DisbursementTransaction**: `statusCode`, `transactionId`, `disbursementStatus` (PENDING / SENT / SUCCESS / FAILED), and `creditAccount` used in the API call. |

**POSTED** in the Disbursement Report is defined purely from ledger state:

```ts
// src/app/api/reports/transactions/route.ts (line 310)
const transactionStatus = je.payment ? "COMPLETED" : "POSTED";
```

So:

- **POSTED** = “This row comes from a disbursement **JournalEntry**” (no repayment/Payment linked).
- It does **not** mean “money was successfully sent” or “bank confirmed.” It only means “we have a book entry for a disbursement.”

Therefore, POSTED is a **ledger state**, not a **business outcome**. Successful, failed, reversed, and account-changed cases all have a disbursement JournalEntry, so they all show POSTED when the report does not enrich from DisbursementTransaction.

---

## 2. Root Cause: Why POSTED Is Shown for Multiple Final Outcomes

### 2.1 Report data flow

1. **Primary source**: Disbursement report is driven by **JournalEntry** (filter: `payment: null`, i.e. disbursement entries).
2. **Status**: For each such JE, `transactionStatus` is set to **"POSTED"** and **never updated** from DisbursementTransaction.
3. **Enrichment**: The API then tries to find a **DisbursementTransaction** and, if found, sets:
   - `disbursementOutcome` (e.g. "Success", "Failure")
   - `disbursementStatusText`
   - `cbsReference`, `borrowerAccount`, etc.

The UI shows:

```ts
row.disbursementOutcome || row.disbursementStatusText || row.transactionStatus
```

So the **intended** behavior is: when a match exists, show business outcome (Success/Failure); otherwise fall back to POSTED.

### 2.2 Why matching often fails: loanId not selected

The report builds a map of DisbursementTransaction by `loanId` for direct matching:

```ts
// Lines 126–147
const disbursementTxs = await prisma.disbursementTransaction.findMany({
  where: disbursementWhere,
  select: {
    id: true,
    transactionId: true,
    providerId: true,
    originalProviderId: true,
    creditAccount: true,
    amount: true,
    statusCode: true,
    createdAt: true,
    // loanId is NOT selected
  },
});

const disbByLoanId = new Map<string, any>();
for (const d of disbursementTxs) {
  const loanId = (d as any).loanId;  // always undefined
  if (loanId && !disbByLoanId.has(loanId)) {
    disbByLoanId.set(loanId, d);
  }
}
```

Because **`loanId` is not in the select**, `(d as any).loanId` is always **undefined**. So:

- **disbByLoanId** is always **empty**.
- The “1️⃣ PRIORITY: Direct match by loanId” **never** finds a row.
- Every row falls back to “2️⃣ FALLBACK: Match by Account + Amount + Timestamp ±3 min.”

That fallback can fail when:

- Disbursement used a **different account** (e.g. salary advance, retry to another account).
- **Timing** is outside the 3-minute window.
- **Multiple** DisbursementTransactions exist for the same account/amount (wrong one picked).
- Account normalization (e.g. stripping non-digits) doesn’t align.

When the fallback fails, there is **no** DisbursementTransaction match, so:

- `disbursementOutcome` / `disbursementStatusText` stay null.
- UI falls back to **transactionStatus → "POSTED"**.
- Successful, failed, reversed, and account-changed cases can all show POSTED.

**Root cause**: Status is ledger-only; enrichment is best-effort; and the primary enrichment path (match by loanId) is broken because `loanId` is not selected.

---

## 3. Why the Disbursement Report Account Differs From the Actual Disbursed Account

### 3.1 Where the report gets the account

- **creditAccount** (in API response): From **ledger** — the provider’s disbursement ledger account name (e.g. “Principal Disbursement”), not the customer’s bank account.
- **borrowerAccount**: Intended to be the **customer bank account** used for disbursement. It is set as:
  1. Default: **PhoneAccount** or **provisionedData** for the borrower (one “known” account).
  2. If a **DisbursementTransaction** is matched: overwritten with **match.creditAccount** (the account sent to the disbursement API).

So:

- When **no match**: report shows the borrower’s **default** account (e.g. from PhoneAccount), which may not be the account used for that specific disbursement.
- When **wrong match** (fallback picks another transaction): report shows that transaction’s account.
- When **match by loanId** would have worked but doesn’t** (because loanId isn’t selected): again default account is shown.

The “Credit Account (Customer Account)” column uses `row.borrowerAccount || row.creditAccount`. If `borrowerAccount` is null, it can even show the **ledger** account name, which is incorrect for “customer account.”

### 3.2 When actual account differs

- **Salary advance / multiple accounts**: Disbursement may go to a different account than the borrower’s default in PhoneAccount.
- **Retries**: First attempt to A, second to B; report may show A or a wrong match.
- **No match**: Only default account is available → often not the actual disbursed account.

So the account differs because the report often fails to attach the **correct** DisbursementTransaction (broken loanId match + fragile fallback), and then falls back to a single “default” borrower account.

---

## 4. Why the Reversal Page Reflects Correct Status and Reference

### 4.1 Reversal page data source

- **Failed / All filter**: Data comes from **DisbursementTransaction** only (no JournalEntry).
- Each row is a DisbursementTransaction with:
  - **transactionId** from the gateway (bank/CBS reference).
  - **statusCode** from the HTTP response.
  - **creditAccount** from the actual API request.
  - **disbursementStatus** derived in code: SUCCESS (2xx), FAILED (non-2xx), PENDING.

```ts
// src/app/api/reversals/route.ts (lines 399–404)
disbursementStatus: isSuccessStatus(t.statusCode)
  ? "SUCCESS"
  : isFailureStatus(t.statusCode)
    ? "FAILED"
    : "PENDING",
```

- **Posted filter**: Shows **loans** that have **no** DisbursementTransaction (`disbursementTransactions: { none: {} }`), labeled as POSTED (ledger-only).

So the Reversal page uses **DisbursementTransaction** as the source of truth for:

- Final status (SUCCESS / FAILED / PENDING / POSTED).
- Bank transaction reference (`transactionId`).
- Account actually used (`creditAccount`).

That is why the same transaction can show **SUCCESS** and a valid reference on the Reversal page but **POSTED** and wrong/missing account on the Disbursement Report when the report fails to match that DisbursementTransaction.

---

## 5. Gaps in Data Modeling, Status Lifecycle, and Reporting

### 5.1 Data model

| Gap | Detail |
|-----|--------|
| No explicit link JournalEntry ↔ DisbursementTransaction | Report must infer the link by loanId or account+amount+time. JournalEntry has no FK to DisbursementTransaction. |
| DisbursementTransaction.loanId optional | Some flows may create records without loanId; report’s loanId match would still be the right fix for records that do have it, but currently doesn’t run. |
| Multiple DisbursementTransactions per loan | Retries create multiple rows per loan. Report’s disbByLoanId (when fixed) uses “first” per loanId; no rule for “latest” or “successful” only. |

### 5.2 Status lifecycle

| Gap | Detail |
|-----|--------|
| Single “transaction status” mixes two concepts | Ledger state (POSTED) vs business outcome (SUCCESS/FAILED/REVERSED) are conflated in one field. |
| Ledger not updated when disbursement fails/reverses | JournalEntry is created at loan creation and not updated when the external disbursement fails or is reversed; reporting still shows that JE as POSTED. |
| Reversal state not in DisbursementTransaction | Reversal is in AuditLog / PendingChange; report doesn’t join these to show REVERSED on the same row. |

### 5.3 Reporting logic

| Gap | Detail |
|-----|--------|
| loanId not selected | DisbursementTransaction query omits loanId → loanId map empty → direct match never used. |
| Fragile fallback | Account+amount+time ±3 min can mismatch (wrong account, timing, or multiple attempts). |
| No “best” transaction per loan | When multiple DisbursementTransactions exist per loan, no ordering (e.g. by createdAt desc or by SUCCESS) to choose the one to show. |

---

## 6. Recommended Fixes

### 6.1 Short-term (UI and API fixes)

1. **Fix loanId in report API (critical)**  
   Add `loanId` to the DisbursementTransaction select in `/api/reports/transactions/route.ts` so that `disbByLoanId` is populated and direct match by loanId works.

2. **Use business outcome as primary status on report**  
   When a DisbursementTransaction is matched, set the **display** status from that record (e.g. derive a single `transactionStatus` from `disbursementStatus` / `statusCode` and reversal state), and only fall back to POSTED when there is no match. Optionally keep a separate “Ledger status” (POSTED) for clarity.

3. **Prefer matched account**  
   Already intended; once matching is fixed (loanId + optional ordering), ensure “Credit Account (Customer Account)” always uses matched DisbursementTransaction.creditAccount when available, and label clearly when showing “default account (no CBS match).”

4. **Reversal page: show REVERSED/CANCELLED in status**  
   Reversal page already has reversal/cancel info; ensure Disbursement Report (when it uses DisbursementTransaction) also considers AuditLog/PendingChange so that REVERSED/CANCELLED can be shown where applicable.

### 6.2 Long-term (architecture and data model)

1. **Explicit link JournalEntry ↔ DisbursementTransaction**  
   Add optional `disbursementTransactionId` (or similar) on JournalEntry or a dedicated link table, set when the disbursement JE is created or when the external call completes. Report then joins instead of heuristic matching.

2. **Separate ledger state and business outcome**  
   - **Ledger**: keep “posted” as a flag or status on the JE (or on a disbursement ledger view).  
   - **Business**: use DisbursementTransaction (and reversal/cancel) as source for: SUCCESS, FAILED, PENDING, REVERSED, CANCELLED.  
   Reporting and UI should show **business outcome** by default, with optional “ledger status” for finance/recon.

3. **Single source of truth for “disbursement status”**  
   Define one place (e.g. DisbursementTransaction + reversal/cancel) as the source for “what happened with this disbursement.” Reports and Reversal page should both read from that.

4. **Lifecycle and reconciliation**  
   - When external disbursement fails: optionally keep JE but mark loan or a “disbursement attempt” as failed; or create a reversing JE.  
   - When disbursement is reversed: update ledger (reversing entry) and mark DisbursementTransaction (or link table) as REVERSED.  
   - Reconciliation job: compare JournalEntry (and ledger) vs DisbursementTransaction and flag mismatches (e.g. SUCCESS in CBS but no JE, or JE but no SUCCESS).

### 6.3 Backfill and reconciliation

- **Backfill**: For existing DisbursementTransactions with loanId, no schema change needed for the report fix; once `loanId` is selected, existing data will match.  
- **Reconciliation**:  
  - List loans with disbursement JEs but no DisbursementTransaction or no SUCCESS.  
  - List DisbursementTransaction SUCCESS with no matching JE.  
  - Optionally backfill `journalEntryId` or `disbursementTransactionId` where the link can be inferred (e.g. by loanId + date/amount).

---

## 7. Best Practices (Payment/Disbursement Systems)

1. **Separate ledger and settlement**  
   Ledger = what we book; settlement = what the bank did. Never use “POSTED” alone to mean “money sent successfully.”

2. **One source of truth for settlement status**  
   One table (or bounded context) owns “disbursement outcome” (pending/success/failed/reversed). All UIs and reports derive from it.

3. **Explicit links**  
   Link disbursement JEs to the settlement/payment record (e.g. DisbursementTransaction) by FK or stable id, not only by heuristics (amount, time, account).

4. **Idempotency and retries**  
   Support multiple attempts per loan; reporting should have a clear rule for “which attempt to show” (e.g. latest, or latest SUCCESS).

5. **Reconciliation**  
   Automated comparison of ledger vs gateway/CBS (counts, amounts, status) and clear handling of exceptions (e.g. reversed, account-changed).

6. **Audit and traceability**  
   Keep gateway response (e.g. statusCode, transactionId) and link it to the loan and JE for dispute resolution and reporting.

---

## 8. Impact Summary

| Area | Impact |
|------|--------|
| **Operational** | Staff may believe “POSTED” means success; failed or reversed disbursements look the same as successful ones. |
| **Reconciliation** | Hard to reconcile report vs bank/CBS when status and account are wrong or missing. |
| **Compliance / audit** | Incorrect status and account on official reports; Reversal page is more reliable than the report. |
| **Only some transactions** | Explained by fallback match: when account+amount+time match succeeds, outcome and account are correct; when it fails (or loanId match never runs), POSTED and default account appear. |

Fixing the report API (include `loanId`, use matched outcome for status and account) will align the Disbursement Report with the Reversal page and with actual disbursement outcomes for most rows; the longer-term improvements will make behavior consistent and auditable across all cases.
