// src/lib/agent/ratelimit.ts  (WS3)
// Best-effort, per-instance token bucket against runaway agent loops and repeated crawl/scan launches.
// NOT a security boundary: serverless instances do not share memory.
const BUCKETS = {
  read: { cap: 120, perMs: 60_000 },
  expensive: { cap: 5, perMs: 600_000 },
} as const;

export type RateLimitKind = keyof typeof BUCKETS;

const state = new Map<string, { tokens: number; ts: number }>();

export function clientKey(req: Request | null): string {
  return req?.headers.get("x-forwarded-for")?.split(",")[0].trim() || req?.headers.get("x-real-ip") || "anon";
}

export function rateLimit(req: Request | null, kind: RateLimitKind, now = Date.now()): boolean {
  const { cap, perMs } = BUCKETS[kind];
  const k = `${kind}:${clientKey(req)}`;
  const s = state.get(k) ?? { tokens: cap, ts: now };
  s.tokens = Math.min(cap, s.tokens + ((now - s.ts) / perMs) * cap);
  s.ts = now;
  if (s.tokens < 1) {
    state.set(k, s);
    return false;
  }
  s.tokens -= 1;
  if (state.size > 10_000) state.clear();
  state.set(k, s);
  return true;
}

/** Tests only. */
export const resetRateLimits = () => state.clear();
