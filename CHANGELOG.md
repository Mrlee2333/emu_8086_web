# Changelog

All notable changes to emu8086web are documented in this file.

## [1.5.2] — 2026-09-28

> Ships after 1.5.1 (the register Details view, PR #14), on top of it.

The macOS app lost its settings and its updater did nothing. Both were reported
together; they turned out to be two separate bugs, and one of them was hiding
the other.

### Fixed

- **The desktop app forgot every setting on restart.** The theme, the accent colour, the tab size, the UI scale, your open files, your open tabs, the watch list and the keyboard shortcuts all came back as if you had never set them. The cause was the port, not the settings: the packaged app started its bundled server on a random port each launch, and `localStorage` is keyed by origin — scheme, host **and port** — so every launch was a new origin with an empty store. The opened folder was the one thing that survived, because the main process writes it to `userData` itself; that asymmetry is what gave the bug away. Two fixes, belt and braces: the port is pinned to a small stable set (with the ephemeral port as a last resort), and the scalar preferences are mirrored to `userData` so they survive even that fallback. An update restart was a second deterministic trigger for the same bug, and is fixed by the same change
- **“Install now” did nothing.** The click worked — it called `quitAndInstall()`, Squirrel launched its installer helper, and the helper exited without installing. On macOS an in-place update is refused when the running app and the update are signed with different identities: the installed build was signed with an Apple Development certificate and the published builds are ad-hoc, because CI sets `CSC_IDENTITY_AUTO_DISCOVERY: false` with no Developer ID configured. The updater's `error` handler was empty, so the failure was invisible — which is why it looked like a dead button. The app now reads its own signature and, when it cannot replace itself in place, offers the download instead of an install that cannot work
- **Update failures were discarded.** The `error` handler was an empty function and the check promise was `.catch(() => {})`, so every failure — including a GitHub rate limit on a shared network — was silent. Errors are now logged, and shown when the user asked for the check
- **“Later” did not mean later.** `autoInstallOnAppQuit` was left at its default of `true`, so declining the prompt still installed the update on the next normal quit. It is off now, and nothing is installed without the user choosing to
- **The update prompt came back on every launch.** The check ran unconditionally 15 seconds after every start, with no way to turn it off and nothing remembered about the previous answer
- **Switching theme discarded the accent colour.** The settings modal read its stored accent in an effect that depended on the theme, so pressing Dark or Light reset the swatch the instant it changed, throwing away a colour you had chosen
- **Saving did not close the dialog**, leaving no confirmation that the settings had been applied — the only way to tell was the transient “Settings saved.” line

### Added

- **An Automatic updates setting**, in Settings, on the desktop app only. Off means the app never checks on its own; Help → Check for updates still works. The preference has to reach the main process, which cannot read `localStorage`, so it crosses the new settings bridge
- **A vendored typeface build.** IBM Plex Sans, IBM Plex Mono and VT323 are now files in the repository rather than a `next/font/google` fetch. That call was a single point of failure on the release path: a transient Google Fonts failure failed the build *after* the tag and the GitHub Release already existed, which is the one state a release cannot be recovered from without moving a published tag. The files are the exact woff2 the Google CSS served, so rendering is unchanged, and the build now passes with the network blocked

### Known limitation

In-place updates on macOS need a Developer ID signature and notarization, which are not configured for these builds. Until they are, the app offers the download. Nothing is broken by this — it is a packaging credential, not a code path.

### Review findings

A review round found seven problems, three of them blocking. All of them were in code that had been *verified not to run* — the reviewer's point that the download fallback, the signature probe and the update prompt were "all unreachable on packaged macOS" was correct, and the tests I had written for them were passing against logic that could never execute.

- **The signature probe never ran.** It called `app.getPath("appPath")`, which is not a valid path name — Electron throws `Failed to get 'appPath' path` for it. The promise resolved to `null` on every launch, so the app never learned it was un-signed and never offered the download. The bundle is now derived from `resourcesPath` instead, which is verified against a real signed `.app`
- **The "Download the update" button was dead.** It tested `response === 2` against a dialog whose two buttons are indexed 0 and 1, so the one index the dialog can never return was the only one handled. The choice is now resolved by matching the button's *label*, which cannot drift when a button is added, removed or reordered
- **A failed manual update check showed its error dialog twice**, because `checkForUpdates` both emits an `error` event and rejects its promise and both paths reported it
- **A Development-signed build was allowed to "Restart now"**, but its identity is not the one the release pipeline publishes, so Squirrel would refuse it exactly as it refused an ad-hoc one. The bar is now a **Developer ID Application** signature specifically
- **The empty-string skip in the settings mirror was tested with a literal key**, so the real key never carried an empty value and the skip never ran. The test now computes the key, and a second test asserts a real value *is* restored, so "returns nothing" can no longer pass by skipping everything
- **The font guard missed a dynamic `import()`**, which a bundler resolves statically and so would fetch at build time just the same

Also removed: `installBlocked` took an `appPath` it never read, and the dead `UPDATE_BTN_RESTART` / `UPDATE_BTN_DOWNLOAD` constants that were the button bug.

### Second review round

Nine more findings, and the first was the same class of error as the last round's worst: a test that proved the rule while the rule was never reached.

- **The signature check was inverted, not broken.** `codesign -dv` prints **no `Authority=` line at all** — the first `-v` is consumed as `--verify`, so `-dv` is verbosity zero. Measured on real bundles: `-d` and `-dv` print 0 authority lines, `-dvvv` prints 3. So every build looked ad-hoc, and the app would have blocked the install even on a correctly Developer-ID-signed one. The call now uses `-dvvv`, ad-hoc is detected from `Signature=adhoc` *and* the `flags=0x…(adhoc,…)` bit, and the verbosity lives in an exported constant because a test that only checks what `codesign` prints passes whatever the caller asked for
- **The test fixtures were invented.** The old ones were labelled as real `codesign` output but contained `Authority=` lines the command cannot emit at that verbosity. They are now captured from two real bundles, and a new test shells out to the real binary and asserts the verbosity the app uses is one that prints the chain
- **The app told the user a lie.** `checkForUpdatesAndNotify` raises a macOS notification saying the update "will be automatically installed on exit" — which `autoInstallOnAppQuit = false` now prevents. The background check is a plain check, and the prompt is the only thing that speaks
- **The background check could fire during quit.** The 15 s timer had no handle and no quit guard, so quitting at 10 s still started a network check and possibly a full download on a dying process. It is now cancelled on `before-quit`
- **A corrupt settings file silently re-enabled updates** for a user who had turned them off, because a non-atomic `writeFileSync` can leave truncated JSON and a failed parse reads as "never chosen". The write is now a temp file plus a rename
- **Switching theme then saving stored the wrong theme's default accent.** Removing the theme dependency had fixed the opposite bug, so a fresh profile that chose Light saved the *dark* default into a light theme. A chosen accent and a defaulted one are now tracked apart
- **Automatic updates ignored Cancel**, being the one control in the dialog that applied instantly. It is staged like the rest
- **An ephemeral fallback port was silent.** All four pinned ports being busy reintroduces the original bug with no signal; the app now says so on stderr, using a helper that was previously exported but never called
- **The signature probe raced the first update check**, so an update landing in the first second could offer the dead Restart button. The handler now waits for the probe

Also: the hand-rolled `path.resolve` in `bundlePathFrom` was quietly wrong for drive-letter input and is now `node:path`; the README version is current; and this branch is **rebased onto v1.5.1** rather than onto `main`, which removes the four-way version and changelog conflict outright.

### Tests

66 new in total, on top of v1.5.1. The ones that matter most:

- **The renderer and the main process read the same setting identically.** They each carry their own copy of the truthy-value list, because they are separate processes and the main process cannot import TypeScript. A disagreement would mean the settings dialog says “off” while the updater is still on. A table-driven test asserts the two agree on fourteen inputs
- **Nothing in the updater is verified only against a mock.** The bundle path, the signature parse and the button choice are exercised against a real ad-hoc-signed `.app` built by `electron-builder`, and against real `codesign -dvvv` output read from it
- **The ephemeral port is last, always**, and a guard that a reintroduced `next/font/google` import is caught by the very rule that checks for it — a test that cannot fail is decoration

## [1.5.1] — 2026-09-28

### Added

- **Register Details view** — the CPU registers panel header now has a Details button that opens the original emu8086 register view: one row per register, with the high byte and low byte in their own columns. `AH`/`AL`, `BH`/`BL`, `CH`/`CL` and `DH`/`DL` are visible at a glance, and a register with no halves (SI, DI, BP, SP, the segments and IP) shows a dash rather than an invented zero
- **A per-register `i` button** — explains what the 8086 uses that register for, without a word of it on screen until asked
- **Click a value to see it another way** — the same word in binary, unsigned decimal and signed decimal, with both halves broken out and a printable character noted where the byte is one
- **Implied operands are named** — the Details dialog says which registers the next instruction touches without its operands saying so, so `MOVSB`'s use of SI, DI and CX stops being invisible

The panel itself is unchanged in shape and still hex-only: the value a program is written in is all that is on screen until a register is asked about.

### Correctness

- 30 new tests. The load-bearing ones do not check the byte split against a hand-written expectation — they check it against the emulator's own `get8` after running `MUL`, `DIV`, `XLAT`, `AAM` and `AAD`, which are the instructions that leave AX or DX holding a value whose two bytes mean different things. A test that only set `ax = 0x1234` and expected `BE`/`34` would still pass if the halves were swapped at the source; these would not
- Two of those tests failed on the branch and the tests were wrong, not the code: `AAD` computes `AH × 10 + AL`, not `AH + AL`, and `0x0741` puts `0x41` in AL rather than AH. Both expectations were corrected against the emulator's own behaviour

### Changed

- **The IP cell shows the real instruction pointer when the program has halted.** It used to read `0x0000` in that state, which looks like the program had restarted. It now shows where execution actually stopped

### Review findings

Fixed after a review pass. Each was reproduced against the branch first, and each correction is now held by a test that runs the emulator rather than trusting the sentence.

- **A byte's binary was grouped in twos, not fours** — `AH` read `00 10 00 11` instead of `0001 0011`, which looks like four separate values rather than one eight-bit one. The 16-bit grouping was always correct, so no existing test could have caught it
- **CX was described as the high half of `DX:AX`** — it is DX. CX is the count that `LOOP` and `REP` drive and the shift count in a form like `SHL AX, CL`. A test now asserts that word `MUL` leaves CX untouched
- **`CBW` and `CWD` were described as touching registers they do not** — `CBW` sign-extends `AL` into `AX` and writes nothing to `DX`; only `CWD` fills `DX`; and neither touches `CX`. A test runs both and checks all three registers
- **Every string-instruction note claimed it decrements CX** — it only does under `REP`. A plain `MOVSB` leaves CX alone, and a test now runs both forms to prove the difference
- **BX was described as the implicit base of the string instructions** — they move through SI and DI. BX's real implicit use is the table index `XLAT` reads through as `[BX + AL]`, and a test asserts a string op leaves BX untouched
- **"only IRET restores the instruction pointer" was false** — `RET` pops the same target. A `CALL`/`RET` test proves the program returns and ends rather than falling through
- **`AAD` was described as a packed-BCD instruction** — it combines an unpacked tens-and-ones pair, and is the inverse of `AAM`. Packed BCD is what `DAA` and `DAS` adjust
- **`LES` and `LDS` were described as reading `[SI]`** — `[SI]` is the textbook operand, not a requirement; both accept any memory operand, and a test runs `LES SI, [BX]`
- **The Details dialog listed the segments in a different order from the panel.** Both now read one order, the one the panel has always used, and a test pins it
- A test message said "AAD folded AH\*10 + AH's remainder into AL"; it is AH × 10 + AL

### Second review round

Another pass over the same sentences found four more that were wrong, plus the highest-impact defect of the release: the panel was dropping the `REP` prefix.

- **The `REP` prefix was dropped and the note then contradicted it.** `Next: MOVSB — … once — CX only moves under REP` was shown for a `REP MOVSB` about to run five times, and for `REPE`/`REPNE` the rule that stops them early was never mentioned at all. The prefix is now shown and the note describes the prefixed behaviour
- **`IMUL` was described as writing to `DX:AX`**, which only the one-operand form does; the two- and three-operand forms this emulator implements write to the first operand
- **AX was called "the destination of most arithmetic"** — every arithmetic and logic instruction here writes to its first operand, so AX moves only where the program names it
- **CS was described as the segment `PUSH`, `CALL` and the interrupts take from**, but nothing here writes CS: `PUSH` stores two bytes with no segment, and `INT` pushes nothing
- **IP was described as replaced by an interrupt**; in this flat model `INT` runs its service and carries on at the next instruction
- **`XLATB`, `LOOPE` and `LOOPNE` had no note** and fell through to a sentence claiming their operands named everything they touch. MASM programs are as likely to use those spellings as the short ones
- **The panel showed `SP` as 0 before the first compile**, then jumped to `0xFFFE`, which is what a real machine starts at
- **The panel and the dialog did not share a register order.** A comment claimed they did; each held its own literals, which is how they came to disagree once already. The orders are exported and the panel maps them
- **Two tests proved less than their names claimed.** "LOOP's counter is CX" ran `dec cx`, and the `RET` test asserted only `err === null && halted === true`, which also holds when `RET` jumps to a garbage address. Both now check the actual return address and counter

## [1.5.0] — 2026-09-28

### Fixed

Found by running 525 programs from [Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS](https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS) and comparing the console output against the output that repository recorded. Matching programs went from 133 to 461.

- **`CALL` did not push the return address** — the return lived only in an internal list, so a `PUSH BP` / `MOV BP, SP` frame read the caller's argument where the return address should be. Every program that passed arguments on the stack, measured its stack, or recursed computed the wrong answer: 7 factorial came out as 1. `CALL` now writes the return address to the memory stack and `RET` reads it back, so `[BP+4]` is the first argument, and `RET n` removes the arguments the caller left. Recursion went from 0 of 12 corpus programs to 12 of 12
- **Shift and rotate lost the carry** — `SHL`, `SHR` and `SAR` set `CF` and then called the flag helper that clears it, so the bit that left was always zero. A multiword `RCR` shift halved nothing, and any program that saved a carry with `PUSHF` read back zero
- **`SHL` never set overflow** — it is the one shift that is a signed operation, and the flag was left as the addition had it
- **A shift count of a whole operand width moved bits** — `SHL AX, 16` was folded back on itself and left the word untouched. A shift now runs the width out: `SHL AX, 16` leaves zero with the carry holding bit 0, and `SAR` fills with the sign. A rotate still comes full circle, and `RCL` / `RCR` count in nine steps for a byte or seventeen for a word
- **`IMUL` multiplied 16-bit values for a byte operand**, so signed byte arithmetic came out unsigned, and the two- and three-operand forms did not exist
- **`LAHF` loaded the flags into `AL`** instead of `AH`, and `PUSHF` left bits 12 to 15 clear, which the 8086 reads as one
- **`DAA` and `DAS` cleared the carry they had just produced**, so packed BCD addition lost the carry into the next byte
- **A negative displacement in brackets was ignored** — `[DI-2]` read `[DI]`, which broke insertion sort, gnome sort and a dozen other programs
- **A bare label with a displacement was not an operand** — `SEEN+2` and `WORD PTR COUNT` were rejected
- **The polling services never set the zero flag** — `INT 21h AH=06h` and `INT 16h AH=01h` say "nothing waiting" with `ZF`, and without it a program cannot tell an empty queue from a full one
- **`LEA` of a label plus a constant was rejected** — `LEA SI, BUFFER + 2` addresses a label and an offset, which is a value
- **Octal numbers and `NOT` in an operand were not read** — `101Q` and `AND AL, NOT 00000100B`
- **`NOT` matched the first three letters of any name** — a constant called `NOTHING` was read as `NOT HING` and evaluated to nothing, and the DUP fill silently became zero
- **A symbol spelled like a number was read as one** — `EACH EQU 4` came out as 0xEAC, because every letter in `EACH` is a hex digit and the last is the `H` suffix. A name that is defined now wins over a number, in operands, in data values and inside expressions
- **`#`-comments, `.FARDATA` and a `db` continued with `dw` are still rejected**; the first two are that corpus's own syntax

### Review findings

Nine more defects, found reviewing this work with each claim reproduced against the branch. They are here because a third-party corpus is not the only way an engine gets tested.

- **`RCL` and `RCR` used the byte's cycle on a word** — a rotate through carry turns the value plus the carry, so the cycle is nine steps for a byte and seventeen for a word, and a nine-step word rotate is not a whole turn
- **A shift of one whole width did nothing** — `SHL AX, 16` leaves the word at zero with the carry holding the last bit to leave; only a rotate comes full circle
- **`IRET` popped only the call-stack mirror** — `INT` pushes nothing here, so an `IRET` reads the memory stack the way `RET` does, and `CALL` → `INT` → `IRET` no longer leaves the mirror and `SP` disagreeing
- **`RET n` ignored a constant** — `RET TWO` with `TWO EQU 2` behaved as `RET` and left the caller's arguments on the stack
- **`CALL` moved the stack before resolving its destination** — a call to a bad label no longer leaves half a frame behind for Step Back to restore
- **The polling services ate the key they reported** — `INT 16h AH=01h` is a check, not a read, so a program that polls before reading no longer loses the first character
- **`AH=3Bh` was treated as an open** — it is `CHDIR`; `AH=3Dh` is the open, and its access mode is bits 1 to 0 of `AL`, so `AL=10h` (compatibility sharing) opens for reading as the bits say
- **The pixel and palette services halted the program** — `INT 10h AH=0Ch`, `0Dh` and `10h` are graphics-only and are now accepted and ignored, so a plotting program finishes and says what it plotted
- **A constant expression could not fail** — `5 / 0` folded to zero, and an undefined name with parentheses evaluated to its argument, so a misspelt `LENGTH` looked like a number

### Added

- **Constant expressions and `EQU`** — `NAME EQU value`, the older `NAME = value`, arithmetic over constants, `$ - LABEL` to measure a block, constants as `DUP` counts and inside operands, `not` / `~`, and octal. This alone accounts for 293 of the programs the first run could not assemble
- **Code in the data segment, and data in the code segment** — a dispatch table may name code labels (`HANDLERS DW ADD_IT, SUB_IT`), and `db` / `dw` are accepted inside `.code`, which is how a COM program keeps its data beside its code
- **Indirect `JMP` and `CALL`** — through a register or a memory word, so `JMP [HANDLERS + BX]` indexes a table
- **`ORG`**, and a bare `SEG label` or `DATA` in the flat model
- **An in-memory DOS file system** — `INT 21h` AH=36h, 39h, 3Bh, 3Ch, 3Dh, 3Eh, 3Fh, 40h, 41h, 42h and 4Bh, with the DOS error convention of carry set and the reason in `AX`, 8.3 names, a handle and a cursor per open, and a read-only open that refuses a write. Handles count up from 5 and wrap into a free slot rather than growing without bound, and what runs out is open handles rather than the number of names a session has seen. Nothing reaches the host: the emulator has no filesystem of its own
- **A port latch** — `OUT` then `IN` on the same port returns what was written, byte or word, which is what a teaching program needs to follow a transfer
- **More BIOS services** — `INT 10h` 02h/03h cursor, 0Fh read the mode and cursor, 1Ah; `INT 16h` 02h/12h shift state; `INT 1Ah` tick counter; `INT 15h` 86h/88h; and `INT 03h` as a breakpoint that carries on
- **A conformance suite** — `lib/emulator/corpus/` holds 136 programs across 38 topics, copied from that MIT-licensed corpus, and `corpus.test.ts` runs each to completion and compares the output with the output recorded upstream. It runs in about 0.2 s inside `bun test`, and fails if a fixture has no recorded output or a topic folder is emptied
- **`scripts/conformance-report.ts`** — measures the whole 525-program corpus, grouped by topic and by why a program failed
- **`lib/emulator/extended-syntax.test.ts` and `lib/emulator/dos-services.test.ts`** — 39 tests that name each behaviour the corpus exercised, in small pieces
- **`scripts/corpus-fixtures.ts`** — refreshes the fixtures and their expected output from a checkout of the corpus
- `docs/corpus-coverage.md` — the measured result, the differences that cannot be fixed, and the defects the run found

## [1.4.2] — 2026-09-28

### Security

- **Dependencies: 2 critical + 8 high advisories cleared** — Next was pinned at 16.2.10, inside the advisory ranges for unauthenticated RCE on Windows-hosted servers, RCE in the Image Optimization API (reachable at `/_next/image`), a middleware/proxy bypass under Turbopack, and response-body cache confusion affecting `POST /api/share`. Upgraded to 16.3.6; `bun audit` is clean across 640 packages, and CI now runs `bun audit --audit-level=high` so this cannot regress silently
- **Share rate limiting trusted a client-supplied header** — `clientIpFromRequest` read the first `x-forwarded-for` hop, which any caller can set. On the self-hosted standalone build that header is entirely attacker-controlled, so the only abuse control on an unauthenticated write endpoint could be bypassed with one forged request. The IP now comes from a platform-set header only (`x-vercel-forwarded-for` on Vercel, `x-real-ip` otherwise) and is shape-validated, falling back to a shared bucket. The bucket map is also swept periodically and hard-capped, so it can no longer grow for the life of the process
- **`POST /api/share` accepted cross-origin writes** — `Request.json()` parses a body regardless of the declared content type, so a form-free `fetch` from any page is a CORS-simple request: no preflight, the row is written, the attacker just cannot read the reply. Enough to fill `shared_programs`. The endpoint now rejects `Sec-Fetch-Site: cross-site` and any foreign `Origin`, and rejects an oversized `Content-Length` *before* buffering the body
- **Content-Security-Policy and standard security headers** — `next.config.ts` emitted only `Link` and `Content-Signal`, so the standalone/Electron server ran with no CSP, no `nosniff`, and no framing protection. Added a CSP with `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` and `Permissions-Policy`. AdSense origins are allowlisted only when ads are enabled
- **`upgrade-insecure-requests` deliberately left out of that CSP** — it emits only off Vercel, which is exactly the standalone/Electron case, and it would rewrite every asset to `https://` on a plain-HTTP self-hosted deployment. Loopback survives it only because browsers exempt potentially-trustworthy origins, so a LAN address would have served a blank page. Forcing TLS is HSTS's job, and the hosted deployment already sends it
- **Electron: top-level navigation was unconfined** — the preload bridge exposes folder read/write/delete and is attached to the top frame regardless of origin. `will-navigate`, `will-redirect` and `will-attach-webview` now prevent off-origin navigation, window-open is pinned to the actual server port instead of any localhost port, and all permission requests are denied. IPC handlers additionally verify the calling frame's origin
- **Electron: dangling-symlink write escape** — `resolveInside` falls back to the unresolved path when `realpath` throws, which is exactly the dangling-symlink case. A folder containing `evil.asm -> /tmp/out/pwn.asm` with a missing leaf passed the confinement check and the write followed the link out of the opened folder. Write, create and rename destinations now reject symlinked targets and re-check the parent directory — which also closes a symlinked *parent* directory that the read guard could not see
- The confinement logic moved from `electron/main.js` into `electron/folder-resolve.js`, because a file that imports `electron` cannot be unit-tested. `main.js` keeps thin wrappers, and `electron/folder-resolve.test.ts` covers the escape along with the normal save/create/rename paths. Reverting the guard to its previous form makes exactly those tests fail
- **GitHub Actions script injection** — `package.json`'s version was interpolated straight into `run:` blocks via `${{ }}`, which expands before bash parses. A value like `1.5.0$(id)` would execute in a job holding `contents: write` **and** `actions: write`, and a PR that only bumps the version passes review cleanly. The version is now passed through `env:` and validated against a semver regex
- **Desktop release ignored the lockfile** — `release-desktop.yml`, the job that produces the shipped auto-updating binary, ran plain `bun install`, so a `^` range could resolve to code that was never reviewed. Now `--frozen-lockfile`
### Follow-up from PR review

Addressed findings from the automated review; all five were valid and none were
declined.

- **The request body cap is now enforced while reading, not only from `Content-Length`** — chunked transfer encoding declares no length, so the header pre-check never fired and `req.json()` buffered the entire body first. `readJsonBody` counts bytes as they arrive and stops at the cap, so a 300 KB chunked upload with no `Content-Length` is refused with 413 instead of being parsed. Verified end to end: the same request is accepted by `req.json()`
- **An unidentified caller no longer consumes the per-IP quota** — on a standalone deployment where no proxy sets `X-Real-IP`, every client resolved to the same key, so the first ten share links in an hour exhausted creation for the whole install. Unidentified callers now draw on a separate, higher ceiling, and the README documents the `X-Real-IP` requirement
- **AdSense needed more than `script-src`** — display units are served as an `<iframe>` that `components/ads/adsense-unit.tsx` waits for before reporting a slot as filled. With only `script-src` allowlisted those frames fell back to `default-src 'self'`, so every ad slot would have rendered empty (with CSP console errors) whenever `NEXT_PUBLIC_ENABLE_ADS=1`. `frame-src`, `img-src` and `connect-src` are now extended conditionally as well; the ads-off build keeps the tighter default
- **A hidden tab could start two concurrent run loops** — the resume path after console input checked only the rAF handle, but a hidden tab drives the loop off a timer, so the rAF handle is null while a tick is already queued and a second loop could be scheduled
- The client-IP shape check now requires at least one digit, so `...` or `abc` collapse into the shared bucket instead of each minting a bucket of its own
- README: a **Self-hosting the standalone server** section covering TLS termination and the `X-Real-IP` requirement

- Smaller: shared-program responses carry `Cache-Control: no-store`; the JSON-LD block escapes `<` so a config value cannot close the script tag; share codes are rejection-sampled instead of folded with `% 36`, which biased the first four characters

### Fixed

- **The Speed slider did nothing until Run was pressed again** — the run loop was a `setInterval(runBatch, runSpeed)`, and an interval captures its delay when it is created. Changing the speed while running updated state that the already-scheduled loop never read. The loop now reads the current speed every tick, so the slider applies live
- **Step Back filled 32 MiB in about eight seconds of running** — the loop captured a full 64 KiB memory snapshot on every timer tick, and 512 snapshots were retained. Checkpoints during a run are now rate-limited to one per 250 ms, which preserves the "undo a Run burst" contract at a fraction of the memory
- **Runaway `push`/`call` loops retained unbounded memory** — the shadow stacks used by the stack panels were never capped, and every snapshot copied both arrays, so a program looping `push ax` could retain hundreds of megabytes across the history. `dataStack` is now capped (oldest entries dropped, since `SP` and memory are the source of truth) and `callStack` halts with a real "recursion too deep" error rather than silently discarding a return address
- **A backgrounded tab could leave the IDE showing "running" while frozen** — `requestAnimationFrame` is not called at all in a hidden document. The run loop falls back to a timer while hidden and resyncs its timing on return

### Changed

- **The run loop is driven by `requestAnimationFrame` with a time accumulator**, retiring however many instructions the elapsed time owes and rendering at most once per frame. Previously each timer callback both executed instructions and forced a full-IDE render in the same task. Note that the speed control now means what its label says — `runSpeed` milliseconds per instruction — where the old loop ran up to 200 instructions per tick regardless of the setting
- The console panel's text is memoized behind a version counter. `machine.output` re-joined up to 2,000 console lines on every render, roughly 160 KB of string allocation per tick whether or not anything was printed
- The workspace is no longer serialized and written to `localStorage` on every keystroke; the write is debounced and flushed on `pagehide`. The editor's syntax-highlight overlay and gutter rows are memoized, so a step no longer reconciles several thousand editor nodes. `qrcode` is dynamically imported (it is only needed by the Share dialog), and the first-load JS for `/` dropped from 743,962 B to 668,076 B
- `AUTOSAVE_KEY` wrote the full source to `localStorage` on every edit but was never read by anything. Removed

### Added

- `lib/share/share.test.ts` — coverage for share-code generation, the rate limiter, the IP trust boundary and the request guards; this layer previously had none
- `bun run bundle:budget` — Next already emits per-route first-load byte counts to `.next/diagnostics/route-bundle-stats.json` and nothing asserted on them, so a dependency or a static import could add tens of kilobytes to every visitor unnoticed. `verify` and CI now gate on it
- Memory search counts matches and finds the next hit in a single pass. `countMatches` called `findNextMatch` once per match, so counting a common byte over the 64 KiB space cost up to ~65 million comparisons for one click

## [1.4.1] — 2026-09-26

### Fixed

- **macOS: “emu8086web.app is damaged and can’t be opened”** — release builds shipped an unsealed bundle. CI signs with `CSC_IDENTITY_AUTO_DISCOVERY=false`, which made electron-builder skip signing entirely, so no `Contents/_CodeSignature` was written while the nested Electron binaries still expected sealed resources. macOS reported `code has no resources but signature indicates they must be present` and refused to launch
- **macOS: infinite instance spawning that froze the machine** — the main process started the bundled server with `spawn(process.execPath, [serverFile])`. A packaged Electron binary does not take a script argument as an entry point, so each spawn booted *another copy of the app*, whose main process spawned another, recursing without bound. The server never actually ran, so no window ever opened
- **Desktop: bundled server was unreachable** — `.next/standalone` was packed inside `app.asar`, but the main process looked for it at `Contents/Resources/.next/standalone/server.js` and launches it with `spawn`, which cannot read inside an archive. The tree is now unpacked (`asarUnpack`) and the resolver points at the real path, so the app boots its offline server
- Opening a second copy (e.g. the `/Applications` and `dist/` builds, or a double-click storm) no longer starts another app + server: a single-instance lock focuses the running window

### Added

- `scripts/after-pack.mjs` seals every packaged `.app` ad-hoc when no Developer ID identity is available, and is a no-op once real signing credentials are configured
- `bun run verify:mac-bundle` — the release gate as a local command: fails unless `codesign --verify --deep --strict` passes, the `CodeResources` seal exists, and the bundled server is present on disk. `release-desktop.yml` runs this exact script, so the two cannot drift
- `bun run electron:dist:mac:ci-sim` — rebuilds with certificate discovery disabled (the CI path that produced the v1.4.0 defect) and then verifies it, so the artifact you test locally matches the one users download
- README: a **Verifying a downloaded DMG** section with numbered install, quarantine-clearing, and post-install health-check steps

### Changed

- `ELECTRON_RUN_AS_NODE=1` is now set for the bundled server child (`buildServerChildEnv` in `lib/electron/offline.ts`, with `node:test` coverage), which is what makes the packaged binary execute the server as a script
- Electron 44.4.5, @supabase/supabase-js 2.117.2

### Known — required after download

Installers are ad-hoc signed and **not notarized**, so macOS blocks a freshly downloaded copy. After dragging the app to Applications, run this once:

```bash
xattr -dr com.apple.quarantine /Applications/emu8086web.app
```

Then launch normally. The fix above resolves the *seal* defect that made v1.4.0 unlaunchable; this step resolves the separate quarantine block, which only Developer ID signing + notarization can remove permanently. Full steps, including post-install health checks (`codesign --verify`, bundled-server presence, process-count check), are in the README under **Verifying a downloaded DMG**.

## [1.4.0] — 2026-09-23

### Added

- Folder workspace (VS Code-like Explorer): open any folder and browse `.asm` / `.txt` / `.inc` in a tree; create, rename, and delete files + subfolders
  - Electron desktop: scoped IPC (`open-folder`, `list`, `read`, `write`, `create`, `rename`, `delete`) confined to the picked root, 256 KiB file cap, 2000-entry list cap; native File → Open Folder… / Close Folder menu
  - Web: File System Access picker (`showDirectoryPicker`) on Chromium with the same caps; graceful guidance elsewhere
  - Collapsible left sidebar with Hide/Show Explorer toggle (persisted in localStorage, keyboard-accessible)
  - Folder-backed tabs: opening a tree file creates a tab; Ctrl+S writes back to disk, other files keep the download flow
  - Pure tree model (`lib/ide/workspace-folders.ts`) + path guards (`lib/electron/folder-security.ts`) with `node:test` suites
- 8086 editor basics from the original Windows emu8086:
  - Syntax highlighting overlay (registers, mnemonics, directives, labels, numbers, strings, `;` comments) in both themes; textarea stays the edit source
  - ALU panel in the CPU column: describes the next instruction and its affected flags (e.g. `ADD AX, 1 — updates CF PF AF ZF SF OF`)

### Security

- Folder IPC validates every relPath (no traversal, absolute, drive-letter, or control-char paths) and resolves inside the opened root before any fs call

### Fixed

- Replaced `window.prompt()` / `window.confirm()` with in-app dialogs — `prompt()` throws in Electron, which crashed New file/folder, rename, delete, and Save-as flows
- Browsers without a disk folder now get an Overleaf-like virtual project in the Explorer (create/rename/delete multiple files, export all) instead of an empty panel
- Tabs behave like VS Code: closing a tab keeps the project file (open tabs persist across reloads); only the Explorer trash deletes from the project
- Electron opens filesystem-first (Open-folder welcome state, last folder restored) instead of the virtual project
- Explorer icon buttons show instant hover tooltips; Hide Explorer lives in the panel header with an icon-only rail to reopen
- Empty folders stay folders (were misbuilt as files, blocking file creation inside); folder icons show open/closed state
- CPU column panels (registers, flags, ALU, status, watch, data, memory, stacks) collapse via header chevrons
- Project export is a single `emu8086-project.zip` (dependency-free writer) instead of per-file downloads
- Toolbar stays on one line on small screens (icon-only buttons in a scroll strip); tree-row icon buttons show side-positioned tooltips that can't clip
- Hardened folder IPC: main-process root trust, dotfile/extension policy on mutations, symlink refusal, strict type checks, no-overwrite create/rename
- Fixed web folder rename dropping children, sample wipes, stale saves, blank editor past 5000 lines, ALU flag tables (incl. BCD), tokenizer `0x`/segment cases
- Closed residual gaps: delete limited to source files (dirs still deletable), no-merge web renames, persisted panel prefs, BCD highlighting, symlink/refusal guards

## [1.3.2] — 2026-09-23

### Added

- Watch panel (right column): pin expressions like `ax`, `count`, `[si]`, `byte ptr [bx]` — hex + decimal + signed values update live while stepping / stepping back; list persists in localStorage
- Memory dump: find bytes by hex (`48 65`, `0x48`) or text (`Hi`, `'Hi'`) with match count, Find / Next with wrap-around; Goto address accepts `1A2Bh`, `0x1A2B`, or decimal

### Fixed

- Open-file size cap (256 KiB per file): oversized files are skipped with a notice instead of freezing assemble
- Filename sanitization at the single choke point (`ensureAsmExtension`): path separators, `..`, null bytes, and control chars stripped; over-long names truncated; Unicode preserved
- Console output capped at the newest 2000 lines so runaway print loops (up to the 2M instruction limit) can't grow memory or freeze rendering
- Help hover no longer dismisses an open help dialog; click still navigates back to the menu

## [1.3.1] — 2026-09-23

### Added

- Step Back time-travel in the top bar: undo Single Step / Run bursts (Shift+F8), restoring registers, flags, memory, and console output (up to 512 checkpoints)
- Top bar uses icon + text buttons: Compile, Run / Pause, Single Step (renamed from Step), Step Back, Reset, theme toggle
- Compact File menu (hover or click to open): Open…, Save (Ctrl+S), Save as…, Share…
- Help menu opens on hover as well as click
- Native desktop menu (Electron): Single Step + Step Back entries wired to the IDE

## [1.3.0] — 2026-09-23

### Added

- Offline macOS desktop build via Electron (`electron/main.js` + `preload.js`): the packaged app forks the bundled Next standalone server on loopback, so assembling, running, stepping, and file save work with no internet
- One-command local builds: `bun run dist:mac` (current Apple-silicon/Intel arch) and `bun run electron:dist:mac-all` (arm64 + x64 DMGs); `bun run electron:dev` for live desktop development
- Offline helpers (`lib/electron/offline.ts`) with unit tests: Electron detection, loopback URL/health-check builders, port normalization, share gating
- Share dialog goes offline-aware: the Generate action disables with guidance while offline instead of failing on a network error
- Ads feature flag (`NEXT_PUBLIC_ENABLE_ADS`, default OFF): all AdSense units, the anchor bar, and the ads script/meta render only when enabled — no empty ad boxes on web or desktop
- Native desktop menu: emu8086web app menu (About, Check for Updates), File (New/Open/Save/Save As), Assemble (Compile/Run/Pause/Step/Reset), standard Edit roles, View zoom/reload, Window, and Help (shortcuts, ASCII, converter, issue tracker) wired into the IDE
- Branded macOS app icon (`assets/icon.icns`, generated from `public/logo.svg`)
- In-app auto-update (electron-updater + GitHub Releases): background check after launch, restart prompt when ready, manual “Check for Updates…” in the menu
- `release-desktop` GitHub workflow: push a `v*` tag to build arm64 + x64 DMGs and attach them to the release for the updater

### Fixed

- Electron dev shell on macOS: allow loopback dev origins (HMR + client chunks load, clicks work) and launch dev Electron with `--no-sandbox` (sandboxed dev Helper file access is denied); packaged builds stay sandboxed

### Notes

- Seamless auto-install on macOS needs Developer ID signing + notarization; until then the updater downloads and the user reinstalls from the DMG

## [1.2.6] — 2026-09-23

### Fixed

- Memory operands with uppercase registers (`[SI]`, `[SI+2]`, `ARR[SI]`, `[BX+SI]`, `MARK[BX][SI]`) now resolve correctly — previously only lowercase worked, which returned wrong data whenever the target was not at offset 0
- String search over memory with an uppercase index register no longer misses or loops past the terminator

### Added

- Regression suite (`lib/emulator/addressing-modes.test.ts`): uppercase memory operands plus case-insensitivity coverage for opcodes, registers, directives, hex/binary suffixes, `DUP`, `OFFSET`/`LEA`, `BYTE/WORD PTR`, and quoted-semicolon strings

## [1.2.5] — 2026-09-09

### Added

- Assembler/emulator supports MASM-style 2D array indexing: `mark[bx][si]` (equivalent to `mark[bx+si]`)

## [1.2.4] — 2026-09-08

### Fixed

- Assembler accepts continuation `db` / `dw` lines without a label (MASM-style multi-line arrays, e.g. 2D byte matrices)

## [1.2.3] — 2026-09-07

### Fixed

- `mov [si], bl` / `mov al, [si]` are byte operations when one operand is an 8-bit register (bare `[si]` was treated as a word, which zeroed the next array element during bubble sort)
- INT 21h AH=01 echoes Enter as CR (`0Dh`) — cursor to column 0 — instead of a line feed, so a following `newline` proc is a single new line
- Run no longer stops at each character of INT 21h input; type a full number and press Enter without clicking Run again

### Added

- Sample programs: define an array, print an array, sort an array
- Console keyboard accepts a line / paste; Enter sends CR as the end-of-input character

### Changed

- Package manager is **Bun** (`bun.lock`, `bun install` / `bun run …`). `package-lock.json` is gone.

## [1.2.2] — 2026-08-01

### Fixed

- DOS console treats `0Ah` (LF) and `0Dh` (CR) as independent cursor motions (LF = down, keep column; CR = column 0) — matching emu8086 / DOS, including overwrite and stair-step LF-only cases
- ASCII codes info popover no longer clips off-screen at the bottom of a column

### Added

- IBM PC Code Page 437 glyph mapping for console output (classic DOS symbols through 255)
- ASCII codes Help panel: full 0–255 map, viewport-fit columns (32 / 16 / 10 rows), horizontal scroll
- Per-code info card (hover): glyph, abbrev badge, short description — fixed-position so it stays visible
- Unit tests for CR/LF cursor semantics, triangle sample, and CP437 glyphs (`npm test`)

### Changed

- Number converter ASCII row reports CP437 through 255

## [1.2.1] — 2026-07-24

### Added

- Open-source repo link (`github.com/nafiskabbo/emu_8086_web`) with GitHub icon in About, Settings, and contact links
- Help menu shows preference-aware shortcut chords beside ASCII / converter / shortcuts
- Assembly-themed custom 404 page
- Google Search Console verification meta tag
- Copy icon beside Copy / Copy error labels (console + error bar)

### Changed

- Migrated Next.js `middleware` → `proxy` convention
- README logo sized down; contributing points at the GitHub repo

## [1.2.0] — 2026-07-24

### Added

- Share dialog: expiry 1 / 3 / 7 days, short `/s/{code}` URL, QR code, copy link (Supabase-backed)
- Anonymous Share API (`POST /api/share`, `GET /api/share/{code}`) with size limits, dedup, rate limit, and expired-row cleanup
- Editor paneltitle: Undo / Redo / Copy icon buttons
- Agent & SEO discoverability: absolute sitemap, robots Content-Signal (`ai-train=yes, search=yes, ai-input=yes`), Link headers, Markdown-for-Agents on `/`, API catalog, health endpoint, agent-skills index, WebMCP tools, JSON-LD (author + product + portfolio sites)

### Notes

- Run the `shared_programs` SQL from the 1.2.0 release plan in the Supabase SQL editor; set `SUPABASE_SERVICE_ROLE_KEY` (never expose it as `NEXT_PUBLIC_`)
- Optional DNS-AID SVCB records for agent discovery must be configured in your DNS provider (e.g. Cloudflare) — not shipped as app code
- Legacy `?p=` share links still load

## [1.1.1] — 2026-07-24

### Added

- `ads.txt` at site root (`google.com, pub-4805854422784600, DIRECT, f08c47fec0942fa0`)
- Site ready for Google Funding Choices CMP (served by existing AdSense tag once published in AdSense Privacy & messaging)

## [1.1.0] — 2026-07-24

### Added

- Editor indent-on-Enter and Format Document / Format Selection (scheme-aware)
- Keyboard shortcuts Help: IntelliJ (default) / VS Code schemes; Auto / Mac / Windows / Both display; remappable chords
- Multi-line editing: duplicate / move / delete lines, toggle comment; custom undo/redo stack
- F5 / F8 work while the editor is focused; Esc closes dialogs
- Help → Changelog panel
- Copy error for AI (error bar) with numbered source context
- Flags register Details dialog (meanings + FLAGS word)
- Settings: tab size, word wrap, primary accent color (auto-contrast button text)
- About / Settings contact links (portfolio, GitHub, LinkedIn, WhatsApp, email)
- Manual AdSense display units (hidden when unfilled); bottom anchor collapses when empty
- Hotkeys: ASCII (`Mod+Shift+1`), Number converter (`Mod+Shift+2`), Shortcuts (`Mod+Shift+/`)

### Fixed

- Assembler accepts double-quoted strings in `DB` / `DW` (e.g. `str1 db "Fail$"`)
- Clearer `Bad value` messages for invalid data tokens
- Undo/redo after controlled editor updates
- Mac-friendly shortcut labels (⌘ ⌥ ⇧) instead of Alt-only chords

## [1.0.0] — 2026-07-01

### Added

- Initial release: MASM-style assemble, step, run, multi-file workspace
- Registers, flags, memory dump, console I/O, breakpoints, share links
