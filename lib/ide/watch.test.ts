/**
 * Watch-expression evaluator tests (v1.3.2).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "@/lib/emulator/assemble";
import { createMachine } from "@/lib/emulator/machine";
import type { Machine } from "@/lib/emulator/machine";
import {
  evaluateWatch,
  loadWatches,
  saveWatches,
} from "./watch";

const SRC = `.model small
.data
count dw 42
msg db 'A'
.code
main proc
    mov ax, 10
    mov bl, 65
main endp
end main
`;

function steppedMachine(): Machine {
  const m = createMachine(assemble(SRC));
  m.step(); // mov ax, 10
  m.step(); // mov bl, 65
  return m;
}

describe("evaluateWatch", () => {
  it("reads 16-bit and 8-bit registers", () => {
    const m = steppedMachine();
    const ax = evaluateWatch("ax", m);
    assert.equal(ax.ok, true);
    if (ax.ok) {
      assert.equal(ax.dec, "10");
      assert.equal(ax.hex, "0x000A");
      assert.equal(ax.size, 2);
    }
    const bl = evaluateWatch("bl", m);
    assert.equal(bl.ok, true);
    if (bl.ok) {
      assert.equal(bl.dec, "65");
      assert.equal(bl.hex, "0x41");
      assert.equal(bl.ascii, "'A'");
      assert.equal(bl.size, 1);
    }
  });

  it("reads data variables with correct size", () => {
    const m = steppedMachine();
    const count = evaluateWatch("count", m);
    assert.equal(count.ok, true);
    if (count.ok) {
      assert.equal(count.dec, "42");
      assert.equal(count.size, 2);
    }
    const msg = evaluateWatch("msg", m);
    assert.equal(msg.ok, true);
    if (msg.ok) {
      assert.equal(msg.dec, "65");
      assert.equal(msg.size, 1);
    }
  });

  it("reads memory operands and numeric literals", () => {
    const m = steppedMachine();
    const direct = evaluateWatch("[0]", m);
    assert.equal(direct.ok, true);
    for (const lit of ["255", "0xFF", "FFh", "11111111b"]) {
      const r = evaluateWatch(lit, m);
      assert.equal(r.ok, true, lit);
      if (r.ok) assert.equal(r.dec, "255");
    }
    const ch = evaluateWatch("'A'", m);
    assert.equal(ch.ok, true);
    if (ch.ok) assert.equal(ch.dec, "65");
  });

  it("reports signed values", () => {
    const m = steppedMachine();
    const neg = evaluateWatch("-1", m);
    assert.equal(neg.ok, true);
    if (neg.ok) assert.equal(neg.signed, "-1");
  });

  it("returns errors without throwing", () => {
    const m = steppedMachine();
    const unknown = evaluateWatch("nope_var_xyz", m);
    assert.equal(unknown.ok, false);
    assert.equal(evaluateWatch("   ", m).ok, false);
    assert.equal(evaluateWatch("x".repeat(100), m).ok, false);
    const noMachine = evaluateWatch("ax", null);
    assert.equal(noMachine.ok, false);
  });

  it("never mutates machine state", () => {
    const m = steppedMachine();
    const before = m.capture();
    evaluateWatch("ax", m);
    evaluateWatch("[0]", m);
    evaluateWatch("nope", m);
    assert.equal(m.reg.ax, before.reg.ax);
    assert.equal(m.ip, before.ip);
    assert.equal(m.steps, before.steps);
  });
});

describe("watch persistence guards", () => {
  it("load/save do not throw without a window", () => {
    assert.deepEqual(loadWatches(), []);
    saveWatches(["ax"]);
  });
});
