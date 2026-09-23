/**
 * File-open size cap + filename sanitization tests (v1.3.2 hardening).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureAsmExtension,
  isOpenableSize,
  MAX_FILE_NAME_CHARS,
  MAX_OPEN_FILE_BYTES,
  sanitizeFileName,
} from "./workspace-files";

describe("sanitizeFileName", () => {
  it("strips directory traversal", () => {
    assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFileName("..\\..\\win\\evil"), "evil");
    assert.equal(sanitizeFileName("C:\\Users\\x\\a.asm"), "a.asm");
    assert.equal(sanitizeFileName("/abs/path/prog.asm"), "prog.asm");
  });

  it("removes leading dots and collapses dot-runs", () => {
    assert.equal(sanitizeFileName(".."), "untitled");
    assert.equal(sanitizeFileName("..."), "untitled");
    assert.equal(sanitizeFileName(".hidden"), "hidden");
    assert.equal(sanitizeFileName("a...b"), "a.b");
  });

  it("strips null bytes and control chars", () => {
    assert.equal(sanitizeFileName("a\0b.asm"), "ab.asm");
    assert.equal(sanitizeFileName("a\nb\rc.asm"), "abc.asm");
    assert.equal(sanitizeFileName("a\tb"), "ab");
  });

  it("falls back for empty names and preserves unicode", () => {
    assert.equal(sanitizeFileName(""), "untitled");
    assert.equal(sanitizeFileName("   "), "untitled");
    assert.equal(sanitizeFileName("üñîcode_প্রোগ্রাম.asm"), "üñîcode_প্রোগ্রাম.asm");
  });

  it("truncates over-long names keeping the extension", () => {
    const long = `a`.repeat(200) + ".asm";
    const out = sanitizeFileName(long);
    assert.ok(out.length <= MAX_FILE_NAME_CHARS);
    assert.ok(out.endsWith(".asm"));
  });
});

describe("ensureAsmExtension", () => {
  it("keeps allowed extensions, appends .asm otherwise", () => {
    assert.equal(ensureAsmExtension("prog.asm"), "prog.asm");
    assert.equal(ensureAsmExtension("notes.TXT"), "notes.TXT");
    assert.equal(ensureAsmExtension("lib.inc"), "lib.inc");
    assert.equal(ensureAsmExtension("prog"), "prog.asm");
  });

  it("sanitizes prompt input", () => {
    assert.equal(ensureAsmExtension("  ../../evil  "), "evil.asm");
    assert.equal(ensureAsmExtension(""), "untitled.asm");
  });
});

describe("isOpenableSize", () => {
  it("accepts up to the cap and rejects beyond", () => {
    assert.equal(isOpenableSize(0), true);
    assert.equal(isOpenableSize(MAX_OPEN_FILE_BYTES), true);
    assert.equal(isOpenableSize(MAX_OPEN_FILE_BYTES + 1), false);
    assert.equal(isOpenableSize(100 * 1024 * 1024), false);
    assert.equal(isOpenableSize(-1), false);
    assert.equal(isOpenableSize(NaN), false);
  });
});
