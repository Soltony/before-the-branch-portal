import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Every outbound call to Lersha must leave a request/response pair in the audit
 * log — it is the only durable record of what Lersha was told about a farmer or
 * a loan. These tests pin that down, and that the shared API key never reaches
 * the log.
 */

const API_KEY = "lersha-issued-secret-key";

// client.ts reads its env at import time, so set it before anything is imported.
vi.hoisted(() => {
  process.env.LERSHA_API_KEY = "lersha-issued-secret-key";
  process.env.LERSHA_API_BASE_URL = "https://lersha.test/api/v1";
});

const mockAuditCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    auditLog: { create: (...args: any[]) => mockAuditCreate(...args) },
  },
}));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sendLoanDecision, sendDisbursementConfirmation } from "@/lib/lersha/client";

const mockFetch = vi.fn();

/** The rows written to AuditLog, with `details` parsed back from JSON. */
function auditRows() {
  return mockAuditCreate.mock.calls.map(([arg]) => ({
    ...arg.data,
    details: JSON.parse(arg.data.details),
  }));
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuditCreate.mockResolvedValue({});
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Lersha client audit trail", () => {
  it("records the request and the response of a successful call", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { received: true }));

    const result = await sendLoanDecision(
      { farmer_id: "FARMER001", decision: "APPROVED", reference_no: "REF1" } as any,
      {
        actorId: "user-42",
        ipAddress: "10.0.0.7",
        userAgent: "jest-browser",
        entity: "LershaFarmer",
        entityId: "farmer-internal-1",
      },
    );

    expect(result.ok).toBe(true);

    const rows = auditRows();
    expect(rows.map((r) => r.action)).toEqual([
      "EXTERNAL_API_REQUEST_SENT",
      "EXTERNAL_API_RESPONSE_RECEIVED",
    ]);

    for (const row of rows) {
      expect(row.actorId).toBe("user-42");
      expect(row.entity).toBe("LershaFarmer");
      expect(row.entityId).toBe("farmer-internal-1");
      expect(row.ipAddress).toBe("10.0.0.7");
      expect(row.userAgent).toBe("jest-browser");
      expect(row.details.integration).toBe("LERSHA");
    }

    const [request, response] = rows;
    expect(request.details.request.url).toBe(
      "https://lersha.test/api/v1/nib/loan-decision",
    );
    expect(request.details.request.body).toEqual({
      farmer_id: "FARMER001",
      decision: "APPROVED",
      reference_no: "REF1",
    });
    expect(response.details.response.status).toBe(200);
    expect(response.details.response.body).toEqual({ received: true });

    // The two halves of one call share a correlation id.
    expect(request.details.correlationId).toBeTruthy();
    expect(response.details.correlationId).toBe(request.details.correlationId);
  });

  it("sends the API key to Lersha but never writes it to the audit log", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {}));

    await sendLoanDecision({ farmer_id: "FARMER001", decision: "DECLINED" } as any);

    // Still sent on the wire...
    expect(mockFetch.mock.calls[0][1].headers["X-API-Key"]).toBe(API_KEY);

    // ...but redacted in what is stored.
    const [request] = auditRows();
    expect(request.details.request.headers["X-API-Key"]).toBe("[redacted]");
    for (const [arg] of mockAuditCreate.mock.calls) {
      expect(JSON.stringify(arg.data)).not.toContain(API_KEY);
    }
  });

  it("records a non-2xx answer so a rejected notification is visible", async () => {
    mockFetch.mockResolvedValue(jsonResponse(503, { error: "down" }));

    const result = await sendDisbursementConfirmation(
      {
        farmer_id: "FARMER001",
        remaining_balance: 1500,
        productId: "prod-1",
        referenceNo: "REF1",
        status: "DISBURSED",
      },
      { entity: "LershaLoanRequest", entityId: "req-1", context: { loanId: "loan-9" } },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);

    const rows = auditRows();
    const response = rows[1];
    expect(response.action).toBe("EXTERNAL_API_RESPONSE_RECEIVED");
    expect(response.details.response.status).toBe(503);
    expect(response.details.response.body).toEqual({ error: "down" });
    // Ties the call back to the loan it was about.
    expect(response.details.context).toEqual({ loanId: "loan-9" });
    // No actor supplied → attributed to the system rather than left blank.
    expect(response.actorId).toBe("system");
  });

  it("records an error and still throws when Lersha cannot be reached", async () => {
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      sendLoanDecision({ farmer_id: "FARMER001", decision: "APPROVED" } as any, {
        actorId: "user-42",
      }),
    ).rejects.toThrow("connect ECONNREFUSED");

    const rows = auditRows();
    expect(rows.map((r) => r.action)).toEqual([
      "EXTERNAL_API_REQUEST_SENT",
      "EXTERNAL_API_ERROR",
    ]);
    expect(rows[1].details.error.message).toBe("connect ECONNREFUSED");
    expect(rows[1].details.correlationId).toBe(rows[0].details.correlationId);
  });

  it("does not let an audit-log failure break the call to Lersha", async () => {
    mockAuditCreate.mockRejectedValue(new Error("database is down"));
    mockFetch.mockResolvedValue(jsonResponse(200, { received: true }));

    const result = await sendLoanDecision({
      farmer_id: "FARMER001",
      decision: "APPROVED",
    } as any);

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
