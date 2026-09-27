import type { NextConfig } from "next";

const linkHeader = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"',
].join(", ");

/** AdSense is behind NEXT_PUBLIC_ENABLE_ADS, so its origins are allowlisted conditionally. */
const adsEnabled = (() => {
  const raw = process.env.NEXT_PUBLIC_ENABLE_ADS?.trim().toLowerCase();
  return raw === "1" || raw === "true";
})();

const scriptSrc = [
  "'self'",
  // Next injects inline bootstrap/hydration scripts; these hashes are not
  // static because they vary per build, so 'unsafe-inline' is the pragmatic
  // floor here. 'strict-dynamic' lets the trusted bundles load the rest.
  "'unsafe-inline'",
  ...(adsEnabled
    ? [
        "https://pagead2.googlesyndication.com",
        "https://googleads.g.doubleclick.net",
        "https://tpc.googlesyndication.com",
      ]
    : []),
  ...(process.env.VERCEL ? ["https://va.vercel-scripts.com"] : []),
].join(" ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    // No `upgrade-insecure-requests`: it would rewrite every asset to https://
    // on the standalone build, which is served over plain http and is routinely
    // reached on a LAN address. Loopback survives it only because browsers
    // exempt potentially-trustworthy origins, which is too narrow a rescue.
    // Forcing TLS is HSTS's job, and the hosted deployment already sends it.
    value: [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Standalone server output feeds the offline Electron shell
  // (`electron/dist:mac` forks `.next/standalone/server.js`).
  // Vercel continues to deploy from the same build.
  output: "standalone",
  // The Electron dev shell loads the app over loopback (127.0.0.1), which
  // Next treats as cross-origin for dev resources (HMR + client chunks).
  // Without this, hydration stalls and clicks do nothing in `electron:dev`.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "Link", value: linkHeader }, ...securityHeaders],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Signal",
            value: "ai-train=yes, search=yes, ai-input=yes",
          },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
