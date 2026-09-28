/**
 * The three typefaces, vendored (v1.5.2).
 *
 * These were `next/font/google`, which fetches from fonts.googleapis.com at
 * build time. That put a network call on the release path: a transient Google
 * Fonts failure failed the build *after* the tag and the GitHub Release
 * already existed, which is the one state a release cannot be recovered from
 * without moving a published tag. The files now live in `app/fonts` and
 * `next/font/local` hashes them into `.next/static` like any other asset, so
 * the build is offline and the desktop package already carries them.
 *
 * The files are the exact woff2 the Google CSS served, so rendering is
 * unchanged. IBM Plex Sans is a variable font and covers 400-700 in one file;
 * Plex Mono is served as four static weights, and VT323 has the one weight it
 * ever had.
 *
 * `lib/fonts.test.ts` fails if a `next/font/google` import comes back.
 */

import localFont from "next/font/local";

export const IBM_Plex_Sans = localFont({
  variable: "--font-plex-sans",
  display: "swap",
  src: "./../app/fonts/IBMPlexSans-Variable.woff2",
  weight: "400 700",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const IBM_Plex_Mono = localFont({
  variable: "--font-plex-mono",
  display: "swap",
  src: [
    {
      path: "./../app/fonts/IBMPlexMono-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./../app/fonts/IBMPlexMono-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./../app/fonts/IBMPlexMono-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./../app/fonts/IBMPlexMono-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

export const VT323 = localFont({
  variable: "--font-vt323",
  display: "swap",
  src: "./../app/fonts/VT323-Regular.woff2",
  weight: "400",
  fallback: ["ui-monospace", "monospace"],
});
