import { describe, it, expect, afterEach } from "vitest";
import { isLershaInboundPath, verifyLershaApiKey } from "./inbound-auth";

/**
 * The inbound key is the only thing standing in front of endpoints that rewrite
 * product prices and drive loan approval/disbursement, so the fail-open case
 * (unset env var) and the prefix boundaries are both pinned here.
 */

const ORIGINAL = process.env.LERSHA_INBOUND_API_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LERSHA_INBOUND_API_KEY;
  else process.env.LERSHA_INBOUND_API_KEY = ORIGINAL;
});

describe("isLershaInboundPath", () => {
  it("matches every endpoint in the Lersha contract", () => {
    // Mirrors docs/NIB-Lersha-Integration.postman_collection.json.
    for (const p of [
      "/api/v1/nib/priceChange",
      "/api/v1/nib/agroDealerChange",
      "/api/v1/nib/insuranceRequest",
      "/api/farmer/sendFarmerDetail",
      "/api/farmer/hasAccount",
      "/api/farmer/loanRequest",
      "/api/farmer/OtpConfirmation",
      "/api/farmer/disbursement",
      "/api/farmer/contract/content",
      "/api/farmer/contract/request",
      "/api/farmer/contract/verify",
    ]) {
      expect(isLershaInboundPath(p), p).toBe(true);
    }
  });

  it("leaves /api/farmer/approval alone — it is an admin action, not Lersha's", () => {
    // Guarding it would 401 the approve/reject button in the admin UI, which
    // authenticates with a session cookie and sends no API key.
    expect(isLershaInboundPath("/api/farmer/approval")).toBe(false);
  });

  it("matches a bare prefix with no trailing segment", () => {
    expect(isLershaInboundPath("/api/farmer")).toBe(true);
  });

  it("does not match on a partial segment", () => {
    // Guards against /api/farmers or /api/farmer-loans being swept in.
    expect(isLershaInboundPath("/api/farmers")).toBe(false);
    expect(isLershaInboundPath("/api/farmer-loans/123")).toBe(false);
  });

  it("leaves unrelated API routes alone", () => {
    expect(isLershaInboundPath("/api/admin/users")).toBe(false);
    expect(isLershaInboundPath("/api/cbs/notifications/credit")).toBe(false);
  });
});

describe("verifyLershaApiKey", () => {
  it("fails open when the env var is unset, so the rollout can ship first", () => {
    delete process.env.LERSHA_INBOUND_API_KEY;
    expect(verifyLershaApiKey(null)).toEqual({ ok: true, reason: "not-configured" });
  });

  it("treats an empty/whitespace env var as unconfigured", () => {
    process.env.LERSHA_INBOUND_API_KEY = "  ,  ";
    expect(verifyLershaApiKey(null)).toEqual({ ok: true, reason: "not-configured" });
  });

  it("accepts the configured key", () => {
    process.env.LERSHA_INBOUND_API_KEY = "nib_secret";
    expect(verifyLershaApiKey("nib_secret")).toEqual({ ok: true, reason: "authorized" });
  });

  it("rejects a wrong key", () => {
    process.env.LERSHA_INBOUND_API_KEY = "nib_secret";
    expect(verifyLershaApiKey("nib_wrong")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a key that is a prefix of the real one", () => {
    process.env.LERSHA_INBOUND_API_KEY = "nib_secret";
    expect(verifyLershaApiKey("nib_")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a missing or blank header once configured", () => {
    process.env.LERSHA_INBOUND_API_KEY = "nib_secret";
    expect(verifyLershaApiKey(null)).toEqual({ ok: false, reason: "missing" });
    expect(verifyLershaApiKey("   ")).toEqual({ ok: false, reason: "missing" });
  });

  it("tolerates whitespace around the presented key", () => {
    process.env.LERSHA_INBOUND_API_KEY = "nib_secret";
    expect(verifyLershaApiKey(" nib_secret ")).toEqual({ ok: true, reason: "authorized" });
  });

  it("accepts either key mid-rotation", () => {
    process.env.LERSHA_INBOUND_API_KEY = "nib_old, nib_new";
    expect(verifyLershaApiKey("nib_old")).toEqual({ ok: true, reason: "authorized" });
    expect(verifyLershaApiKey("nib_new")).toEqual({ ok: true, reason: "authorized" });
    expect(verifyLershaApiKey("nib_retired")).toEqual({ ok: false, reason: "invalid" });
  });
});
