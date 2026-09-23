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

  it("tokenizes 0x-prefixed hex as one number", () => {
    for (const src of ["mov ax, 0x1A", "mov ax, 0XFF", "mov cx, 1010b", "mov dx, 99"]) {
      const kinds = tokenizeAsmLine(src).map((t) => `${t.kind}:${t.value}`);
      const nums = kinds.filter((k) => k.startsWith("number:"));
      assert.equal(nums.length, 1, src);
    }
    const hex = tokenizeAsmLine("mov ax, 0x1A");
    assert.ok(hex.some((t) => t.kind === "number" && t.value === "0x1A"));
  });

  it("highlights BCD adjust mnemonics", () => {
    for (const op of ["aaa", "aas", "daa", "das", "aam", "aad"]) {
      const tokens = tokenizeAsmLine(op);
      assert.ok(
        tokens.some((t) => t.kind === "mnemonic" && t.value === op),
        op,
      );
    }
  });

  it("treats segment overrides as register + punct, not labels", () => {
    const tokens = tokenizeAsmLine("mov ax, es:[bx]");
    const reg = tokens.find((t) => t.value === "es");
    assert.equal(reg?.kind, "register");
    assert.ok(tokens.some((t) => t.kind === "punct" && t.value === ":"));
    assert.equal(
      tokens.some((t) => t.kind === "label"),
      false,
    );
    // Ordinary labels still work.
    assert.ok(
      tokenizeAsmLine("again: loop again").some((t) => t.kind === "label"),
    );
  });
});
