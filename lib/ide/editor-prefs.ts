export const TAB_SIZE_KEY = "emu8086web:tabSize";
export const WORD_WRAP_KEY = "emu8086web:wordWrap";
export const ACCENT_KEY = "emu8086web:accent";
export const FONT_SCALE_KEY = "emu8086web:fontScale";
/** v1.5.2 — whether the desktop app may check for updates on its own. */
export const AUTO_UPDATE_KEY = "autoUpdate";

export const DEFAULT_TAB_SIZE = 4;
export const DEFAULT_ACCENT_DARK = "#64d2ff";
export const DEFAULT_ACCENT_LIGHT = "#b3690a";
/** v1.5.2 — the desktop app checks by default, as desktop apps do. */
export const DEFAULT_AUTO_UPDATE = true;

export type TabSize = 2 | 4 | 8;

/** The small scalar preferences, mirrored to the main process on the desktop. */
export const MIRRORED_KEYS = [
  "emu8086web:theme",
  ACCENT_KEY,
  TAB_SIZE_KEY,
  WORD_WRAP_KEY,
  FONT_SCALE_KEY,
  AUTO_UPDATE_KEY,
] as const;

export function loadTabSize(): TabSize {
  if (typeof window === "undefined") return DEFAULT_TAB_SIZE;
  const n = Number(localStorage.getItem(TAB_SIZE_KEY));
  if (n === 2 || n === 4 || n === 8) return n;
  return DEFAULT_TAB_SIZE;
}

export function loadWordWrap(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(WORD_WRAP_KEY) === "1";
}

export function loadAccent(): string | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(ACCENT_KEY);
  return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

/** Derive a dimmed companion color for --amber-dim. */
export function dimAccent(hex: string): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const mix = (c: number) => Math.round(c * 0.45 + 0x20 * 0.55);
  const r = mix(parseInt(m[1], 16));
  const g = mix(parseInt(m[2], 16));
  const b = mix(parseInt(m[3], 16));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function applyAccent(hex: string | null, theme: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty("--amber");
    root.style.removeProperty("--amber-dim");
    root.style.removeProperty("--amber-fg");
    return;
  }
  root.style.setProperty("--amber", hex);
  root.style.setProperty("--amber-dim", dimAccent(hex));
  // dynamic import avoided — inline luminance
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  let fg = "#0a0f1a";
  if (m) {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const L =
      0.2126 * lin(parseInt(m[1], 16)) +
      0.7152 * lin(parseInt(m[2], 16)) +
      0.0722 * lin(parseInt(m[3], 16));
    fg = L > 0.45 ? "#0a0f1a" : "#ffffff";
  }
  root.style.setProperty("--amber-fg", fg);
  void theme;
}

export function defaultAccentForTheme(theme: "dark" | "light"): string {
  return theme === "light" ? DEFAULT_ACCENT_LIGHT : DEFAULT_ACCENT_DARK;
}

/**
 * Values that mean "yes", matched case-insensitively after trimming.
 *
 * Kept identical to `autoUpdateEnabled` in `electron/update-pref.js`; the two
 * live in different processes and main stays dependency-free plain JS, so the
 * list is duplicated. `editor-prefs.test.ts` asserts the two agree, because a
 * disagreement means the settings dialog says "off" while the updater is still
 * on.
 */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function loadAutoUpdate(): boolean {
  if (typeof window === "undefined") return DEFAULT_AUTO_UPDATE;
  const raw = localStorage.getItem(AUTO_UPDATE_KEY);
  // Absent means the user never chose. Present but unrecognised is false, so a
  // user who turned updates off does not get them back from a typo.
  if (raw === null) return DEFAULT_AUTO_UPDATE;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Main-process mirror (v1.5.2)
 *
 * The desktop app used to lose every preference on restart, because the
 * bundled server bound a random port and localStorage is keyed by origin. The
 * port is pinned now, so this is a safety net rather than the main mechanism —
 * but it is also the *only* way the main process can read a preference, since
 * it has no access to the renderer's localStorage. The auto-update setting
 * depends on that.
 *
 * Every function is a no-op in the browser and never throws: preferences are
 * not worth failing a page load over.
 * ------------------------------------------------------------------ */

function bridge(): ElectronBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.electronAPI;
}

export function isDesktop(): boolean {
  return Boolean(bridge()?.isElectron?.());
}

/**
 * Push the current preferences to the main process.
 *
 * Reads them from localStorage rather than taking them as an argument so the
 * call sites cannot drift from what is actually stored.
 */
export async function mirrorPrefs(): Promise<void> {
  const api = bridge();
  if (!api?.setSettings || typeof localStorage === "undefined") return;
  const patch: Record<string, string | null> = {};
  for (const key of MIRRORED_KEYS) {
    patch[key] = localStorage.getItem(key);
  }
  try {
    await api.setSettings(patch);
  } catch {
    /* best-effort */
  }
}

/**
 * Repopulate localStorage from the main process where it is empty.
 *
 * Only fills gaps. A value already in localStorage is the one the user set in
 * this origin, and is never overwritten. Returns the keys it restored so the
 * caller can apply them.
 */
export async function restoreMirroredPrefs(): Promise<string[]> {
  const api = bridge();
  if (!api?.getSettings || typeof localStorage === "undefined") return [];
  let stored: Record<string, string>;
  try {
    stored = await api.getSettings();
  } catch {
    return [];
  }
  const restored: string[] = [];
  for (const key of MIRRORED_KEYS) {
    const value = stored?.[key];
    if (typeof value !== "string" || value === "") continue;
    if (localStorage.getItem(key) !== null) continue;
    try {
      localStorage.setItem(key, value);
      restored.push(key);
    } catch {
      /* quota or denied storage */
    }
  }
  return restored;
}
