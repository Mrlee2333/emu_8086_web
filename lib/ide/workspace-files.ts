import { DEFAULT_SOURCE } from "@/lib/emulator";

export interface WorkspaceFile {
  id: string;
  name: string;
  content: string;
  dirty: boolean;
}

export const FILES_STORAGE_KEY = "emu8086web:files:v1";
export const ACTIVE_FILE_KEY = "emu8086web:activeFile";
/** Open editor tabs (VS Code semantics: closing a tab keeps the project file). */
export const OPEN_TABS_KEY = "emu8086web:openTabs";
/**
 * Tab id → folder relPath for folder-backed tabs (rehydrated when the
 * Electron folder is restored; confinement still enforced main-side).
 */
export const FOLDER_MAP_KEY = "emu8086web:folderMap";

/** Largest single file accepted via Open (256 KiB — classroom .asm is ~KBs). */
export const MAX_OPEN_FILE_BYTES = 256 * 1024;

/** Max characters kept in a workspace file name (base + extension). */
export const MAX_FILE_NAME_CHARS = 64;

export function createFileId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultFile(name = "main.asm"): WorkspaceFile {
  return {
    id: createFileId(),
    name,
    content: DEFAULT_SOURCE,
    dirty: false,
  };
}

/**
 * Strip anything that could escape the workspace or break downloads:
 * path separators, null bytes, control chars, leading dots (`..`, `.hidden`),
 * collapsed dot-runs. Unicode letters are preserved; over-long names are
 * truncated keeping the extension. Never returns an empty string.
 */
export function sanitizeFileName(name: string): string {
  let base = (name ?? "").replace(/\0/g, "").trim();
  // Keep only the last path segment (drops `C:\…`, `../../`, `a/b/`).
  const segments = base.split(/[\\/]/);
  base = segments[segments.length - 1] ?? "";
  // Remove ASCII control chars (incl. \r \n \t that break headers/attrs).
  base = base.replace(/[\x00-\x1f\x7f]/g, "");
  // Collapse dot-runs so `...` / `....` cannot act as traversal-ish names.
  base = base.replace(/\.{2,}/g, ".");
  // No leading dots — blocks `.`, `..`, and hidden-file surprises.
  base = base.replace(/^\.+/, "");
  base = base.trim();
  if (!base) return "untitled";

  if (base.length > MAX_FILE_NAME_CHARS) {
    const dot = base.lastIndexOf(".");
    const ext =
      dot > 0 && base.length - dot <= 5 ? base.slice(dot) : "";
    const stemBudget = MAX_FILE_NAME_CHARS - ext.length;
    base = base.slice(0, stemBudget) + ext;
  }
  return base || "untitled";
}

export function ensureAsmExtension(name: string): string {
  const clean = sanitizeFileName(name);
  const trimmed = clean || "untitled.asm";
  return /\.(asm|txt|inc)$/i.test(trimmed) ? trimmed : `${trimmed}.asm`;
}

/** True when an Open-file candidate fits the size cap. */
export function isOpenableSize(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= MAX_OPEN_FILE_BYTES;
}

export function saveFilesToStorage(
  files: WorkspaceFile[],
  activeId: string,
  openIds?: string[],
): void {
  localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(files));
  localStorage.setItem(ACTIVE_FILE_KEY, activeId || "");
  if (openIds) localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openIds));
}

export function loadFilesFromStorage(): {
  files: WorkspaceFile[];
  activeId: string;
  openIds: string[] | null;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FILES_STORAGE_KEY);
    const activeId = localStorage.getItem(ACTIVE_FILE_KEY) ?? "";
    if (raw === null) return null;
    const files = JSON.parse(raw) as WorkspaceFile[];
    if (!Array.isArray(files)) return null;
    let openIds: string[] | null = null;
    try {
      const parsed = JSON.parse(
        localStorage.getItem(OPEN_TABS_KEY) ?? "null",
      ) as unknown;
      if (Array.isArray(parsed)) {
        const ids = parsed.filter((v): v is string => typeof v === "string");
        openIds = ids.filter((id) => files.some((f) => f.id === id));
      }
    } catch {
      openIds = null;
    }
    if (files.length === 0) return { files: [], activeId: "", openIds: [] };
    const id =
      activeId && files.some((f) => f.id === activeId)
        ? activeId
        : files[0].id;
    return { files, activeId: id, openIds };
  } catch {
    return null;
  }
}
