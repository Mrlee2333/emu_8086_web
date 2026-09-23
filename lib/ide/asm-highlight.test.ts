/**
 * ASM tokenizer tests (v1.4.0 syntax highlighting).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenizeAsmLine } from "./asm-highlight";

describe("tokenizeAsmLine", () => {
  it("classifies registers, mnemonics, numbers, and comments", () => {
    const tokens = tokenizeAsmLine("    mov ax, 1A2Bh ; load");
    const kinds = tokens.map((t) => t.kind);
    assert.ok(kinds.includes("mnemonic"));
    assert.ok(kinds.includes("register"));
    assert.ok(kinds.includes("number"));
    assert.ok(kinds.includes("comment"));
  });

  it("handles labels and strings", () => {
    const label = tokenizeAsmLine("again: add ax, 1");
    assert.ok(label.some((t) => t.kind === "label"));
    const str = tokenizeAsmLine('msg db "Hi$"');
    assert.ok(str.some((t) => t.kind === "string"));
    assert.ok(str.some((t) => t.kind === "directive"));
  });

  it("treats quoted semicolons as strings, not comments", () => {
    const tokens = tokenizeAsmLine('msg db "a;b"');
    assert.ok(tokens.some((t) => t.kind === "string"));
    assert.equal(tokens.some((t) => t.kind === "comment"), false);
  });
});
