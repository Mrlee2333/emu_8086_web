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
 * Fast rejection using the declared body size.
 *
 * `Content-Length` is absent for chunked transfer encoding, so this is a
 * cheap early exit, not the limit itself — `readJsonBody` below enforces the
 * cap on the bytes actually read. The slack covers JSON escaping overhead.
 */
export function rejectOversizedBody(req: Request): NextResponse | null {
  const header = req.headers.get("content-length");
  if (!header) return null;
  const len = Number(header);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }
  return null;
}

/** Hard ceiling on the request body, enforced while reading rather than after. */
export const MAX_BODY_BYTES = SHARE_MAX_BYTES * 2;

export type BodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Read and parse the JSON body, aborting once the cap is passed.
 *
 * `req.json()` buffers the whole body before anything can inspect it, so a
 * caller using chunked encoding (no `Content-Length`, so the guard above does
 * not fire) could make the server allocate an arbitrary string before the
 * post-parse `source` check rejected it. Reading the stream and counting bytes
 * makes the cap real: the reader is cancelled at the first chunk that crosses
 * it, so peak allocation is bounded by the cap plus one chunk.
 */
export async function readJsonBody(req: Request): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Body too large" }, { status: 413 }),
    };
  }

  const stream = req.body;
  if (!stream) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflowed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        // Stop reading but do NOT `reader.cancel()`: on a real request the
        // stream is backed by the socket, and cancelling it aborts the
        // connection, which the server then reports as 400 instead of our
        // 413. Leaving the remainder unread is fine — the response ends the
        // exchange and the socket is closed or drained by the server.
        overflowed = true;
        break;
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  if (overflowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Body too large" }, { status: 413 }),
    };
  }

  try {
    const merged = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      merged.set(chunk, at);
      at += chunk.byteLength;
    }
    return { ok: true, body: JSON.parse(new TextDecoder().decode(merged)) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}
