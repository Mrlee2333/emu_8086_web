/**
 * Electron folder security tests (v1.4.0).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isListableFile,
  isReadableSize,
  isSafeRelPath,
  normalizeRelPath,
} from "./folder-security";

describe("folder-security", () => {
  it("normalizes separators and dot segments", () => {
    assert.equal(normalizeRelPath("a\\b\\c.asm"), "a/b/c.asm");
    assert.equal(normalizeRelPath("a/./b.asm"), "a/b.asm");
    assert.equal(normalizeRelPath("C:\\proj\\main.asm"), "proj/main.asm");
  });

  it("rejects traversal and absolute paths", () => {
    assert.equal(isSafeRelPath("main.asm"), true);
    assert.equal(isSafeRelPath("examples/sort.asm"), true);
    assert.equal(isSafeRelPath("../../etc/passwd"), false);
    assert.equal(isSafeRelPath("/abs/main.asm"), false);
    assert.equal(isSafeRelPath("C:\\win\\evil.asm"), false);
    assert.equal(isSafeRelPath(""), false);
  });

  it("lists only source extensions", () => {
    assert.equal(isListableFile("main.asm"), true);
    assert.equal(isListableFile("notes.TXT"), true);
    assert.equal(isListableFile("lib.inc"), true);
    assert.equal(isListableFile("prog.exe"), false);
    assert.equal(isListableFile(".hidden.asm"), false);
  });

  it("enforces the open size cap", () => {
    assert.equal(isReadableSize(10), true);
    assert.equal(isReadableSize(-1), false);
    assert.equal(isReadableSize(10 * 1024 * 1024), false);
  });
});
