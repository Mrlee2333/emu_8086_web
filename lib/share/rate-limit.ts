import {
  SHARE_CREATE_RATE_LIMIT,
  SHARE_CREATE_RATE_WINDOW_MS,
  SHARE_CREATE_SHARED_RATE_LIMIT,
} from "@/lib/share/constants";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Key used when no trustworthy client IP could be resolved. */
export const UNKNOWN_BUCKET = "unknown";

/** Hard ceiling on tracked buckets; a leak guard for the long-lived standalone server. */
const MAX_BUCKETS = 10_000;

/**
 * Shape check for a bare IPv4 / IPv6 literal.
 *
 * This is a sanity filter, not identity verification. It requires at least one
 * digit so obvious junk ("...", "abc") collapses into the shared bucket
 * instead of minting a bucket of its own, but anything shaped like a literal
 * still passes — and with no proxy in front, `x-real-ip` is client-settable
 * anyway, so per-client limiting is best-effort by nature. `MAX_BUCKETS` is
 * the actual memory backstop.
 */
const IP_SHAPE = /^(?=.*\d)[0-9a-f:.]{3,45}$/i;

/** Drop expired buckets occasionally so idle keys do not accumulate forever. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

let sinceSweep = 0;

/** In-memory rate limit (per server instance). */
export function checkShareCreateRateLimit(ip: string): {
  ok: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const key = ip || UNKNOWN_BUCKET;
  // Callers we could not identify share one bucket, so they get the looser
  // ceiling instead of the per-IP one. Otherwise a single unknown caller
  // would consume the whole install's quota.
  const limit =
    key === UNKNOWN_BUCKET ? SHARE_CREATE_SHARED_RATE_LIMIT : SHARE_CREATE_RATE_LIMIT;
  let bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    if (++sinceSweep >= 256) {
      sinceSweep = 0;
      sweep(now);
    }
    // Drop the least-recently-inserted key rather than growing without bound.
    if (!bucket && buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next();
      if (!oldest.done) buckets.delete(oldest.value);
    }
    bucket = { count: 0, resetAt: now + SHARE_CREATE_RATE_WINDOW_MS };
    buckets.set(key, bucket);
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { ok: true };
}

/**
 * Resolve the caller's IP from a platform-set header only.
 *
 * `x-forwarded-for` is client-appendable, so honouring its first hop would let
 * any caller mint a fresh rate-limit bucket per request. Vercel overwrites
 * `x-vercel-forwarded-for`; a self-hosted reverse proxy sets `x-real-ip`.
 *
 * Returns `UNKNOWN_BUCKET` when neither is usable. Standalone deployments
 * should terminate TLS behind a proxy that sets `x-real-ip`, otherwise all
 * traffic shares the looser bucket.
 */
export function clientIpFromRequest(req: Request): string {
  const raw = process.env.VERCEL
    ? req.headers.get("x-vercel-forwarded-for") ??
      req.headers.get("x-real-ip")
    : req.headers.get("x-real-ip");
  const ip = raw?.split(",")[0]?.trim() ?? "";
  return IP_SHAPE.test(ip) ? ip.toLowerCase() : UNKNOWN_BUCKET;
}
