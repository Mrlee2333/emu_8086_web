/**
 * Extended Value Viewer tests (v1.5.3 — every base, and both bytes).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "@/lib/emulator/assemble";
import { dosByteToPrintable } from "@/lib/emulator/cp437";
import { createMachine } from "@/lib/emulator/machine";
import type { Machine } from "@/lib/emulator/machine";
import type { Reg8Name, Registers } from "@/lib/emulator/types";
import { describeRegisters } from "./reg-info";
import { describeValue } from "./value-view";

function blank(): Registers {
  return {
    ax: 0,
    bx: 0,
    cx: 0,
    dx: 0,
    si: 0,
    di: 0,
    bp: 0,
    sp: 0xfffe,
    ds: 0,
    es: 0,
    ss: 0,
    cs: 0,
  } as Registers;
}

/** The viewer for one register, looked up the way the dialog looks it up. */
function view(reg: Registers, name: string, ip = 0) {
  const v = describeRegisters(reg, ip).find((x) => x.name === name);
  assert.ok(v, `no view for ${name}`);
  return describeValue(v);
}

/** The viewer's reading of a half, by the register name and "H" or "L". */
function half(
  reg: Registers,
  name: string,
  side: "H" | "L",
  ip = 0,
) {
  const v = view(reg, name, ip);
  const byte = side === "H" ? v.high : v.low;
  assert.ok(byte, `${name} has no ${side}`);
  return byte;
}

/** Run `src` to completion and hand back the machine. */
function run(src: string): Machine {
  const m = createMachine(assemble(src));
  let guard = 0;
  while (!m.halted && !m.err && guard++ < 2000) m.step();
  assert.equal(m.err, null);
  return m;
}

/** The viewer for a register read back off a running machine. */
function live(m: Machine, name: string) {
  const v = describeRegisters(m.reg, m.ip).find((x) => x.name === name);
  assert.ok(v, `no view for ${name}`);
  return describeValue(v);
}

