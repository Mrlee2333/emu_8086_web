/**
 * Share code generation, rate limiting, and request-guard tests.
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextResponse } from "next/server";
import {
  generateShareCode,
  hashSource,
  byteLengthUtf8,
} from "./codes";
import {
  UNKNOWN_BUCKET,
  checkShareCreateRateLimit,
  clientIpFromRequest,
} from "./rate-limit";
import {
  MAX_BODY_BYTES,
  readJsonBody,
  rejectCrossOrigin,
  rejectOversizedBody,
} from "./request-guards";
import {
  SHARE_CODE_PATTERN,
  SHARE_CREATE_RATE_LIMIT,
  SHARE_CREATE_SHARED_RATE_LIMIT,
} from "./constants";

describe("generateShareCode", () => {
  it("always produces a well-formed 8-char code", () => {
    for (let i = 0; i < 2_000; i++) {
      const code = generateShareCode();
      assert.equal(code.length, 8);
      assert.match(code, SHARE_CODE_PATTERN);
    }
  });

  it("fills the code even when draws are rejected", () => {
    // 2x oversampling means a full round of rejections is vanishingly rare,
    // but the loop must still terminate with a full-length code.
    for (let i = 0; i < 5_000; i++) {
      assert.equal(generateShareCode().length, 8);
    }
  });

  it("uses every alphabet character", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) {
      for (const ch of generateShareCode()) seen.add(ch);
    }
    // 36 symbols; 40k draws covers all of them with overwhelming probability.
    assert.equal(seen.size, 36);
  });
});

describe("hashSource / byteLengthUtf8", () => {
  it("is stable and distinguishes content", () => {
    assert.equal(hashSource("mov ax, 1"), hashSource("mov ax, 1"));
    assert.notEqual(hashSource("mov ax, 1"), hashSource("mov ax, 2"));
    assert.match(hashSource("x"), /^[0-9a-f]{64}$/);
  });

  it("counts UTF-8 bytes, not code units", () => {
    assert.equal(byteLengthUtf8("abc"), 3);
    assert.equal(byteLengthUtf8("☺"), 3);
  });
});

describe("clientIpFromRequest", () => {
  const withHeaders = (headers: Record<string, string>): Request =>
    new Request("https://example.test/api/share", { headers });

  it("ignores a spoofed x-forwarded-for", () => {
    const req = withHeaders({
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      "x-real-ip": "9.9.9.9",
    });
    // x-forwarded-for is client-appendable, so it must not become the bucket key.
    assert.equal(clientIpFromRequest(req), "9.9.9.9");
  });

  it("ignores x-forwarded-for entirely when no trusted header is present", () => {
    const req = withHeaders({ "x-forwarded-for": "1.2.3.4" });
    assert.equal(clientIpFromRequest(req), "unknown");
  });

  it("falls back to a shared bucket for junk values", () => {
    for (const junk of ["not-an-ip", "'; drop table--", "", "x".repeat(80)]) {
      const req = withHeaders({ "x-real-ip": junk });
      assert.equal(clientIpFromRequest(req), "unknown");
    }
  });

  it("accepts IPv4 and IPv6 literals and normalizes case", () => {
    assert.equal(
      clientIpFromRequest(withHeaders({ "x-real-ip": "203.0.113.7" })),
      "203.0.113.7",
    );
    assert.equal(
      clientIpFromRequest(withHeaders({ "x-real-ip": "2001:DB8::1" })),
      "2001:db8::1",
    );
  });
});

describe("checkShareCreateRateLimit", () => {
  it("blocks past the limit and reports a retry delay", () => {
    // A key unique to this test so the shared bucket map is not contended.
    const ip = "198.51.100.42";
    let allowed = 0;
    let limited: { ok: boolean; retryAfterSec?: number } | null = null;
    for (let i = 0; i < 20; i++) {
      const res = checkShareCreateRateLimit(ip);
      if (res.ok) allowed++;
      else limited = res;
    }
    assert.equal(allowed, 10, "exactly the limit is admitted");
    assert.ok(limited && !limited.ok);
    assert.ok((limited as { retryAfterSec?: number }).retryAfterSec! >= 1);
  });

  it("keys buckets independently per client", () => {
    assert.equal(checkShareCreateRateLimit("198.51.100.99").ok, true);
  });
});

describe("rejectCrossOrigin", () => {
  const req = (headers: Record<string, string>): Request =>
    new Request("https://emu-8086-web.vercel.app/api/share", { headers });

  it("blocks Sec-Fetch-Site: cross-site", () => {
    assert.equal(rejectCrossOrigin(req({ "sec-fetch-site": "cross-site" }))?.status, 403);
  });

  it("blocks a foreign Origin", () => {
    const res = rejectCrossOrigin(req({ origin: "https://evil.test" }));
    assert.equal(res?.status, 403);
  });

  it("allows the site origin and loopback (Electron shell)", () => {
    assert.equal(
      rejectCrossOrigin(req({ origin: "https://emu-8086-web.vercel.app" })),
      null,
    );
    assert.equal(rejectCrossOrigin(req({ origin: "http://127.0.0.1:41234" })), null);
    assert.equal(rejectCrossOrigin(req({ origin: "http://localhost:3000" })), null);
  });

  it("allows same-site fetches and requests without an Origin", () => {
    assert.equal(rejectCrossOrigin(req({ "sec-fetch-site": "same-origin" })), null);
    assert.equal(rejectCrossOrigin(req({})), null);
  });

  it("rejects a malformed Origin rather than throwing", () => {
    assert.equal(rejectCrossOrigin(req({ origin: ":::" }))?.status, 403);
  });
});

describe("rejectOversizedBody", () => {
  it("rejects a Content-Length over the cap", () => {
    const req = new Request("https://x.test/api/share", {
      headers: { "content-length": String(1_000_000) },
    });
    assert.equal(rejectOversizedBody(req)?.status, 413);
  });

  it("allows a normal body and a missing length", () => {
    const ok = new Request("https://x.test/api/share", {
      headers: { "content-length": "1024" },
    });
    assert.equal(rejectOversizedBody(ok), null);
    assert.equal(rejectOversizedBody(new Request("https://x.test/api/share")), null);
  });
});

describe("NextResponse interop", () => {
  it("guards return a real NextResponse", () => {
    const res = rejectCrossOrigin(
      new Request("https://x.test/api/share", { headers: { origin: "https://evil.test" } }),
    );
    assert.ok(res instanceof NextResponse);
  });
});

describe("readJsonBody", () => {
  const jsonReq = (obj: unknown, headers: Record<string, string> = {}) =>
    new Request("https://x.test/api/share", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(obj),
    });

  it("parses a normal body", async () => {
    const res = await readJsonBody(jsonReq({ source: "mov ax, 1", expiresInDays: 3 }));
    assert.equal(res.ok, true);
    assert.deepEqual(res.body, { source: "mov ax, 1", expiresInDays: 3 });
  });

  it("rejects malformed JSON with 400", async () => {
    const req = new Request("https://x.test/api/share", {
      method: "POST",
      body: "{not json",
    });
    const res = await readJsonBody(req);
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.response.status, 400);
  });

  it("rejects a body with no stream", async () => {
    const req = new Request("https://x.test/api/share", { method: "POST" });
    const res = await readJsonBody(req);
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.response.status, 400);
  });

  it("caps the body via Content-Length before reading", async () => {
    const res = await readJsonBody(
      jsonReq({ s: "x" }, { "content-length": String(MAX_BODY_BYTES + 1) }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.response.status, 413);
  });

  it("caps a chunked body with no Content-Length", async () => {
    // The gap a Content-Length-only pre-check leaves open: chunked encoding
    // declares no length, so the cap has to be enforced while reading.
    const payload = JSON.stringify({ source: "x".repeat(MAX_BODY_BYTES + 1024) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const req = new Request("https://x.test/api/share", {
      method: "POST",
      body: stream,
      // Node/undici adds a length for in-memory bodies; strip it to model
      // genuine chunked transfer.
      duplex: "half",
    } as RequestInit);
    const res = await readJsonBody(req);
    assert.equal(res.ok, false, "an over-cap chunked body must be rejected");
    assert.equal(res.ok === false && res.response.status, 413);
  });
});

describe("shared-bucket fairness", () => {
  it("gives unidentified callers a looser limit than an identified one", () => {
    // Unique key so the shared bucket starts clean for this assertion.
    let admitted = 0;
    let limited: { ok: boolean; retryAfterSec?: number } | null = null;
    for (let i = 0; i < SHARE_CREATE_SHARED_RATE_LIMIT + 5; i++) {
      const res = checkShareCreateRateLimit(UNKNOWN_BUCKET);
      if (res.ok) admitted++;
      else limited = res;
    }
    assert.equal(
      admitted,
      SHARE_CREATE_SHARED_RATE_LIMIT,
      "the shared bucket must admit its own ceiling, not the per-IP one",
    );
    assert.ok(limited && !limited.ok);
    assert.ok(SHARE_CREATE_SHARED_RATE_LIMIT > SHARE_CREATE_RATE_LIMIT);
  });

  it("collapses junk client IPs into the shared bucket", () => {
    // "..." and "abc" are shape-invalid now that a digit is required, so they
    // cannot each mint a bucket.
    assert.equal(
      clientIpFromRequest(new Request("https://x.test", { headers: { "x-real-ip": "..." } })),
      UNKNOWN_BUCKET,
    );
    assert.equal(
      clientIpFromRequest(new Request("https://x.test", { headers: { "x-real-ip": "abc" } })),
      UNKNOWN_BUCKET,
    );
    // A digit-bearing literal still resolves, so real clients are not merged.
    assert.equal(
      clientIpFromRequest(new Request("https://x.test", { headers: { "x-real-ip": "abc1" } })),
      "abc1",
    );
  });
});
