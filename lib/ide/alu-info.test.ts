/**
 * ALU description tests (v1.4.0 — mirrors original emu8086 ALU view).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeAlu } from "./alu-info";
import type { Flags, Registers } from "@/lib/emulator/types";

const reg = {
  ax: 1, bx: 0, cx: 0, dx: 0, si: 0, di: 0,
  bp: 0, sp: 0xfffe, ds: 0, es: 0, ss: 0, cs: 0,
} as Registers;

const flags = {
  CF: 0, PF: 0, AF: 0, ZF: 0, SF: 0, TF: 0, IF: 0, DF: 0, OF: 0,
} as Flags;

describe("describeAlu", () => {
  it("flags arithmetic ops and lists affected flags", () => {
    const out = describeAlu({
      instrs: [{ op: "add", args: ["ax", "1"], ln: 1 }],
      ip: 0,
      reg,
      flags,
    });
    assert.ok(out?.isAluOp);
    assert.ok(out?.affectedFlags.includes("CF"));
    assert.ok(out?.summary.includes("ADD"));
  });

  it("marks moves as non-ALU ops", () => {
    const out = describeAlu({
      instrs: [{ op: "mov", args: ["ax", "1"], ln: 1 }],
      ip: 0,
      reg,
      flags,
    });
    assert.equal(out?.isAluOp, false);
  });

  it("returns null past the last instruction", () => {
    assert.equal(describeAlu({ instrs: [], ip: 0, reg, flags }), null);
  });
});
