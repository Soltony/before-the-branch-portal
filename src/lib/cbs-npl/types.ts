// Types mirroring the CBS "Digital Loan Repayment" API surface
// described in docs/Digital-Loan-Repayment.postman_collection.json.

export interface CbsBulkUploadRequest {
  accountNumbers: string[];
}

export interface CbsBulkUploadResponse {
  totalReceived: number;
  insertedCount: number;
  alreadyExistsCount: number;
}

export interface CbsCreditNotificationPayload {
  // Account number that received a credit / deposit.
  accountNumber: string;
  // Amount credited to the account.
  amount: number | string;
  // Current total balance on the account (after the credit).
  currentBalance?: number | string;
  // Minimum balance the account must retain.
  accountMinimumBalance?: number | string;
  // Account category/classification supplied by the CBS.
  accountCategory?: string;
  // Optional fields the CBS may include for traceability.
  correlationId?: string;
  externalReference?: string;
  providerId?: string;
  notifiedAt?: string;
  [key: string]: unknown;
}

export interface CbsRepayRequest {
  correlationId: string;
  accountNumber: string;
  amount: string | number;
  providerId: string;
}

export interface CbsRepayResponse {
  status: "Success" | "Failed" | string;
  message: string;
  status_code: number;
  transactionId: string | null;
  debitAmount: number | null;
  debitAccount: string | null;
  creditAccount: string | null;
  providerId: string | null;
}

export interface CbsCallResult<T> {
  ok: boolean;
  status: number;
  data: T | undefined;
  requestBody: unknown;
  rawResponse: string | undefined;
  durationMs: number;
  error?: string;
}
