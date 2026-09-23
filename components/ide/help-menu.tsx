"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AdSenseUnit, AD_SLOTS } from "@/components/ads/adsense-unit";
import { AuthorContacts } from "@/components/ide/author-contacts";
import { DialogShell } from "@/components/ide/dialog-shell";
import { IconGitHub, IconHelp } from "@/components/ide/editor-icons";
import { ShortcutsHelp } from "@/components/ide/shortcuts-help";
import { CHANGELOG } from "@/lib/changelog";
import {
  formatShortcutLabel,
  loadOsView,
  loadOverrides,
  loadScheme,
  type OsView,
  type OverrideMap,
  type ShortcutId,
  type ShortcutScheme,
} from "@/lib/ide/shortcuts";
import {
  cp437TableDisplay,
  getAllCp437Entries,
  getCp437Entry,
  type Cp437Entry,
} from "@/lib/emulator/cp437";
import { APP_AUTHOR, APP_NAME, APP_REPO_URL, APP_TAGLINE, APP_VERSION } from "@/lib/version";

export type HelpPanel =
  | null
  | "menu"
  | "ascii"
  | "convert"
  | "shortcuts"
  | "changelog"
  | "about";

export const OPEN_HELP_EVENT = "emu8086web:open-help";

interface HelpMenuProps {
  onOpenSettings: () => void;
}

const PANEL_META: Record<
  Exclude<HelpPanel, null | "menu">,
  { title: string; wide?: boolean }
> = {
  ascii: { title: "ASCII codes", wide: true },
  convert: { title: "Number converter" },
  shortcuts: { title: "Keyboard shortcuts" },
  changelog: { title: "Changelog" },
  about: { title: `About ${APP_NAME}` },
};

/** Help dropdown rows that have a bound ShortcutId. */
const MENU_ITEMS: {
  id: Exclude<HelpPanel, null | "menu">;
  label: string;
  shortcutId?: ShortcutId;
}[] = [
  { id: "ascii", label: "ASCII codes", shortcutId: "ascii" },
  { id: "convert", label: "Number converter", shortcutId: "convert" },
  { id: "shortcuts", label: "Keyboard shortcuts", shortcutId: "shortcuts" },
  { id: "changelog", label: "Changelog" },
  { id: "about", label: "About" },
];

