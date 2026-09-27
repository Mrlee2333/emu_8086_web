# Installation and running emu8086web

Everything needed to get the IDE running, in the browser or as an offline macOS
app, plus what to do when it misbehaves. The [README](../README.md) has the
feature list and the links; this file has the commands.

## Web app (development)

Requires [Bun](https://bun.sh) 1.4+ and Node 20+ for the Next.js toolchain.

```bash
bun install
cp .env.example .env.local   # fill Supabase keys for share links
bun dev
```

Open [http://localhost:3000](http://localhost:3000) — the IDE opens directly, no
landing page.

```bash
bun run build      # production build
bun run start      # serve the production build
bun run verify     # lint + typecheck + test + build
bun run lint       # ESLint
bun run typecheck  # TypeScript
bun test           # Emulator, corpus conformance, offline-helper, ads-flag tests
```

### Environment

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL (sitemap, share links) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (optional for future client use) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** — Share API (never commit / never `NEXT_PUBLIC_`) |
| `NEXT_PUBLIC_ENABLE_ADS` | `1` to show AdSense units, anything else (or unset) hides them. **Default off** — applies to web and desktop builds |

Run the `shared_programs` SQL from the 1.2.0 release notes / plan in the Supabase
SQL editor (RLS on, service role only, hourly cleanup cron). Without it the IDE
runs fine and share links are simply unavailable.

## Desktop (Electron, offline macOS build)

The same codebase ships as an offline macOS app. The packaged app starts its own
bundled Next server on loopback (`127.0.0.1`), so assembling, stepping, running,
and file save/open work with no internet. Short share links stay disabled while
offline (they need the hosted API).

Requires macOS with Xcode command-line tools (`xcode-select --install`) for code
signing utilities. No paid Apple Developer account is needed for local builds;
the DMG is ad-hoc signed (no Developer ID), so a copy downloaded from GitHub
Releases still carries the quarantine flag and needs it cleared once after
install.

### Verifying a downloaded DMG

Releases are **ad-hoc signed and not notarized**, so macOS blocks a freshly
downloaded copy until you clear the quarantine flag. Do these steps once per
download. (v1.4.0 shipped broken and could not be opened at all — steps 5 and 6
are what catch that class of defect.)

```bash
# 1. Confirm the download matches what GitHub published.
#    GitHub shows a sha256 digest on the asset page; compare:
shasum -a 256 ~/Downloads/emu8086web-1.4.2-arm64.dmg

# 2. Mount the DMG and drag emu8086web.app into Applications.
hdiutil attach ~/Downloads/emu8086web-1.4.2-arm64.dmg
#    (drag in Finder, then eject)

# 3. Clear the quarantine flag. Required exactly once after any download.
xattr -dr com.apple.quarantine /Applications/emu8086web.app

# 4. Launch. The IDE window should open within a few seconds.
open /Applications/emu8086web.app
```

Then confirm the install is actually good:

```bash
# 5. The signature seal must verify (silence = healthy).
codesign --verify --deep --strict /Applications/emu8086web.app && echo "signature OK"

# 6. The bundled offline server must exist as a real file.
ls /Applications/emu8086web.app/Contents/Resources/app.asar.unpacked/.next/standalone/server.js

# 7. It must not be spawning copies of itself. Expect a small, steady number
#    (1 app + 1 next-server + 3 Chromium helpers = 5), not a climbing number.
pgrep -f emu8086web | wc -l
```

If step 5 fails, the bundle is unsealed. Repair it in place without
re-downloading:

```bash
codesign --force --deep --sign - /Applications/emu8086web.app
xattr -dr com.apple.quarantine /Applications/emu8086web.app
```

To reproduce the exact CI artifact locally — the no-certificate path that
produced the v1.4.0 defect — build with `bun run electron:dist:mac:ci-sim`. It
skips certificate discovery and then runs the same verification gate CI runs, so
you test what users actually download instead of a differently-signed local
build.

### Easy command

```bash
bun install
bun run dist:mac
```

Open the DMG under `dist/` (e.g. `dist/emu8086web-1.5.0-arm64.dmg`), drag the app
to Applications, and launch it. On Apple silicon this builds `arm64`; on Intel
Macs it builds `x64`.

### Step by step (same thing, explicit)

```bash
bun install                 # install web + Electron dependencies
bun run electron:dev        # live desktop window against `next dev` (development)
bun run electron:build      # web production build + stage the standalone server
bun run electron:dist:mac   # package the DMG for this Mac (calls electron:build first)
bun run electron:dist:mac-all  # DMGs (+ zips for auto-update) for both arm64 and x64
bun run electron:dist:mac:ci-sim  # rebuild with no certificate (matches CI) + verify
bun run verify:mac-bundle   # check the seal + bundled server in dist/
```

### Notes

- Output lands in `dist/` (git-ignored): `.dmg` installer plus a `.zip` for
  direct distribution.
- Every packaged `.app` is sealed at build time (`scripts/after-pack.mjs` ad-hoc
  signs when no Developer ID identity is available, and `bun run
  verify:mac-bundle` fails if `codesign --verify --deep --strict` does not pass or
  the bundled server is missing), so a locally built app is never reported as
  damaged.
- A copy downloaded from GitHub Releases is quarantined by the browser on
  download. After dragging it to Applications, clear the flag once, then
  double-click normally:
  ```bash
  xattr -dr com.apple.quarantine /Applications/emu8086web.app
  ```
  Distributing beyond your own machines without that step needs an Apple
  Developer ID + notarization (not set up in this repo). See
  [Verifying a downloaded DMG](#verifying-a-downloaded-dmg).
- Fonts and Vercel Analytics are inert without internet; the IDE itself is
  unaffected. Ads stay off unless `NEXT_PUBLIC_ENABLE_ADS=1` is set at build time
  (web and desktop alike).
- The web deployment is unchanged — `output: "standalone"` in `next.config.ts`
  also works on Vercel.

### Self-hosting the standalone server

`node .next/standalone/server.js` (or `bun run start` in development) serves the
app over plain HTTP. Two things to know:

- **Terminate TLS in front of it.** A Content-Security-Policy is sent, but
  `upgrade-insecure-requests` is deliberately not: it would rewrite assets to
  `https://` and break a plain-HTTP host, including one reached over a LAN
  address. HSTS is the right place to force TLS, so set it at your proxy.
- **Have the proxy set `X-Real-IP`.** Share-link creation is rate limited per
  client IP, and the app only trusts `X-Real-IP` (`X-Forwarded-For` is
  client-appendable, so honouring it would let any caller mint a fresh bucket
  per request). Without a proxy setting that header, every caller collapses
  into one shared bucket with a looser limit — enough that a single user cannot
  exhaust an install, but real per-client limiting needs the header.

### Desktop menu, updates, and releases

- The app menu carries File (New/Open/Open Folder/Close Folder/Save/Save As),
  Assemble (Compile/Run/Pause/Single Step/Step Back/Reset), standard Edit roles,
  View zoom/reload, Window, and Help (shortcuts, ASCII codes, converter, issue
  tracker, GitHub) — all wired into the IDE.
- Auto-update: the packaged app checks GitHub Releases after launch and offers a
  restart when a newer version is downloaded; “Check for Updates…” lives in the
  app menu. Publishing a release is one tag: `git tag v1.5.0 && git push origin
  v1.5.0` — the `release-desktop` workflow builds arm64 + x64 DMGs and attaches
  them to the release. Until Developer ID signing + notarization are configured,
  macOS installs the update from the downloaded DMG manually.

### Troubleshooting (desktop)

- `“emu8086web.app” is damaged and can’t be opened`: the bundle has no valid
  code signature seal. This was the v1.4.0 release defect (fixed after v1.4.0:
  every build is now sealed and CI verifies it). Repair any affected copy without
  re-downloading:
  ```bash
  codesign --force --deep --sign - /Applications/emu8086web.app
  xattr -dr com.apple.quarantine /Applications/emu8086web.app
  ```
- Multiple app copies keep spawning (fixed after v1.4.0): the old server spawn
  rebooted the packaged app instead of running the server script, recursing until
  the machine fell over. Current builds launch the server with
  `ELECTRON_RUN_AS_NODE=1` and enforce a single instance — a second launch just
  focuses the running window.
- `sandbox_extension_issue_file … Operation not permitted`: dev-only macOS
  sandbox denial. `electron:dev` already passes `--no-sandbox`; packaged builds
  keep the sandbox on.
- Window loads but buttons do nothing: stale dev server or blocked dev
  resources. Stop everything, rerun `bun run electron:dev`, and wait for “Ready”
  in the terminal before clicking. (`allowedDevOrigins` already covers the
  loopback host.)
- For exam-day confidence, test the packaged artifact itself (`bun run dist:mac`
  → install the DMG), not just the dev window — dev-only issues above do not
  apply to it.

## See also

- [Engine reference](emulator.md) — the instruction and interrupt matrix
- [Corpus coverage](corpus-coverage.md) — how the emulator is measured
- [Thanks](thanks.md) — the projects this one leans on
- [Contributing](../CONTRIBUTING.md)
