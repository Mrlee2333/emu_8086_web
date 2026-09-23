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

  it("lists CF/OF for mul and undefined flags for div", () => {
    const mul = describeAlu({
      instrs: [{ op: "mul", args: ["bl"], ln: 1 }],
      ip: 0,
      reg,
      flags,
    });
    assert.ok(mul?.isAluOp);
    assert.deepEqual(mul?.affectedFlags, ["CF", "OF"]);
    const div = describeAlu({
      instrs: [{ op: "div", args: ["bl"], ln: 1 }],
      ip: 0,
      reg,
      flags,
    });
    assert.ok(div?.isAluOp);
    assert.deepEqual(div?.affectedFlags, []);
    assert.ok(div?.summary.includes("undefined"));
  });

  it("marks not as flags-unchanged, not undefined", () => {
    const out = describeAlu({
      instrs: [{ op: "not", args: ["ax"], ln: 1 }],
      ip: 0,
      reg,
      flags,
    });
    assert.ok(out?.isAluOp);
    assert.deepEqual(out?.affectedFlags, []);
    assert.ok(out?.summary.includes("unchanged"));
  });

  it("covers BCD adjust ops with their emulator flag sets", () => {
    const cases: [string, string[]][] = [
      ["aaa", ["AF", "CF"]],
      ["aas", ["AF", "CF"]],
      ["daa", ["CF", "PF", "AF", "ZF", "SF", "OF"]],
      ["das", ["CF", "PF", "AF", "ZF", "SF", "OF"]],
      ["aam", ["CF", "PF", "ZF", "SF", "OF"]],
      ["aad", ["CF", "PF", "ZF", "SF", "OF"]],
    ];
    for (const [op, expected] of cases) {
      const out = describeAlu({
        instrs: [{ op, args: [], ln: 1 }],
        ip: 0,
        reg,
        flags,
      });
      assert.ok(out?.isAluOp, op);
      assert.deepEqual(out?.affectedFlags, expected, op);
    }
  });

  it("returns null past the last instruction", () => {
    assert.equal(describeAlu({ instrs: [], ip: 0, reg, flags }), null);
  });
});
