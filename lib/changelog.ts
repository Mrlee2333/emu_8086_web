/** Structured release notes for Help → Changelog (mirrors CHANGELOG.md). */

export type ChangelogEntry = {
  version: string;
  date: string;
  highlights: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.4.2",
    date: "2026-09-28",
    highlights: [
      "Security: dependencies cleared of 2 critical + 8 high advisories (Next 16.3.6) — CI now fails on anything high or worse",
      "Security: share rate limiting no longer trusts a client-supplied X-Forwarded-For, and the cross-origin POST that could fill the share table is rejected",
      "Security: Content-Security-Policy and the standard security headers, previously absent, now ship on the web and desktop builds",
      "Security: the desktop app can no longer be navigated off its own origin while holding the folder read/write bridge",
      "Fix: the Speed slider now applies while a program is running (it previously did nothing until Run was pressed again)",
      "Fix: Step Back no longer retains tens of megabytes — checkpoints during a run are rate-limited and the shadow stacks are capped",
      "Performance: a run renders at most once per frame, the console is no longer re-joined on every render, and the workspace is no longer written to storage on every keystroke",
      "First-load JS for the IDE dropped ~76 KB by moving the QR encoder behind a dynamic import; CI now gates on a bundle budget",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-09-26",
    highlights: [
      "macOS fix: the desktop app no longer reports “is damaged and can’t be opened” — every build is now code-signature sealed (ad-hoc when no Developer ID is configured)",
      "macOS fix: the app no longer spawns infinite copies of itself and freezes — the bundled Next server is launched in Node mode instead of rebooting the app",
      "Desktop fix: the bundled server is unpacked from the asar, so the app can actually start (it previously could not find its own server)",
      "Single-instance lock: reopening the app focuses the running window instead of starting another app + server",
      "CI gate: releases now fail unless codesign verification and the bundled server both pass",
      "Dependency bumps: Electron 44.4.5, @supabase/supabase-js 2.117.2",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-23",
    highlights: [
      "Folder workspace: open any folder, browse .asm/.txt/.inc tree, create/rename/delete files + subfolders (Electron desktop + Chromium File System Access)",
      "Collapsible Explorer sidebar with Hide/Show toggle (persisted) + native File → Open/Close Folder menu",
      "Folder-backed Save: Ctrl+S writes straight back to disk instead of downloading",
      "8086 syntax highlighting: registers, mnemonics, directives, labels, numbers, strings, comments (both themes)",
      "ALU panel: live next-operation + affected flags, mirroring the original emu8086 ALU view",
      "In-app name/confirm dialogs (fixes Electron prompt() crash); Overleaf-like virtual project + export in plain browsers",
      "VS Code tabs, collapsible CPU panels, single-file .zip export, empty-folder fix",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-09-23",
    highlights: [
      "Watch panel: pin registers, variables, memory operands; live values while stepping (persisted)",
      "Memory dump: find bytes (hex or text) with match count + wrap, goto address (1A2Bh / 0x1A2B / decimal)",
      "Open-file size cap (256 KiB) with skipped-file notice",
      "Filename sanitization: traversal, separators, control chars stripped",
      "Console output capped at 2000 lines so print loops can't freeze the tab",
      "Help hover no longer dismisses an open help dialog",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-09-23",
    highlights: [
      "Step Back time-travel: undo Single Step / Run bursts (Shift+F8), restores registers, flags, memory, console",
      "Toolbar renamed Step → Single Step with icon + text buttons (Compile, Run, Pause, Reset, theme)",
      "Compact File menu (hover to open): Open, Save, Save as, Share",
      "Help menu opens on hover as well as click",
      "Native desktop menu: Single Step + Step Back entries",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-09-23",
    highlights: [
      "Offline macOS desktop build via Electron (loopback standalone server)",
      "One-command builds: bun run dist:mac; live desktop dev: bun run electron:dev",
      "Share dialog disables gracefully while offline",
      "Ads behind a flag (NEXT_PUBLIC_ENABLE_ADS, default off)",
      "Native desktop menu: File, Assemble, Edit, View, Window, Help",
      "Branded macOS app icon + in-app auto-update from GitHub Releases",
    ],
  },
  {
    version: "1.2.6",
    date: "2026-09-23",
    highlights: [
      "Uppercase memory operands fixed: [SI], [SI+2], ARR[SI], [BX+SI]",
      "Regression tests: uppercase operands + case-insensitivity coverage",
    ],
  },
  {
    version: "1.2.5",
    date: "2026-09-09",
    highlights: [
      "MASM-style 2D array indexing: mark[bx][si] (same effective address as mark[bx+si])",
    ],
  },
  {
    version: "1.2.4",
    date: "2026-09-08",
    highlights: [
      "Assembler accepts continuation DB/DW lines without a label (multi-line 2D byte arrays)",
    ],
  },
  {
    version: "1.2.3",
    date: "2026-09-07",
    highlights: [
      "Byte register + [SI] moves are 8-bit (array sort no longer fills with zeros)",
      "INT 21h AH=01 Enter is CR (0Dh) and does not print an extra newline",
      "Run continues across typed input so a full line can be entered without clicking Run again",
      "Samples: define / print / sort a byte array",
      "Package manager is Bun (bun.lock); npm is no longer used",
    ],
  },
  {
    version: "1.2.2",
    date: "2026-08-01",
    highlights: [
      "DOS console: independent LF (down) and CR (column 0) cursor motion, like emu8086",
      "Console I/O uses IBM PC Code Page 437 glyphs (☺ ☻ box-drawing, etc.)",
      "ASCII codes Help: 0–255 map, viewport-fit columns, fixed info cards",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-07-24",
    highlights: [
      "Open-source GitHub repo link in About / Settings / contacts",
      "Help menu shows shortcut chords from your scheme prefs",
      "Custom 404, Google site verification, copy icons beside Copy labels",
      "Next.js proxy migration (middleware → proxy)",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-24",
    highlights: [
      "Share dialog: 1/3/7 day expiry, short /s/{code} links, QR code (Supabase)",
      "Undo / Redo / Copy icon buttons in the Source panel",
      "Agent-ready SEO: sitemap, Content-Signal, Link headers, Markdown Accept, API catalog, skills index, WebMCP",
      "JSON-LD author + product and portfolio site URLs",
    ],
  },
  {
    version: "1.1.1",
    date: "2026-07-24",
    highlights: [
      "ads.txt at site root for AdSense authorization",
      "Google CMP consent messaging ready via existing AdSense tag (EEA/UK/CH)",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-07-24",
    highlights: [
      "Assembler accepts double-quoted strings in DB/DW (e.g. db \"Fail$\")",
      "Editor: indent-on-Enter, format document/selection, multi-line edit, undo/redo",
      "Shortcuts: IntelliJ/VS Code schemes, Mac/Windows/Both views, remappable chords",
      "Hotkeys for ASCII (Mod+Shift+1) and Number converter (Mod+Shift+2)",
      "Copy error for AI — source context ready to paste into ChatGPT / Gemini",
      "Help → Changelog; version bumped to 1.1.0",
      "Flags register Details dialog (meanings + FLAGS word)",
      "Settings: tab size, word wrap, primary accent with contrast-safe button text",
      "About / Settings: portfolio, GitHub, LinkedIn, WhatsApp, email",
      "Manual AdSense banners (hide when unfilled) + bottom anchor",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-07-01",
    highlights: [
      "Initial release: MASM-style assemble, step, run, multi-file workspace",
      "Registers, flags, memory dump, console I/O, breakpoints, share links",
    ],
  },
];
