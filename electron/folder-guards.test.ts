/**
 * Folder-guard tests (v1.4.0) — these run against the SAME module
 * `electron/main.js` requires for IPC enforcement (single source).
 * Run: bun test lib electron
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as guards from "./folder-guards.js";

const {
  hasNoDotSegments,
  isSafeRelPath,
  isListableFile,
  isSourceFileRel,
  MAX_FOLDER_FILE_BYTES,
} = guards;

describe("folder-guards (shipped IPC rules)", () => {
  it("rejects traversal, dot segments, absolute, drive, control paths", () => {
    assert.equal(isSafeRelPath("main.asm"), true);
    assert.equal(isSafeRelPath("examples/sort.asm"), true);
    assert.equal(isSafeRelPath("../../etc/passwd"), false);
    assert.equal(isSafeRelPath("a/../../b"), false);
    assert.equal(isSafeRelPath("."), false);
    assert.equal(isSafeRelPath("a/./b.asm"), false);
    assert.equal(isSafeRelPath("/abs/main.asm"), false);
    assert.equal(isSafeRelPath("C:\\win\\evil.asm"), false);
    assert.equal(isSafeRelPath("a\0b.asm"), false);
    assert.equal(isSafeRelPath("a\nb.asm"), false);
    assert.equal(isSafeRelPath(""), false);
  });

  it("lists only source extensions", () => {
    assert.equal(isListableFile("main.asm"), true);
    assert.equal(isListableFile("notes.TXT"), true);
    assert.equal(isListableFile("lib.inc"), true);
    assert.equal(isListableFile("prog.exe"), false);
    assert.equal(isListableFile(".hidden.asm"), false);
    assert.equal(isListableFile("noext"), false);
  });

  it("restricts mutations to visible source files", () => {
    assert.equal(isSourceFileRel("main.asm"), true);
    assert.equal(isSourceFileRel("examples/sort.asm"), true);
    assert.equal(hasNoDotSegments("examples/sort.asm"), true);
    assert.equal(isSourceFileRel("prog.exe"), false);
    assert.equal(isSourceFileRel("data.bin"), false);
    assert.equal(isSourceFileRel(".env"), false);
    assert.equal(isSourceFileRel(".git/config"), false);
    assert.equal(isSourceFileRel("sub/.hidden.asm"), false);
    assert.equal(isSourceFileRel("noext"), false);
  });

  it("caps files at 256 KiB", () => {
    assert.equal(MAX_FOLDER_FILE_BYTES, 256 * 1024);
  });
});
