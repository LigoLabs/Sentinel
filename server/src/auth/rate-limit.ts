interface Bucket {
  count: number;
  resetAt: number;
  blockedUntil: number;
}

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

const buckets = new Map<string, Bucket>();

function now(): number {
  return Date.now();
}

function pruneExpired(): void {
  const t = now();
  if (buckets.size < 1000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt < t && b.blockedUntil < t) buckets.delete(key);
  }
}

export interface RateLimitCheck {
  ok: boolean;
  retryAfterSeconds?: number;
}

export function check(key: string): RateLimitCheck {
  const t = now();
  const b = buckets.get(key);
  if (!b) return { ok: true };
  if (b.blockedUntil > t) {
    return { ok: false, retryAfterSeconds: Math.ceil((b.blockedUntil - t) / 1000) };
  }
  if (b.resetAt < t) {
    buckets.delete(key);
    return { ok: true };
  }
  if (b.count >= MAX_ATTEMPTS) {
    b.blockedUntil = t + BLOCK_MS;
    return { ok: false, retryAfterSeconds: Math.ceil(BLOCK_MS / 1000) };
  }
  return { ok: true };
}

export function recordFailure(key: string): void {
  pruneExpired();
  const t = now();
  const b = buckets.get(key);
  if (!b || b.resetAt < t) {
    buckets.set(key, { count: 1, resetAt: t + WINDOW_MS, blockedUntil: 0 });
    return;
  }
  b.count++;
  if (b.count >= MAX_ATTEMPTS) {
    b.blockedUntil = t + BLOCK_MS;
  }
}

export function recordSuccess(key: string): void {
  buckets.delete(key);
}
