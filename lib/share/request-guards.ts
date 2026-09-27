import { NextResponse } from "next/server";
import { SHARE_MAX_BYTES } from "@/lib/share/constants";
import { siteConfig } from "@/lib/seo";

/**
 * Reject cross-origin writes to the share API.
 *
 * `Request.json()` parses a body regardless of the declared content type, so a
 * form-free `fetch` from any page is a CORS-simple request: no preflight, the
 * write lands, the attacker just cannot read the reply. That is enough to fill
 * the `shared_programs` table, so the write endpoint checks explicitly.
 */
export function rejectCrossOrigin(req: Request): NextResponse | null {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let hostname: string;
    try {
      // Compare `hostname`, not `host`: the Electron shell picks a random port
      // per launch, so the origin always carries one.
      hostname = new URL(origin).hostname;
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const allowed = new Set<string>([
      new URL(siteConfig.url).hostname,
      // The Electron shell and `next dev` serve the app over loopback.
      "127.0.0.1",
      "localhost",
    ]);
    if (!allowed.has(hostname)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return null;
}

/**
 * Reject oversized bodies before buffering them.
 *
 * The `source` byte cap is enforced after parsing, which still lets a caller
 * make the server allocate an arbitrarily large string. `Content-Length` lets
 * short-circuit the common case; the slack covers JSON escaping overhead.
 */
export function rejectOversizedBody(req: Request): NextResponse | null {
  const header = req.headers.get("content-length");
  if (!header) return null;
  const len = Number(header);
  if (Number.isFinite(len) && len > SHARE_MAX_BYTES * 2) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }
  return null;
}
