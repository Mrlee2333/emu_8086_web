/**
 * Pure path guards for the v1.4.0 Electron folder workspace.
 * Framework-free (no node:path import) so `bun test` covers the same rules
 * the Electron main process enforces with `ipcMain.handle`.
 */

import { MAX_OPEN_FILE_BYTES } from "@/lib/ide/workspace-files";

/** Max files listed from one opened folder (prevents 100k-file freezes). */
export const MAX_FOLDER_ENTRIES = 2000;

/** Allowed source extensions in the explorer (same set as FileTabs/Open). */
const ALLOWED_EXT = new Set(["asm", "txt", "inc"]);

/** Normalize backslashes, strip drive letters, collapse dot segments. */
export function normalizeRelPath(raw: string): string {
  const noDrive = raw.replace(/^[a-zA-Z]:/, "");
  const parts = noDrive.split(/[\\/]+/).filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

/** True when `rel` stays inside the opened root (no traversal, no absolute). */
export function isSafeRelPath(rel: string): boolean {
  if (typeof rel !== "string" || !rel) return false;
  if (rel.includes("\0")) return false;
  // Reject absolute paths and drive letters before normalization.
  if (/^[/\\]/.test(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p === "..")) return false;
  if (/[\x00-\x1f\x7f]/.test(rel)) return false;
  const normalized = normalizeRelPath(rel);
  if (!normalized) return false;
  if (normalized.split("/").some((p) => p === ".." || !p)) return false;
  return true;
}

/** True for listable source files (skips binaries, .exe, images, …). */
export function isListableFile(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? "";
  if (!base || base.startsWith(".")) return false;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return ALLOWED_EXT.has(base.slice(dot + 1).toLowerCase());
}

/** True when a file size fits the existing 256 KiB open cap. */
export function isReadableSize(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= MAX_OPEN_FILE_BYTES;
}
