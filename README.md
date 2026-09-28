# emu8086web

Browser-based 8086 assembler and step debugger. A modernization of classic emu8086 for every platform — write, assemble, and debug MASM-style assembly entirely in your browser.

**Developed by [Nafis Islam Kabbo](https://nafiskabbo.vercel.app/)** · Version **1.5.2** · [MIT License](LICENSE) · [Changelog](CHANGELOG.md)

- Product: [https://emu-8086-web.vercel.app](https://emu-8086-web.vercel.app)
- Portfolio: [https://nafiskabbo.vercel.app](https://nafiskabbo.vercel.app)
- Source: [https://github.com/nafiskabbo/emu_8086_web](https://github.com/nafiskabbo/emu_8086_web)

<img src="public/logo.svg" alt="emu8086web logo" width="72" height="72" />

## Quick start

Requires [Bun](https://bun.sh) 1.4+.

```bash
bun install
cp .env.example .env.local   # optional: Supabase keys for share links
bun dev
```

Open [http://localhost:3000](http://localhost:3000) — the IDE opens directly, no
landing page.

Offline macOS app, environment variables, self-hosting, DMG verification and
troubleshooting: **[docs/installation.md](docs/installation.md)**.

## Features

- Folder workspace: open any directory on desktop (Electron) or Chromium, browse `.asm` / `.txt` / `.inc` in a VS Code-like Explorer (create/rename/delete), collapsible sidebar; plain browsers get an Overleaf-like on-device project with one-click `.zip` export
- Multi-file tabs (closing a tab keeps the project file); folder-backed Save writes straight to disk, otherwise Save downloads
- Compile, Run, Pause, Single Step, Step Back (time-travel), Reset with breakpoints
- Registers, flags (with Details view), ALU operation view, watch expressions, data segment, hex memory dump (find/goto), stack & call stack — all collapsible
- CRT console with DOS INT 21h / BIOS INT 10h / INT 16h I/O
- Broad 8086 instruction coverage (interpretive engine)
- Short share links (`/s/{code}`) with 1 / 3 / 7 day expiry, QR code, dedup; legacy `?p=` still loads
- Light/dark themes, accent color; Undo / Redo / Copy icons in Source panel
- Editor: 8086 syntax highlighting, indent-on-Enter, format document, tab size / word wrap
- Help tools: ASCII table, number converter, shortcuts, changelog, About
- Copy error for AI assistants from the error bar
- Resizable editor / console / CPU panels; responsive mobile & desktop layout
- Agent discovery: sitemap, robots Content-Signal, Link headers, Markdown Accept on `/`, API catalog, agent-skills, WebMCP, JSON-LD
- Vercel Analytics; manual AdSense placements; `ads.txt` + Google CMP for EEA/UK/CH

## Using the IDE

1. Write assembly or load a sample.
2. **Compile** (F5), then **Step** (F8) or **Run**.
3. Click gutter line numbers for breakpoints.
4. Use **+** on the tab bar for new files; double-click a tab to rename. Closing a tab keeps the file in the project — delete from the Explorer to remove it.
5. **Save** writes back to disk for folder files, otherwise downloads the active file by name; **Save as** always downloads.
6. **Share** opens a dialog — pick expiry, generate short URL + QR.
7. **Help** → ASCII codes, converters, About, Settings (modal).
8. Undo / Redo / Copy icons sit next to the file name in the Source panel.

### Keyboard shortcuts

Defaults follow **IntelliJ** (switchable to VS Code in Help → Shortcuts). Mac shows ⌘/⌥; Windows shows Ctrl/Alt. Remap any chord in that panel.

| Action | IntelliJ (typical) |
|--------|-------------------|
| Compile | F5 |
| Step | F8 |
| Pause / close dialog | Esc |
| Save | ⌘/Ctrl+S |
| Shortcuts help | ⌘/Ctrl+Shift+/ or `?` |
| ASCII codes | ⌘/Ctrl+Shift+1 |
| Number converter | ⌘/Ctrl+Shift+2 |
| Format document | ⌘/Ctrl+⌥/Alt+F |
| Format selection | ⌘/Ctrl+⌥/Alt+Shift+F |
| Undo / Redo | ⌘/Ctrl+Z · ⌘/Ctrl+Shift+Z |

## Agent / SEO discovery

| Resource | Path |
|----------|------|
| Sitemap | `/sitemap.xml` |
| Robots + Content-Signal | `/robots.txt` |
| LLM context | `/llms.txt` |
| API catalog | `/.well-known/api-catalog` |
| Agent skills | `/.well-known/agent-skills/index.json` |
| Health | `/api/health` |
| Markdown for Agents | `Accept: text/markdown` on `/` |

**DNS-AID (optional, DNS provider):** publish SVCB/HTTPS discovery records under `_agents` for your domain pointing at the agent resources above. Sign with DNSSEC when available. This is configured in Cloudflare (or your DNS host), not in this repo.

## Supported assembly

See [docs/emulator.md](docs/emulator.md) for the instruction and interrupt
matrix, and [docs/corpus-coverage.md](docs/corpus-coverage.md) for how
correctness is measured: 461 of the 525 programs in a third-party corpus produce
byte-identical output, and 136 of them run as part of `bun test`.

## Planned / roadmap

Not yet complete vs classic emu8086 (tracked in [project.md](project.md)):

- Virtual I/O devices (LED, 7-segment, stepper, traffic light)
- INT 10h graphics modes
- Binary opcode encoding / `.com` / `.exe` export
- Embedded tutorials
- Cycle-accurate timing
- Collaborative / cloud projects

## Project structure

```
app/                  Next.js routes (/ IDE, /s/[code], APIs, .well-known)
components/ide/       Editor, panels, toolbar, help, settings, share dialog
lib/emulator/         Assembler + CPU interpreter
lib/emulator/corpus/  Third-party programs used as conformance fixtures
lib/ide/              Workspace + emulator React hook
lib/share/            Share limits + rate limit helpers
lib/supabase/         Server Supabase client
docs/                 Engine reference, coverage report, install guide, credits
```

## Scripts

```bash
bun dev            # Development server
bun run build      # Production build
bun run lint       # ESLint
bun run typecheck  # TypeScript
bun test           # Emulator, corpus conformance, offline-helper, ads-flag tests
bun run verify     # lint + typecheck + test + build
bun run electron:dev      # Desktop window against `next dev`
bun run dist:mac          # Offline macOS DMG (this Mac's architecture)
```

## Contributing

This is an **open source** project. PRs welcome at [github.com/nafiskabbo/emu_8086_web](https://github.com/nafiskabbo/emu_8086_web). See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- Bun for install, scripts, and tests
- Emulator runs in the browser; Share API uses Supabase (optional until configured)

## Inspired by emu8086

A modern web reimagining of the classic [emu8086](https://emu8086-microprocessor-emulator.en.softonic.com/) teaching tool. Not affiliated with the original software.

## Thanks

This emulator is measurably better because it was measured against someone
else's work: **[8086-ASSEMBLY-LANGUAGE-PROGRAMS](https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS)
by [Amey Thakur](https://github.com/Amey-Thakur)** (MIT), around 500 worked 8086
programs. 461 of the 525 now produce byte-identical output, up from 133, and
running them found defects our own tests never had — `CALL` was not pushing a
return address, so recursion scored 0 of 12.

Full story, licences, and the projects behind it: **[docs/thanks.md](docs/thanks.md)**.

## License

[MIT](LICENSE) © Nafis Islam Kabbo
