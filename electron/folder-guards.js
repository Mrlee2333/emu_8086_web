/**
 * Single-source folder-workspace guards (v1.4.0).
 *
 * Required by `electron/main.js` for IPC enforcement AND by
 * `electron/folder-guards.test.ts`, so the shipped path is the tested path.
 * Deliberately dependency-free (no Node imports): pure string rules only.
 * Path resolution against the allowed root lives in main.js (needs node:path).
 */

const MAX_FOLDER_ENTRIES = 2000;
const MAX_FOLDER_FILE_BYTES = 256 * 1024;
const LISTABLE_EXT = new Set(["asm", "txt", "inc"]);

function segmentsOf(rel) {
  return String(rel).split(/[\\/]+/).filter(Boolean);
}

/**
 * True when `rel` is a safe relative path: no traversal (including bare
 * "." segments, which resolve to the root itself), absolute paths, drive
 * letters, null bytes, or control characters.
 */
function isSafeRelPath(rel) {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (rel.includes("\0")) return false;
  if (/^[/\\]/.test(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  if (segmentsOf(rel).some((p) => p === ".." || p === ".")) return false;
  if (/[\x00-\x1f\x7f]/.test(rel)) return false;
  return true;
}

/** True when no segment is hidden (dotfile/dotdir policy). */
function hasNoDotSegments(rel) {
  return segmentsOf(rel).every((p) => !p.startsWith("."));
}

/** True for listable source files (skips binaries, dotfiles, …). */
function isListableFile(name) {
  const base = String(name).split(/[\\/]/).pop() || "";
  if (!base || base.startsWith(".")) return false;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return LISTABLE_EXT.has(base.slice(dot + 1).toLowerCase());
}

/**
 * True when `rel` names a mutable source FILE (extension allow-list, no
 * dot segments). Mutations (read/write/create-file/rename/delete-file)
 * go through this; directory ops use isSafeRelPath + hasNoDotSegments.
 */
function isSourceFileRel(rel) {
  if (!isSafeRelPath(rel) || !hasNoDotSegments(rel)) return false;
  const leaf = segmentsOf(rel).pop() || "";
  return isListableFile(leaf);
}

module.exports = {
  MAX_FOLDER_ENTRIES,
  MAX_FOLDER_FILE_BYTES,
  LISTABLE_EXT,
  isSafeRelPath,
  hasNoDotSegments,
  isListableFile,
  isSourceFileRel,
};
