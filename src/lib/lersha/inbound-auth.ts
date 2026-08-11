/**
 * Authentication for the endpoints Lersha calls on us.
 *
 * This is the mirror image of the outbound `X-API-Key` in ./client.ts, but with
 * a DIFFERENT secret: the outbound key is issued by Lersha and lives in their
 * systems, so accepting it inbound would mean any exposure on their side lets a
 * caller drive our loan endpoints. We issue `LERSHA_INBOUND_API_KEY` ourselves
 * and can rotate it without asking anyone.
 *
 * Runs inside middleware (Edge runtime) — no `fs`, so no @/lib/logger, and no
 * node:crypto, so the constant-time compare is hand-rolled below.
 */

/** Header Lersha sends, matching the one we send them. */
export const LERSHA_API_KEY_HEADER = "x-api-key";

/**
 * Route prefixes Lersha calls. Matching by prefix rather than listing each
 * endpoint means a Lersha route added later is guarded by default, instead of
 * silently shipping unauthenticated because someone forgot to list it.
 */
const LERSHA_INBOUND_PREFIXES = ["/api/v1/nib", "/api/farmer"];

/**
 * Routes sitting under those prefixes that are NOT Lersha's.
 *
 * /api/farmer/approval is the bank approving a farmer — an internal action
 * driven by a signed-in admin from our own UI (src/app/admin/farmer-loans),
 * which sends a session cookie and no API key. It only shares the /api/farmer
 * namespace; it is not part of the Lersha contract (see
 * docs/NIB-Lersha-Integration.postman_collection.json).
 *
 * The trade-off of the prefix matching above: a new INTERNAL route filed under
 * these prefixes must be added here or it will 401. That fails loudly in the
 * admin UI, which is the direction we want to err in over a silent auth hole.
 */
const INTERNAL_ROUTE_EXCEPTIONS = ["/api/farmer/approval"];

export function isLershaInboundPath(pathname: string): boolean {
  if (INTERNAL_ROUTE_EXCEPTIONS.includes(pathname)) return false;

  return LERSHA_INBOUND_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

/**
 * Accepts a comma-separated list so a rotation can be done as two independent
 * deploys — add the new key alongside the old, have Lersha cut over, then drop
 * the old one — instead of a synchronised flip.
 */
function configuredKeys(): string[] {
  return (process.env.LERSHA_INBOUND_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Constant-time string compare. Folds the length difference into the same
 * accumulator as the character diff so neither the length nor the position of
 * the first mismatch changes how long the comparison runs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    // charCodeAt past the end is NaN; `|| 0` keeps the XOR well-defined.
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type LershaAuthResult =
  /** Key matched, or auth is not yet configured (see "not-configured"). */
  | { ok: true; reason: "authorized" | "not-configured" }
  /** Caller sent no key at all. */
  | { ok: false; reason: "missing" }
  /** Caller sent a key that matched none of the configured ones. */
  | { ok: false; reason: "invalid" };

/**
 * Verify the API key on an inbound Lersha request.
 *
 * With `LERSHA_INBOUND_API_KEY` unset this returns "not-configured" and the
 * caller is let through — that is what makes the rollout safe to deploy before
 * Lersha starts sending the header. Once the var is set the check is hard.
 * Because it fails OPEN when unset, treat a "not-configured" log line in
 * production as an incident, not noise.
 */
export function verifyLershaApiKey(headerValue: string | null): LershaAuthResult {
  const keys = configuredKeys();
  if (keys.length === 0) return { ok: true, reason: "not-configured" };

  const presented = headerValue?.trim();
  if (!presented) return { ok: false, reason: "missing" };

  // Compare against every configured key rather than short-circuiting, so the
  // number of comparisons doesn't reveal which key position matched.
  let matched = false;
  for (const key of keys) {
    if (timingSafeEqual(presented, key)) matched = true;
  }

  return matched ? { ok: true, reason: "authorized" } : { ok: false, reason: "invalid" };
}
