/**
 * Folder-workspace path resolution (v1.4.2).
 *
 * Extracted from `electron/main.js` so the confinement logic is unit-testable:
 * `folder-guards.js` holds the pure string rules, and this module holds the
 * parts that must touch the filesystem. `electron/folder-resolve.test.ts`
 * exercises the same functions `main.js` calls, so the shipped path is the
 * tested path.
 *
 * Confines every renderer-supplied path to the allowed root. The renderer
 * never supplies the root — it is set only by the native folder picker.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const { hasNoDotSegments, isSafeRelPath, isSourceFileRel } = require("./folder-guards");

/** True when `rel` stays within `absRoot` once symlinks are resolved. */
function isInside(absRoot, candidate) {
  const rel = path.relative(absRoot, candidate);
  return !(rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}

/** Absolute, symlink-resolved form of the allowed root. */
async function realRoot(root) {
  if (!root) throw new Error("No folder open");
  return fs.realpath(path.resolve(root));
}

/**
 * Resolve `rel` inside the allowed root for READING.
 *
 * `path.relative` is used rather than a string prefix so the check also holds
 * on case-insensitive filesystems. realpath is re-applied so a linked
 * directory cannot escape confinement; when it fails (a missing leaf) the
 * unresolved path is used, which is safe for reads because reading a dangling
 * link simply fails.
 */
async function resolveInside(root, rel) {
  const absRoot = await realRoot(root);
  if (!isSafeRelPath(rel)) throw new Error("Invalid path");
  const target = path.resolve(absRoot, rel);
  const real = await fs.realpath(target).catch(() => target);
  if (!isInside(absRoot, real)) throw new Error("Path escapes the opened folder");
  return target;
}

/**
 * Resolve `rel` inside the allowed root for MUTATION (write / create / rename
 * destination).
 *
 * The unresolved-path fallback in `resolveInside` is exactly the dangling
 * symlink case: `evil.asm -> /tmp/out/pwn.asm` with a missing leaf makes
 * realpath throw ENOENT, the read guard passes, and the write follows the link
 * out of the opened folder. So mutations additionally:
 *
 *   1. reject a target that is itself a symlink, and
 *   2. re-resolve the PARENT directory, which `mkdir -p` creates and which can
 *      be a link — the escape `resolveInside` alone does not catch.
 *
 * A parent that does not exist yet falls back to its unresolved path, which is
 * inside the root by construction and is about to be created there.
 */
async function resolveForWrite(root, rel) {
  const abs = await resolveInside(root, rel);
  const link = await fs.lstat(abs).catch(() => null);
  if (link?.isSymbolicLink()) {
    throw new Error("Symbolic links are not writable targets");
  }
  const absRoot = await realRoot(root);
  const parent = path.dirname(abs);
  const realParent = await fs.realpath(parent).catch(() => parent);
  if (!isInside(absRoot, realParent)) {
    throw new Error("Path escapes the opened folder");
  }
  return abs;
}

/** Readable source FILE (extension + dotfile policy enforced). */
async function resolveSourceFile(root, rel) {
  if (!isSourceFileRel(rel)) throw new Error("Only .asm/.txt/.inc files");
  return resolveInside(root, rel);
}

/** Writable source FILE (symlink-safe). */
async function resolveWritableFile(root, rel) {
  if (!isSourceFileRel(rel)) throw new Error("Only .asm/.txt/.inc files");
  return resolveForWrite(root, rel);
}

/** Creatable DIRECTORY (no dot segments, symlink-safe). */
async function resolveWritableDir(root, rel) {
  if (!isSafeRelPath(rel) || !hasNoDotSegments(rel)) {
    throw new Error("Invalid folder path");
  }
  return resolveForWrite(root, rel);
}

module.exports = {
  isInside,
  resolveInside,
  resolveForWrite,
  resolveSourceFile,
  resolveWritableFile,
  resolveWritableDir,
};
