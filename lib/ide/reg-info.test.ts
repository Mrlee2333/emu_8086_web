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
    // The order the compact panel has always used, so the panel and the
    // Details dialog cannot end up reading differently.
    assert.deepEqual(names, [
      "AX",
      "BX",
      "CX",
      "DX",
      "SI",
      "DI",
      "BP",
      "SP",
      "DS",
      "ES",
      "SS",
      "CS",
      "IP",
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
      assert.equal(
        v.high?.value,
        m.get8(hi.toLowerCase() as never),
        `${hi} disagrees`,
      );
      assert.equal(
        v.low?.value,
        m.get8(lo.toLowerCase() as never),
        `${lo} disagrees`,
      );
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
    assert.equal(m.get8("al"), 42, "AAD folded AH*10 + AL into AL");
    assert.equal(m.get8("ah"), 0, "AAD cleared AH");
  });

  it("agrees with get8 on the word MUL and DIV path, not just the byte one", () => {
    // The byte cases above all leave CX alone and write only AX, so a view that
    // read the halves out of the wrong register would still pass them. Word MUL
    // writes the high half into DX, which is the case a two-byte split has to
    // get right. Two programs rather than one, because a later DIV would
    // overwrite the DX the MUL wrote and the assertion would be vacuous.
    const mul = run(`.model small
.stack 100h
.code
main proc
    mov ax, 0FFFFh
    mov bx, 0002h
    mul bx              ; DX:AX = 0001:FFFE
    main endp
    end main`);
    assert.equal(mul.reg.dx, 0x0001, "word MUL put the high word in DX");
    assert.equal(mul.reg.ax, 0xfffe, "and the low word in AX");
    const mulViews = describeRegisters(mul.reg, mul.ip);
    assert.equal(byName(mulViews, "DX").high?.value, mul.get8("dh"), "DH");
    assert.equal(byName(mulViews, "DX").low?.value, mul.get8("dl"), "DL");
    // Unequal halves: 0xFFFE and 0x0001 differ in every byte, so a swapped
    // half or a wrong mask cannot produce these numbers.
    assert.equal(byName(mulViews, "DX").high?.value, 0x00);
    assert.equal(byName(mulViews, "DX").low?.value, 0x01);

    const div = run(`.model small
.stack 100h
.code
main proc
    mov dx, 0001h
    mov ax, 0000h
    mov bx, 0002h
    div bx              ; AX = 8000h quotient, DX = 0 remainder
    main endp
    end main`);
    assert.equal(div.reg.ax, 0x8000, "word DIV put the quotient in AX");
    assert.equal(div.reg.dx, 0x0000, "and the remainder in DX");
    const divViews = describeRegisters(div.reg, div.ip);
    assert.equal(byName(divViews, "AX").high?.value, div.get8("ah"), "AH");
    assert.equal(byName(divViews, "AX").low?.value, div.get8("al"), "AL");
    assert.equal(byName(divViews, "AX").high?.value, 0x80);
    assert.equal(byName(divViews, "AX").low?.value, 0x00);
  });

  it("groups a byte's binary in nibbles, so the two halves read as bytes", () => {
    // The bug this catches: grouping by two gives "00 01 00 10", which looks
    // like four separate values rather than one eight-bit one. The word was
    // always right, so a test on AX alone would never have found it.
    const reg = blank();
    reg.ax = 0x1234;
    const ax = byName(describeRegisters(reg, 0), "AX");
    assert.equal(ax.high?.binary, "0001 0010", "AH = 12h");
    assert.equal(ax.low?.binary, "0011 0100", "AL = 34h");
    assert.equal(ax.binary, "0001 0010 0011 0100");
    // Every byte in the table, at both extremes, so no value groups wrong.
    for (const value of [0x00, 0x01, 0x80, 0xff, 0xa5]) {
      const r = blank();
      r.bx = (value << 8) | (value ^ 0xff);
      const bx = byName(describeRegisters(r, 0), "BX");
      for (const byte of [bx.high!, bx.low!]) {
        const groups = byte.binary.split(" ");
        assert.equal(groups.length, 2, `${byte.hex} is not two groups`);
        for (const g of groups) {
          assert.equal(g.length, 4, `"${g}" is not a nibble`);
        }
        assert.equal(
          groups.join(""),
          byte.value.toString(2).padStart(8, "0"),
          `${byte.hex} does not round-trip`,
        );
      }
    }
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
    assert.equal(
      byName(describeRegisters(reg, 0), "AX").high?.printable,
      null,
      "BEL is a control character",
    );
  });

  it("marks the segments and IP as having no byte halves", () => {
    const views = describeRegisters(blank(), 0);
    assert.equal(byName(views, "DS").high, null);
    assert.equal(byName(views, "ES").low, null);
    assert.equal(byName(views, "SP").high, null);
    assert.equal(
      byName(views, "SP").low,
      null,
      "SP is a pointer, not a data register",
    );
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

/**
 * The purpose sentences are documentation shown to a learner, so a wrong one
 * teaches the wrong thing. Each claim below is checked against what the
 * emulator actually does, because "CX is the high half of DX:AX" and "only
 * IRET restores IP" were both confidently wrong and both sounded plausible.
 */
describe("register purposes match the emulator", () => {
  function purposeOf(name: string): string {
    return byName(describeRegisters(blank(), 0), name).purpose;
  }

  it("names the count register by what actually drives it", () => {
    // A previous version of this test asserted only that the *old* wording was
    // gone, which guards the wording rather than the truth: it would have
    // passed against a sentence that was wrong in a new way. So the claims
    // themselves are run instead.
    const cx = purposeOf("CX");
    assert.ok(!cx.includes("DX:AX"), "CX is not part of the DX:AX pair");
    assert.ok(!/CBW|CWD/.test(cx), "CBW and CWD never touch CX");

    // What CX really is: a count that LOOP and REP drive, and the shift count
    // in a form like SHL AX, CL.
    const loop = run(`.model small
.stack 100h
.code
main proc
    mov cx, 0003h
    dec cx
    main endp
    end main`);
    assert.equal(loop.reg.cx, 2, "LOOP's counter is CX");

    const shifted = run(`.model small
.stack 100h
.code
main proc
    mov ax, 0001h
    mov cl, 04h
    shl ax, cl
    main endp
    end main`);
    assert.equal(shifted.reg.ax, 0x0010, "CL is the shift count");
    assert.equal(shifted.reg.cx, 0x0004, "and CX holds it");

    // And the pair is AX and DX, which is what the earlier sentence claimed.
    const m = run(`.model small
.stack 100h
.code
main proc
    mov cx, 1111h
    mov ax, 0FFFFh
    mov bx, 0002h
    mul bx
    main endp
    end main`);
    assert.equal(m.reg.cx, 0x1111, "word MUL does not touch CX");
    assert.equal(m.reg.dx, 0x0001, "it is DX that takes the high word");
  });

  it("does not credit CBW with filling DX, and does not credit CX with anything", () => {
    // CBW sign-extends AL into AX; only CWD writes DX. Neither touches CX.
    const cbw = run(`.model small
.stack 100h
.code
main proc
    mov cx, 1111h
    mov ax, 0000h
    mov al, 80h
    cbw
    main endp
    end main`);
    assert.equal(cbw.reg.ax, 0xff80, "CBW sign-extended AL into AX");
    assert.equal(cbw.reg.dx, 0x0000, "and left DX alone");
    assert.equal(cbw.reg.cx, 0x1111, "and left CX alone");

    const cwd = run(`.model small
.stack 100h
.code
main proc
    mov cx, 1111h
    mov ax, 8000h
    cwd
    main endp
    end main`);
    assert.equal(cwd.reg.dx, 0xffff, "CWD is the one that fills DX");
    assert.equal(cwd.reg.cx, 0x1111, "and it still leaves CX alone");

    const dx = purposeOf("DX");
    assert.ok(/CWD/.test(dx), "the DX sentence names CWD");
    assert.ok(
      !/CBW and CWD put the sign/.test(dx),
      "CBW does not put anything in DX",
    );
    assert.ok(
      !/CBW/.test(dx),
      "CBW targets AX, so the DX sentence should not mention it at all",
    );
  });

  it("does not call AX an implicit operand of the shifts", () => {
    // `SHL AX, 1` names AX explicitly, and the count is an operand either way.
    // The implicit-operand story for a shift is CL, which is CX's sentence.
    const ax = purposeOf("AX");
    assert.ok(!/implicit operand of the word shifts/.test(ax));
    const explicit = run(`.model small
.stack 100h
.code
main proc
    mov ax, 0001h
    mov cl, 04h
    shl ax, 1
    main endp
    end main`);
    assert.equal(explicit.reg.ax, 0x0002, "a literal count of 1 ignores CL");
  });

  it("does not credit BX with being a string-instruction base", () => {
    const bx = purposeOf("BX");
    assert.ok(
      !bx.includes("implicit base of the string"),
      "the string instructions move through SI and DI, not BX",
    );
    // BX is genuinely untouched by a string op, and genuinely the XLAT index.
    const m = run(`.model small
.stack 100h
.data
t db 'A','B','C','D'
.code
main proc
    mov bx, 0DEADh
    mov si, offset t
    mov di, 100h
    movsb
    main endp
    end main`);
    assert.equal(m.reg.bx, 0xdead, "MOVSB leaves BX alone");
    assert.ok(purposeOf("SI").includes("string"), "SI is the source offset");
    assert.ok(
      purposeOf("DI").includes("string"),
      "DI is the destination offset",
    );
  });

  it("does not say only IRET restores the instruction pointer", () => {
    const ip = purposeOf("IP");
    assert.ok(!ip.includes("only IRET"), "RET restores IP as well");
    // And RET really does: a CALL/RET pair returns and the program finishes.
    const m = run(`.model small
.stack 100h
.code
main proc
    call sub1
    mov ah, 4ch
    int 21h
sub1 proc
    ret
sub1 endp
end main`);
    assert.equal(m.err, null, "CALL then RET completed");
    assert.equal(
      m.halted,
      true,
      "and the run ended rather than falling through",
    );
  });

  it("distinguishes AAD and AAM from the packed-BCD adjust instructions", () => {
    const aad = instructionNote("aad")!;
    assert.ok(aad.includes("unpacked"), "AAD works on unpacked BCD");
    assert.ok(
      !/adjusts AL after a packed/.test(aad),
      "that description belongs to DAA and DAS",
    );
    assert.ok(
      instructionNote("daa")?.includes("packed"),
      "DAA is the packed one",
    );
    // AAD combines and AAM divides, and they are inverses.
    const m = run(`.model small
.stack 100h
.code
main proc
    mov ax, 0402h
    aad                 ; AL = 4*10 + 2
    main endp
    end main`);
    assert.equal(m.get8("al"), 42, "AAD combines AH and AL");
    assert.equal(m.get8("ah"), 0, "and clears AH");
  });

  it("does not tell the reader a plain string op decrements CX", () => {
    for (const op of ["movsb", "movsw", "stosb", "lodsb", "scasb", "cmpsb"]) {
      const note = instructionNote(op)!;
      assert.ok(
        !/decrementing CX/.test(note),
        `${op} without REP leaves CX alone`,
      );
    }
    // A plain MOVSB really does leave CX alone; only REP counts.
    const plain = run(`.model small
.stack 100h
.data
t db 'A','B','C','D'
.code
main proc
    mov cx, 0FFFFh
    mov si, offset t
    mov di, 100h
    movsb
    main endp
    end main`);
    assert.equal(plain.reg.cx, 0xffff, "plain MOVSB does not decrement CX");
    const repeated = run(`.model small
.stack 100h
.data
t db 'A','B','C','D'
.code
main proc
    mov cx, 0004h
    mov si, offset t
    mov di, 100h
    rep movsb
    main endp
    end main`);
    assert.equal(repeated.reg.cx, 0, "REP MOVSB runs CX down to zero");
  });

  it("does not require [SI] of LES and LDS", () => {
    // Both take any memory operand; [SI] is the textbook form, not a rule.
    for (const op of ["les", "lds"]) {
      const note = instructionNote(op)!;
      assert.ok(
        !/the word at \[SI\]/.test(note),
        `${op} accepts any memory operand`,
      );
    }
    const m = run(`.model small
.stack 100h
.data
pair dw 1234h, 5678h
.code
main proc
    mov bx, offset pair
    les si, [bx]
    main endp
    end main`);
    assert.equal(m.err, null, "LES with [BX] assembles and runs");
    assert.equal(m.reg.si, 0x1234, "the word went into the register");
    assert.equal(m.reg.es, 0x5678, "and the word after it into ES");
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
    assert.equal(
      implemented,
      null,
      "RETF is not implemented, so it gets no note",
    );
  });
});
