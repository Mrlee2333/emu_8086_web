/**
 * Folder-guard tests (v1.4.0) — these run against the SAME module
 * `electron/main.js` requires for IPC enforcement (single source).
 * Run: bun test lib electron
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as guards from "./folder-guards.js";

const { isSafeRelPath, isListableFile, MAX_FOLDER_FILE_BYTES } = guards;

describe("folder-guards (shipped IPC rules)", () => {
  it("rejects traversal, absolute, drive, and control-char paths", () => {
    assert.equal(isSafeRelPath("main.asm"), true);
    assert.equal(isSafeRelPath("examples/sort.asm"), true);
    assert.equal(isSafeRelPath("../../etc/passwd"), false);
    assert.equal(isSafeRelPath("a/../../b"), false);
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

  it("caps files at 256 KiB", () => {
    assert.equal(MAX_FOLDER_FILE_BYTES, 256 * 1024);
  });
});
