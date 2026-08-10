import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The disbursement kill-switch. The guarantee under test is that it fails
 * CLOSED: any state it cannot confirm must read as "disabled", because the
 * switch exists to stop money moving during exactly the kind of incident that
 * makes the database unreadable.
 */

const mockQueryRaw = vi.fn();
const mockExecuteRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
    $executeRaw: (...args: any[]) => mockExecuteRaw(...args),
  },
}));

import {
  getDisbursementControl,
  areDisbursementsEnabled,
  areDisbursementsEnabledWithin,
} from "@/lib/disbursement-control";

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteRaw.mockResolvedValue(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDisbursementControl", () => {
  it("reports the stored value when the flag reads cleanly", async () => {
    const updatedAt = new Date("2026-08-01T00:00:00Z");
    mockQueryRaw.mockResolvedValue([{ enabled: true, updatedAt }]);

    expect(await getDisbursementControl()).toEqual({
      enabled: true,
      updatedAt,
      unavailable: false,
    });
  });

  it("reports a deliberate switch-off as available, not degraded", async () => {
    mockQueryRaw.mockResolvedValue([{ enabled: false, updatedAt: null }]);

    const control = await getDisbursementControl();

    expect(control.enabled).toBe(false);
    // The distinction the admin UI relies on: an operator turned it off, as
    // opposed to us being unable to tell.
    expect(control.unavailable).toBe(false);
  });

  it("fails closed when the flag cannot be read", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection reset"));

    const control = await getDisbursementControl();

    expect(control.enabled).toBe(false);
    expect(control.unavailable).toBe(true);
    expect(control.reason).toContain("connection reset");
  });

  it("fails closed when the row is still missing after bootstrap", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const control = await getDisbursementControl();

    expect(control.enabled).toBe(false);
    expect(control.unavailable).toBe(true);
  });

  it("fails closed when the bootstrap write itself fails", async () => {
    mockExecuteRaw.mockRejectedValue(new Error("invalid object name"));

    const control = await getDisbursementControl();

    expect(control.enabled).toBe(false);
    expect(control.unavailable).toBe(true);
  });
});

describe("areDisbursementsEnabled", () => {
  it("is false whenever the flag is unreadable", async () => {
    mockQueryRaw.mockRejectedValue(new Error("timeout"));
    expect(await areDisbursementsEnabled()).toBe(false);
  });
});

describe("areDisbursementsEnabledWithin", () => {
  const txWith = (impl: () => Promise<any>) => ({ $queryRaw: impl }) as any;

  it("reads the flag through the caller's transaction", async () => {
    const tx = txWith(async () => [{ enabled: true }]);
    expect(await areDisbursementsEnabledWithin(tx)).toBe(true);
  });

  it("refuses when the switch is off", async () => {
    const tx = txWith(async () => [{ enabled: false }]);
    expect(await areDisbursementsEnabledWithin(tx)).toBe(false);
  });

  it("refuses when the read fails inside the transaction", async () => {
    const tx = txWith(async () => {
      throw new Error("deadlock victim");
    });
    expect(await areDisbursementsEnabledWithin(tx)).toBe(false);
  });

  it("refuses when no control row is visible", async () => {
    const tx = txWith(async () => []);
    expect(await areDisbursementsEnabledWithin(tx)).toBe(false);
  });

  it("does not write inside the caller's transaction", async () => {
    const txExecuteRaw = vi.fn();
    const tx = {
      $queryRaw: async () => [{ enabled: true }],
      $executeRaw: txExecuteRaw,
    } as any;

    await areDisbursementsEnabledWithin(tx);

    // A read-only guard must not bootstrap rows in someone else's transaction.
    expect(txExecuteRaw).not.toHaveBeenCalled();
  });
});