export function HelpMenu({ onOpenSettings }: HelpMenuProps) {
  const [panel, setPanel] = useState<HelpPanel>(null);
  const [scheme, setScheme] = useState<ShortcutScheme>("intellij");
  const [osView, setOsView] = useState<OsView>("auto");
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openMenu = () => {
    cancelClose();
    // Don't dismiss an open help dialog (ascii/convert/…) when the
    // pointer merely passes over the Help button.
    if (panel !== null && panel !== "menu") return;
    reloadShortcutPrefs();
    setPanel("menu");
  };

  const scheduleClose = () => {
    cancelClose();
    // Small delay keeps hover usable when moving from button to menu.
    closeTimer.current = setTimeout(() => setPanel(null), 120);
  };

  useEffect(() => () => cancelClose(), []);

  const reloadShortcutPrefs = () => {
    setScheme(loadScheme());
    setOsView(loadOsView());
    setOverrides(loadOverrides());
  };

  useEffect(() => {
    queueMicrotask(reloadShortcutPrefs);
    window.addEventListener("emu8086web:shortcuts-changed", reloadShortcutPrefs);
    return () =>
      window.removeEventListener(
        "emu8086web:shortcuts-changed",
        reloadShortcutPrefs,
      );
  }, []);

  useEffect(() => {
    if (!panel) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        if (panel === "menu") setPanel(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [panel]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ panel?: HelpPanel }>).detail;
      setPanel(detail?.panel ?? "shortcuts");
    };
    window.addEventListener(OPEN_HELP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HELP_EVENT, onOpen);
  }, []);

  const dialogPanel =
    panel && panel !== "menu" ? panel : null;
  const meta = dialogPanel ? PANEL_META[dialogPanel] : null;

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="btn inline-flex items-center gap-1.5"
        onClick={() => {
          // Clicking always leaves the menu/dialog (unlike hover).
          cancelClose();
          if (panel !== null) {
            if (panel !== "menu") reloadShortcutPrefs();
            setPanel(panel === "menu" ? null : "menu");
          } else openMenu();
        }}
        aria-expanded={panel === "menu"}
        aria-haspopup="menu"
        title="Help"
      >
        <IconHelp />
        <span>Help</span>
      </button>

      {panel === "menu" && (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-1 min-w-[260px] border border-line bg-panel py-1 shadow-xl"
        >
          {MENU_ITEMS.map(({ id, label, shortcutId }) => {
            const chord = shortcutId
              ? formatShortcutLabel(shortcutId, scheme, osView, overrides)
              : null;
            return (
              <button
                key={id}
                type="button"
                className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-xs text-ink hover:bg-panel-2 hover:text-amber"
                onClick={() => setPanel(id)}
              >
                <span>{label}</span>
                {chord ? (
                  <kbd className="shrink-0 rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
                    {chord}
                  </kbd>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className="block w-full border-t border-line px-3 py-2 text-left text-xs text-ink hover:bg-panel-2 hover:text-amber"
            onClick={() => {
              setPanel(null);
              onOpenSettings();
            }}
          >
            Settings…
          </button>
        </div>
      )}

      <DialogShell
        open={!!dialogPanel}
        onClose={() => setPanel(null)}
        title={meta?.title ?? ""}
        panelClassName={
          meta?.wide
            ? dialogPanel === "ascii"
              ? "max-w-6xl"
              : "max-w-5xl"
            : "max-w-lg"
        }
        footer={
          <>
            <div className="border-t border-line/60 pt-3">
              <AdSenseUnit
                key={dialogPanel ?? "none"}
                slot={AD_SLOTS.banner3}
                compact
              />
            </div>
          </>
        }
      >
        {dialogPanel === "ascii" && <AsciiTable />}
        {dialogPanel === "convert" && <NumberConverter />}
        {dialogPanel === "shortcuts" && <ShortcutsHelp />}
        {dialogPanel === "changelog" && <ChangelogPanel />}
        {dialogPanel === "about" && <AboutPanel />}
      </DialogShell>
    </div>
  );
}

const ROW_OPTIONS = [32, 16, 10] as const;
const CELL_HEIGHT_PX = 40; // cell + gap estimate for fit math

function pickAsciiRows(availablePx: number): (typeof ROW_OPTIONS)[number] {
  for (const n of ROW_OPTIONS) {
    if (availablePx >= n * CELL_HEIGHT_PX) return n;
  }
  return 10;
}

function asciiGlyph(entry: Cp437Entry): string {
  if (entry.code === 0) return "NUL";
  if (entry.code === 32) return "␠";
  if (entry.code === 255) return "NBSP";
  return entry.char;
}

function AsciiInfoTip({ entry }: { entry: Cp437Entry }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const tipH = entry.fullForm ? 128 : 96;

  const show = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const tipW = 200;
    const gap = 8;
    const preferBelow = window.innerHeight - r.bottom >= tipH + gap;
    const top = preferBelow
      ? r.bottom + gap
      : Math.max(8, r.top - tipH - gap);
    let left = r.left + r.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    setCoords({ top, left });
    setOpen(true);
  };

  const hide = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onMove = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const tipW = 200;
      const gap = 8;
      const preferBelow = window.innerHeight - r.bottom >= tipH + gap;
      const top = preferBelow
        ? r.bottom + gap
        : Math.max(8, r.top - tipH - gap);
      let left = r.left + r.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      setCoords({ top, left });
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, tipH]);

  const glyph = asciiGlyph(entry);
  const abbrev =
    entry.code === 0
      ? "NUL"
      : entry.fullForm
        ? entry.meaning
        : null;
  const blurb =
    entry.code === 0
      ? "Null — no character"
      : entry.fullForm
        ? entry.fullForm
        : entry.code >= 32 && entry.code < 127
          ? "Printable ASCII"
          : entry.code > 127
            ? "Code Page 437 glyph"
            : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line/80 bg-panel text-[9px] leading-none text-ink-dim hover:border-amber hover:text-amber focus-visible:border-amber focus-visible:text-amber"
        aria-label={`About code ${entry.code}`}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        i
      </button>
      {open
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[100] w-[200px] overflow-hidden rounded-md border border-line bg-panel shadow-2xl"
              style={{ top: coords.top, left: coords.left }}
            >
              <div className="flex items-center justify-center border-b border-line/60 bg-panel-2/50 px-3 py-3">
                <span className="font-mono text-3xl leading-none text-amber">
                  {glyph}
                </span>
              </div>
              <div className="space-y-1.5 px-3 py-2.5">
                {abbrev ? (
                  <span className="inline-block rounded bg-amber/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber uppercase">
                    {abbrev}
                  </span>
                ) : null}
                {blurb ? (
                  <p className="text-[12px] leading-snug text-ink">{blurb}</p>
                ) : null}
                <p className="font-mono text-[10px] text-ink-dim tabular-nums">
                  {entry.code.toString().padStart(3, "0")} ·{" "}
                  {entry.code.toString(16).padStart(2, "0").toUpperCase()}h
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AsciiTable() {
  const cells = getAllCp437Entries();
  const shellRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<(typeof ROW_OPTIONS)[number]>(16);

  useLayoutEffect(() => {
    const measure = () => {
      // Fit columns to the dialog viewport: prefer 32, then 16, then 10.
      const dialog = shellRef.current?.closest('[role="dialog"]');
      const panel = dialog?.querySelector(":scope > div");
      const panelH =
        panel instanceof HTMLElement
          ? panel.clientHeight
          : Math.floor(window.innerHeight * 0.9);
      // Reserve space for title, intro, ads footer, padding
      const available = Math.max(200, panelH - 220);
      setRows(pickAsciiRows(available));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div ref={shellRef}>
      <p className="text-sm text-ink-dim">
        IBM PC Code Page 437 · {rows} per column · hover{" "}
        <span className="font-mono text-amber">i</span> for details
      </p>
      <div className="mt-4 overflow-x-auto pb-2">
        <div
          className="grid gap-1.5 font-mono text-xs sm:gap-2 sm:text-sm"
          style={{
            gridAutoFlow: "column",
            gridTemplateRows: `repeat(${rows}, minmax(0, auto))`,
            gridAutoColumns: "minmax(8.25rem, 8.25rem)",
          }}
        >
          {cells.map((entry) => {
            const label = cp437TableDisplay(entry);
            const isLabel = Boolean(entry.tableLabel) || entry.code === 0;
            return (
              <div
                key={entry.code}
                className="flex items-center gap-1.5 rounded border border-line/70 bg-panel-2/40 px-2 py-1.5 sm:px-2.5 sm:py-2"
              >
                <span className="min-w-[3ch] text-amber tabular-nums">
                  {entry.code.toString().padStart(3, "0")}
                </span>
                <span
                  className={`min-w-[3.5ch] flex-1 text-center ${
                    isLabel
                      ? "text-[10px] tracking-wide text-red uppercase sm:text-[11px]"
                      : "text-ink"
                  }`}
                >
                  {label}
                </span>
                <span className="text-[10px] text-ink-dim tabular-nums sm:text-[11px]">
                  {entry.code.toString(16).padStart(2, "0").toUpperCase()}h
                </span>
                <AsciiInfoTip entry={entry} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NumberConverter() {
  const [raw, setRaw] = useState("255");
  const n = parseFlexible(raw);

  return (
    <>
      <p className="text-xs text-ink-dim">
        Enter decimal, 0xFF, FFh, 11111111b, or &apos;A&apos;
      </p>
      <input
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        className="mt-3 w-full rounded border border-line bg-panel-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
      />
      {n === null ? (
        <p className="mt-3 text-xs text-red">Invalid number</p>
      ) : (
        <dl className="mt-3 space-y-2 font-mono text-sm">
          <Row label="Decimal" value={String(n >>> 0)} />
          <Row label="Hex" value={`0x${(n >>> 0).toString(16).toUpperCase()}`} />
          <Row label="Binary" value={(n >>> 0).toString(2)} />
          <Row
            label="ASCII / CP437"
            value={
              n >= 0 && n <= 255
                ? (() => {
                    const e = getCp437Entry(n >>> 0);
                    const shown = cp437TableDisplay(e);
                    return e.fullForm
                      ? `${shown} (${e.meaning})`
                      : `'${shown}'`;
                  })()
                : "—"
            }
          />
          <Row label="Signed 16" value={String((n << 16) >> 16)} />
        </dl>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/40 py-1">
      <dt className="text-ink-dim">{label}</dt>
      <dd className="text-ink break-all">{value}</dd>
    </div>
  );
}

function parseFlexible(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^'.'$/.test(t) || /^"."$/.test(t)) return t.charCodeAt(1);
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
  if (/^[0-9a-f]+h$/i.test(t)) return parseInt(t.slice(0, -1), 16);
  if (/^[01]+b$/i.test(t)) return parseInt(t.slice(0, -1), 2);
  if (/^-?[0-9]+$/.test(t)) return parseInt(t, 10);
  return null;
}

function ChangelogPanel() {
  return (
    <>
      <p className="text-xs text-ink-dim">What&apos;s new in {APP_NAME}</p>
      <div className="mt-4 space-y-5">
        {CHANGELOG.map((entry) => (
          <section key={entry.version}>
            <h3 className="font-mono text-sm text-ink">
              v{entry.version}{" "}
              <span className="text-xs text-ink-dim">· {entry.date}</span>
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-dim">
              {entry.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function AboutPanel() {
  return (
    <>
      <p className="text-sm text-ink">{APP_TAGLINE}</p>
      <p className="mt-3 text-sm text-ink-dim">
        Tried to modernize classic emu8086 for the browser so students and
        developers can assemble and debug 8086 programs on every platform —
        Windows, macOS, Linux, and mobile browsers.
      </p>
      <dl className="mt-4 space-y-2 font-mono text-sm">
        <Row label="Version" value={APP_VERSION} />
        <Row label="Developed by" value={APP_AUTHOR.name} />
        <Row label="Email" value={APP_AUTHOR.email} />
        <div className="flex justify-between gap-4 border-b border-line/40 py-1">
          <dt className="text-ink-dim">Repository</dt>
          <dd className="min-w-0 text-right">
            <a
              href={APP_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-end gap-1.5 break-all text-amber hover:underline"
            >
              <IconGitHub className="h-3.5 w-3.5 shrink-0" />
              emu_8086_web
            </a>
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <p className="mb-2 text-xs tracking-wider text-ink-dim uppercase">
          Connect & contribute
        </p>
        <AuthorContacts />
      </div>
    </>
  );
}
