/**
 * Register description tests (v1.5.1 — the CPU-registers Details view).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "@/lib/emulator/assemble";
import { createMachine } from "@/lib/emulator/machine";
import type { Machine } from "@/lib/emulator/machine";
import type { Reg16Name, Registers } from "@/lib/emulator/types";
import { describeRegisters, instructionNote } from "./reg-info";

function blank(): Registers {
  return {
    ax: 0, bx: 0, cx: 0, dx: 0, si: 0, di: 0,
    bp: 0, sp: 0xfffe, ds: 0, es: 0, ss: 0, cs: 0,
  } as Registers;
}

function byName(views: ReturnType<typeof describeRegisters>, name: string) {
  const v = views.find((x) => x.name === name);
  assert.ok(v, `no view for ${name}`);
  return v;
}

/** Run `src` to completion and hand back the machine. */
function run(src: string): Machine {
  const m = createMachine(assemble(src));
  let guard = 0;
  while (!m.halted && !m.err && guard++ < 2000) m.step();
  assert.equal(m.err, null);
  return m;
}

describe("describeRegisters", () => {
  it("lists every register in the 8086's own order", () => {
    const names = describeRegisters(blank(), 0).map((v) => v.name);
    assert.deepEqual(names, [
      "AX", "BX", "CX", "DX", "SI", "DI", "BP", "SP",
      "CS", "DS", "SS", "ES", "IP",
    ]);
  });

  it("gives a purpose sentence to every register", () => {
    for (const v of describeRegisters(blank(), 0)) {
      assert.ok(v.purpose.length > 20, `${v.name} has no usable purpose`);
    }
  });

  it("splits AX into AH and AL, and nothing else", () => {
    const views = describeRegisters(blank(), 0);
    const halves = views
      .filter((v) => v.high || v.low)
      .map((v) => `${v.high?.name}${v.low?.name}`);
    assert.deepEqual(halves, ["AHAL", "BHBL", "CHCL", "DHDL"]);
  });

  it("puts the high byte in AH and the low byte in AL", () => {
    const reg = blank();
    reg.ax = 0x1234;
    const ax = byName(describeRegisters(reg, 0), "AX");
    assert.equal(ax.value, 0x1234);
    assert.equal(ax.hex, "0x1234");
    assert.equal(ax.high?.value, 0x12);
    assert.equal(ax.low?.value, 0x34);
    assert.equal(ax.high?.hex, "12");
    assert.equal(ax.low?.hex, "34");
  });

  it("keeps the halves when the two bytes are equal", () => {
    // The failure a byte-only test would miss: a mask applied to the wrong
    // half still reads 0xFF here.
    const reg = blank();
    reg.bx = 0xffff;
    const bx = byName(describeRegisters(reg, 0), "BX");
    assert.equal(bx.high?.hex, "FF");
    assert.equal(bx.low?.hex, "FF");
  });

  it("reads the high byte as zero when only the low byte is set", () => {
    const reg = blank();
    reg.cx = 0x00ff;
    const cx = byName(describeRegisters(reg, 0), "CX");
    assert.equal(cx.high?.value, 0);
    assert.equal(cx.low?.value, 0xff);
  });

  it("matches Machine.get8 for every high and low byte", () => {
    // The view derives the halves itself, so the thing that has to be proved
    // is that it agrees with the CPU's own byte reader on real machine state.
    const m = run(`.model small
.stack 100h
.code
main proc
    mov ax, 0BEADh
    mov bx, 0DEADh
    mov cx, 0001h
    mov dx, 8000h
    mov si, 00FFh
    mov di, 7F80h
    add ax, 1111h
    mov dl, 41h
    mov bl, 0C3h
    main endp
    end main`);
    const views = describeRegisters(m.reg, m.ip);
    const pairs: [Reg16Name, string, string][] = [
      ["ax", "AH", "AL"],
      ["bx", "BH", "BL"],
      ["cx", "CH", "CL"],
      ["dx", "DH", "DL"],
    ];
    for (const [reg, hi, lo] of pairs) {
      const v = byName(views, reg.toUpperCase());
      assert.equal(v.high?.value, m.get8(hi.toLowerCase() as never), `${hi} disagrees`);
      assert.equal(v.low?.value, m.get8(lo.toLowerCase() as never), `${lo} disagrees`);
    }
  });

  it("agrees with get8 after the instructions that write halves", () => {
    // MUL, DIV, XLAT, AAM and AAD are the ones that leave AX or DX holding a
    // value whose two bytes mean different things, which is exactly where a
    // swapped high/low would show.
    const m = run(`.model small
.stack 100h
.data
table db 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'
.code
main proc
    mov al, 03h
    mov bl, 07h
    mul bl              ; AX = 21h
    mov al, 40h
    mov bl, 05h
    mul bl              ; AX = 0140h
    mov ax, 0064h
    mov bl, 0Ah
    div bl              ; AX = 0006 quotient, remainder 4
    mov bx, offset table
    mov al, 05h
    xlat                ; AL = 'F', AH untouched
    mov al, 0Ah
    aam                 ; AH = 1, AL = 0
    mov ax, 0402h
    aad                 ; AL = 4*10 + 2 = 42, AH = 0
    main endp
    end main`);
    const views = describeRegisters(m.reg, m.ip);
    for (const [reg, hi, lo] of [
      ["ax", "ah", "al"],
      ["bx", "bh", "bl"],
    ] as const) {
      const v = byName(views, reg.toUpperCase());
      assert.equal(v.high?.value, m.get8(hi), `${reg} high byte`);
      assert.equal(v.low?.value, m.get8(lo), `${reg} low byte`);
      assert.equal((v.value >> 8) & 0xff, m.get8(hi), `${reg} value high byte`);
      assert.equal(v.value & 0xff, m.get8(lo), `${reg} value low byte`);
    }
    // A spot check that the run itself did what the claims above say.
    assert.equal(m.get8("al"), 42, "AAD folded AH*10 + AH's remainder into AL");
    assert.equal(m.get8("ah"), 0, "AAD cleared AH");
  });

  it("shows the signed and unsigned reading of the same word", () => {
    const reg = blank();
    reg.ax = 0xffff;
    const ax = byName(describeRegisters(reg, 0), "AX");
    assert.equal(ax.dec, 65535);
    assert.equal(ax.signed, -1);
    assert.equal(ax.binary, "1111 1111 1111 1111");
    reg.ax = 0x8000;
    assert.equal(byName(describeRegisters(reg, 0), "AX").signed, -32768);
    reg.ax = 0x7fff;
    assert.equal(byName(describeRegisters(reg, 0), "AX").signed, 32767);
  });

  it("signs a byte from -128 to 127", () => {
    const reg = blank();
    reg.dx = 0x80ff;
    const dx = byName(describeRegisters(reg, 0), "DX");
    assert.equal(dx.high?.signed, -128);
    assert.equal(dx.high?.dec, 128);
    assert.equal(dx.low?.signed, -1);
  });

  it("shows a printable character only where there is one", () => {
    const reg = blank();
    reg.ax = 0x4100;
    const ax = byName(describeRegisters(reg, 0), "AX");
    assert.equal(ax.high?.printable, "'A'");
    assert.equal(ax.low?.printable, null, "a zero byte is not a space");
    reg.ax = 0x0741;
    assert.equal(byName(describeRegisters(reg, 0), "AX").low?.printable, "'A'");
    assert.equal(byName(describeRegisters(reg, 0), "AX").high?.printable, null, "BEL is a control character");
  });

  it("marks the segments and IP as having no byte halves", () => {
    const views = describeRegisters(blank(), 0);
    assert.equal(byName(views, "DS").high, null);
    assert.equal(byName(views, "ES").low, null);
    assert.equal(byName(views, "SP").high, null);
    assert.equal(byName(views, "SP").low, null, "SP is a pointer, not a data register");
    assert.equal(byName(views, "IP").kind, "instruction");
    assert.equal(byName(views, "DS").kind, "segment");
    assert.equal(byName(views, "AX").kind, "general");
  });

  it("passes the instruction pointer through rather than reading it from reg", () => {
    // IP is not a key of `Registers`; it is a separate field on the machine, so
    // a view built from the record alone would have to be handed it.
    const views = describeRegisters(blank(), 0x0154);
    assert.equal(byName(views, "IP").value, 0x0154);
    assert.equal(byName(views, "IP").hex, "0x0154");
  });

  it("masks a value that has been given more than 16 bits", () => {
    const reg = blank();
    reg.ax = 0x1_2345;
    const ax = byName(describeRegisters(reg, 0), "AX");
    assert.equal(ax.value, 0x2345);
    assert.equal(ax.hex, "0x2345");
  });

  it("does not mutate the register record it is given", () => {
    const reg = blank();
    reg.ax = 0xabcd;
    const before = { ...reg };
    describeRegisters(reg, 0x100);
    assert.deepEqual(reg, before);
  });
});

describe("instructionNote", () => {
  it("names the registers the string instructions use without saying so", () => {
    const note = instructionNote("movsb");
    assert.ok(note);
    assert.ok(note.includes("SI"));
    assert.ok(note.includes("DI"));
    assert.ok(note.includes("CX"));
  });

  it("covers the pair of halves for MUL and DIV", () => {
    assert.ok(instructionNote("mul")?.includes("DX:AX"));
    assert.ok(instructionNote("div")?.includes("AH"));
  });

  it("says nothing about an instruction with no implied operand", () => {
    assert.equal(instructionNote("mov"), null);
    assert.equal(instructionNote("NOP"), null);
  });

  it("is case-insensitive, because the assembler is", () => {
    assert.equal(instructionNote("MOVSB"), instructionNote("movsb"));
  });

  it("describes only instructions the emulator actually runs", () => {
    // A note for an op with no case in the interpreter would promise something
    // the emulator cannot do, which is worse than no note.
    const implemented = instructionNote("retf");
    assert.equal(implemented, null, "RETF is not implemented, so it gets no note");
  });
});
