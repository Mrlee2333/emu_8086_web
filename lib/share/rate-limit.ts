import {
  SHARE_CREATE_RATE_LIMIT,
  SHARE_CREATE_RATE_WINDOW_MS,
} from "@/lib/share/constants";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Hard ceiling on tracked buckets; a leak guard for the long-lived standalone server. */
const MAX_BUCKETS = 10_000;

/** Matches a bare IPv4 / IPv6 literal. Anything else collapses to the shared bucket. */
const IP_SHAPE = /^[0-9a-f:.]{3,45}$/i;

/** Drop expired buckets occasionally so idle keys do not accumulate forever. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

let sinceSweep = 0;

/** In-memory IP rate limit (per server instance). */
export function checkShareCreateRateLimit(ip: string): {
  ok: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const key = ip || "unknown";
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

  if (bucket.count >= SHARE_CREATE_RATE_LIMIT) {
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
 */
export function clientIpFromRequest(req: Request): string {
  const raw = process.env.VERCEL
    ? req.headers.get("x-vercel-forwarded-for") ??
      req.headers.get("x-real-ip")
    : req.headers.get("x-real-ip");
  const ip = raw?.split(",")[0]?.trim() ?? "";
  return IP_SHAPE.test(ip) ? ip.toLowerCase() : "unknown";
}
