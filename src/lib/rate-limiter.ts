type AttemptRecord = {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number; // timestamp in ms
};

const attempts = new Map<string, AttemptRecord>();

// Configurable limits
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // sliding window (15 minutes)
const LOCKOUT_MS = 1 * 60 * 1000; // 1 minute lockout when max attempts reached

export function isBlocked(key: string) {
  const rec = attempts.get(key);
  if (!rec) return false;
  const now = Date.now();
  // clear expired window
  if (now - rec.firstAttemptAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  if (rec.lockedUntil && now < rec.lockedUntil) return true;
  return false;
}

export function getLockRemainingMs(key: string) {
  const rec = attempts.get(key);
  if (!rec || !rec.lockedUntil) return 0;
  const now = Date.now();
  return Math.max(0, rec.lockedUntil - now);
}

// progressive backoff in seconds based on current failed count (capped)
export function getBackoffSeconds(key: string) {
  const rec = attempts.get(key);
  if (!rec) return 0;
  // exponential backoff: 2^(count-1), cap to 60s
  const secs = Math.min(60, Math.pow(2, Math.max(0, rec.count - 1)));
  return secs;
}

export function recordFailedAttempt(key: string) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  if (now - rec.firstAttemptAt > WINDOW_MS) {
    // reset window
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  rec.count += 1;
  // if we've hit or exceeded max attempts, set a lockout
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(key, rec);
}

export function resetAttempts(key: string) {
  attempts.delete(key);
}

export function getRemainingAttempts(key: string) {
  const rec = attempts.get(key);
  if (!rec) return MAX_ATTEMPTS;
  const now = Date.now();
  if (now - rec.firstAttemptAt > WINDOW_MS) {
    attempts.delete(key);
    return MAX_ATTEMPTS;
  }
  return Math.max(0, MAX_ATTEMPTS - rec.count);
}

export { MAX_ATTEMPTS, WINDOW_MS, LOCKOUT_MS };
