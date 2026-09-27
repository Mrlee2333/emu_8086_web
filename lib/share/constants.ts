export const SHARE_MAX_BYTES = 65_536;
export const SHARE_TTL_DAYS = [1, 3, 7] as const;
export type ShareTtlDays = (typeof SHARE_TTL_DAYS)[number];
export const SHARE_CODE_LENGTH = 8;
export const SHARE_CODE_PATTERN = /^[0-9a-z]{8}$/;
export const SHARE_CREATE_RATE_LIMIT = 10;
/**
 * Limit for the shared bucket used when no trustworthy client IP is available.
 *
 * On a standalone deployment with no reverse proxy, nothing sets `x-real-ip`,
 * so every caller resolves to the same key. Applying the per-IP limit there
 * would cap the whole install at 10 share links per hour — one user could
 * exhaust creation for everyone. This higher ceiling keeps a bound without
 * turning the limiter into a self-inflicted outage. It is a speed bump, not the
 * real defence: the row budget and the cleanup cron in Supabase are.
 *
 * See the deployment note in `README.md` for setting `x-real-ip`.
 */
export const SHARE_CREATE_SHARED_RATE_LIMIT = 200;
export const SHARE_CREATE_RATE_WINDOW_MS = 60 * 60 * 1000;