describe("describeValue", () => {
  it("reads one word as the original emu8086 viewer does", () => {
    // The reference screen: AX holding 0xA341, which is 41793 unsigned and
    // -23743 signed, with AH = 0xA3 = 163 = -93 and AL = 0x41 = 65.
    const reg = { ...blank(), ax: 0xa341 };
    const ax = view(reg, "AX");
    assert.equal(ax.hex, "0xA341");
    assert.equal(ax.binary, "1010 0011 0100 0001");
    assert.equal(ax.unsigned, 41793);
    assert.equal(ax.signed, -23743);
    assert.equal(ax.high?.hex, "A3");
    assert.equal(ax.high?.binary, "1010 0011");
    assert.equal(ax.high?.octal, "243");
    assert.equal(ax.high?.unsigned, 163);
    assert.equal(ax.high?.signed, -93);
    assert.equal(ax.low?.hex, "41");
    assert.equal(ax.low?.binary, "0100 0001");
    assert.equal(ax.low?.octal, "101");
    assert.equal(ax.low?.unsigned, 65);
    assert.equal(ax.low?.signed, 65);
  });

  it("names the two halves of the register, not H and L", () => {
    // AH and AL are how a program names them, so a beginner looking for the
    // byte they just wrote has to find it under the name they used.
    assert.equal(half({ ...blank(), ax: 0x1234 }, "AX", "H").name, "AH");
    assert.equal(half({ ...blank(), ax: 0x1234 }, "AX", "L").name, "AL");
    assert.equal(half({ ...blank(), bx: 0x1234 }, "BX", "H").name, "BH");
    assert.equal(half({ ...blank(), bx: 0x1234 }, "BX", "L").name, "BL");
  });

  it("writes octal with no prefix and no leading zero", () => {
    // The original viewer has no "0o" and pads nothing, so "0" and "377" are
    // the two ends the octal column has to reach.
    assert.equal(half({ ...blank(), ax: 0x0000 }, "AX", "L").octal, "0");
    assert.equal(half({ ...blank(), ax: 0xffff }, "AX", "H").octal, "377");
    assert.equal(half({ ...blank(), ax: 0xffff }, "AX", "L").octal, "377");
  });

  it("converts octal at the boundaries where a base stops agreeing", () => {
    // 0x3F is the last byte whose octal ends in 7, 0x40 the first that ends in
    // 0 with a carry. Converting by dividing by eight and truncating gets
    // every other value right, so only the edges can catch it.
    const cases: [number, string][] = [
      [0x00, "0"],
      [0x07, "7"],
      [0x08, "10"],
      [0x3f, "77"],
      [0x40, "100"],
      [0x7f, "177"],
      [0x80, "200"],
      [0xff, "377"],
    ];
    for (const [byte, octal] of cases) {
      const reg = { ...blank(), ax: byte << 8 };
      assert.equal(
        half(reg, "AX", "H").octal,
        octal,
        `0x${byte.toString(16).padStart(2, "0")}`,
      );
    }
  });

  it("shows a high byte as the console would draw it, not as ASCII", () => {
    // 0xA3 is not ASCII: read as Latin-1 it is a control code, and read as
    // CP437 it is "ú" — which is what the console above the registers is
    // already printing. A character cell that disagreed with the console would
    // be teaching the wrong map. 0xFF is the one byte left out, because it has
    // no glyph of its own and the next test covers what it shows instead.
    for (let byte = 0x80; byte < 0xff; byte++) {
      assert.equal(
        half({ ...blank(), ax: byte << 8 }, "AX", "H").char,
        dosByteToPrintable(byte),
        `0x${byte.toString(16).padStart(2, "0")}`,
      );
    }
  });

  it("keeps the glyph of every byte that has one of its own", () => {
    for (let byte = 0x21; byte < 0x7f; byte++) {
      assert.equal(
        half({ ...blank(), ax: byte << 8 }, "AX", "H").char,
        String.fromCharCode(byte),
        `0x${byte.toString(16).padStart(2, "0")}`,
      );
    }
    // 0x7F is the house in CP437, not the ASCII delete. Reading it as ASCII
    // would show nothing at all, so a cell would be blank rather than wrong.
    assert.equal(half({ ...blank(), ax: 0x007f }, "AX", "L").char, "⌂");
    // Space and the reserved byte are labelled instead, because a cell holding
    // one of them would read as a value that is missing.
    assert.equal(half({ ...blank(), ax: 0x2000 }, "AX", "H").char, "spa");
    assert.equal(half({ ...blank(), ax: 0xff00 }, "AX", "H").char, "res");
  });

  it("names a byte that has no glyph a reader could see", () => {
    // CP437 draws a control code as a trigram, so printing 0x0D raw would put
    // "♪" in a row about a carriage return. The cell falls back to the same
    // label the character map gives it.
    assert.equal(half({ ...blank(), ax: 0x0000 }, "AX", "L").char, "null");
    assert.equal(half({ ...blank(), ax: 0x000d }, "AX", "L").char, "cret");
    assert.equal(half({ ...blank(), ax: 0x000a }, "AX", "L").char, "newl");
    assert.equal(half({ ...blank(), ax: 0x0007 }, "AX", "L").char, "beep");
    assert.equal(half({ ...blank(), ax: 0x4100 }, "AX", "H").char, "A");
  });

  it("has no halves for a register the 8086 does not split", () => {
    // SI, DI, BP, SP and the segments are 16-bit only. A fabricated AH there
    // would name a register the CPU cannot read.
    for (const name of ["SI", "DI", "BP", "SP", "DS", "ES", "SS", "CS"]) {
      const v = view(blank(), name);
      assert.equal(v.high, null, `${name} high`);
      assert.equal(v.low, null, `${name} low`);
    }
    const ip = view(blank(), "IP", 0x00ff);
    assert.equal(ip.high, null);
    assert.equal(ip.unsigned, 255);
  });

  it("still shows the word for a register with no halves", () => {
    // SI has no AH, but 0x1234 is still a number, and the 16-bit rows are the
    // only reading of it, so they cannot go blank with the halves.
    const si = view({ ...blank(), si: 0x1234 }, "SI");
    assert.equal(si.hex, "0x1234");
    assert.equal(si.binary, "0001 0010 0011 0100");
    assert.equal(si.unsigned, 4660);
  });

  it("agrees with Machine.get8 for every half, on real machine state", () => {
    // The viewer reads the halves out of the RegView the details view already
    // renders, so what has to be proved is that those halves are the CPU's own
    // once instructions have written them.
    const m = run(`
      mov ax, 1234h
      mov bx, 0abcdh
      mov cx, 0ff00h
      mov dx, 8000h
    `);
    for (const [name, h, l] of [
      ["AX", "ah", "al"],
      ["BX", "bh", "bl"],
      ["CX", "ch", "cl"],
      ["DX", "dh", "dl"],
    ] as [string, Reg8Name, Reg8Name][]) {
      const v = live(m, name);
      assert.equal(v.high?.value, m.get8(h), `${name} H`);
      assert.equal(v.low?.value, m.get8(l), `${name} L`);
    }
  });

  it("agrees with get8 after an instruction that writes only one half", () => {
    // MOV AH,1 leaves AL alone. A split reading the wrong half of the word
    // passes every test where both halves are written together.
    const m = run(`
      mov ax, 0
      mov al, 41h
      mov ah, 1
    `);
    const ax = live(m, "AX");
    assert.equal(ax.high?.value, m.get8("ah"));
    assert.equal(ax.low?.value, m.get8("al"));
    assert.equal(ax.hex, "0x0141");
    assert.equal(ax.low?.char, "A");
    assert.equal(ax.low?.octal, "101");
  });

  it("agrees with get8 after XLAT, which indexes a table with BX and writes AL", () => {
    // XLAT is the one instruction a 16-bit-only view cannot be checked by eye,
    // because both halves of AX are in play: BH indexes, AL lands.
    const m = run(`
      mov bx, 0
      mov si, 0
      mov byte ptr [bx + si], 'Z'
      mov al, 0
      xlat
    `);
    const ax = live(m, "AX");
    assert.equal(ax.low?.value, m.get8("al"));
    assert.equal(ax.low?.char, "Z");
  });

  it("agrees with get8 after word MUL, which writes AX and DX together", () => {
    const m = run(`
      mov ax, 1000
      mov bx, 3000
      mul bx
    `);
    for (const [name, h, l] of [
      ["AX", "ah", "al"],
      ["DX", "dh", "dl"],
    ] as [string, Reg8Name, Reg8Name][]) {
      const v = live(m, name);
      assert.equal(v.high?.value, m.get8(h), name);
      assert.equal(v.low?.value, m.get8(l), name);
    }
    assert.equal(live(m, "AX").unsigned, (1000 * 3000) & 0xffff);
  });

  it("agrees with get8 after byte MUL, which puts the half product in AH", () => {
    // The one instruction where AH is an output rather than an operand, so it
    // is the case most likely to be read from the wrong end of the word. It
    // also overwrites AL, so the low half here is the remainder 88, not the
    // 200 that went in.
    const m = run(`
      mov al, 200
      mov bl, 3
      mul bl
    `);
    const ax = live(m, "AX");
    assert.equal(ax.low?.value, m.get8("al"));
    assert.equal(ax.high?.value, m.get8("ah"));
    assert.equal(ax.low?.value, 88);
    assert.equal(ax.high?.value, 2);
    assert.equal(ax.unsigned, 600);
  });

  it("signs the word from -32768 to 32767", () => {
    assert.equal(view({ ...blank(), ax: 0x7fff }, "AX").signed, 32767);
    assert.equal(view({ ...blank(), ax: 0x8000 }, "AX").signed, -32768);
    assert.equal(view({ ...blank(), ax: 0xffff }, "AX").signed, -1);
    assert.equal(view({ ...blank(), ax: 0x0000 }, "AX").signed, 0);
  });

  it("signs each byte from -128 to 127", () => {
    assert.equal(half({ ...blank(), ax: 0x7f80 }, "AX", "H").signed, 127);
    assert.equal(half({ ...blank(), ax: 0x8080 }, "AX", "H").signed, -128);
    assert.equal(half({ ...blank(), ax: 0x7fff }, "AX", "L").signed, -1);
    assert.equal(half({ ...blank(), ax: 0x0080 }, "AX", "L").signed, -128);
  });

  it("masks a value that has been given more than 16 bits", () => {
    // The emulator keeps the register record to a word, but a caller handing
    // this a wider number must not get a hex string five digits long.
    const v = view({ ...blank(), ax: 0x1a2b3c4d }, "AX");
    assert.equal(v.hex, "0x3C4D");
    assert.equal(v.unsigned, 0x3c4d);
    assert.equal(v.high?.value, 0x3c);
    assert.equal(v.low?.value, 0x4d);
  });

  it("does not mutate the register record it is given", () => {
    const reg = { ...blank(), ax: 0xa341 };
    const before = JSON.stringify(reg);
    view(reg, "AX");
    assert.equal(JSON.stringify(reg), before);
  });

  it("copies the halves rather than sharing the RegView's objects", () => {
    // Both dialogs read the same RegView. Handing back its own objects would
    // let a later edit to the details view change what the viewer had already
    // rendered, and nothing would say so.
    const source = describeRegisters({ ...blank(), ax: 0xa341 }, 0)[0];
    const v = describeValue(source);
    assert.notEqual(v.high, source.high);
    assert.notEqual(v.low, source.low);
    assert.deepEqual(v.high, describeValue(source).high);
  });
});
