/**
 * Uppercase memory-operand + case-insensitivity coverage.
 * Run: bun test lib/emulator
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import { createMachine } from "./machine";

function runSource(src: string, input = "", limit = 500_000) {
  const program = assemble(src);
  const m = createMachine(program);
  if (input) m.enqueueInput(input);
  let guard = 0;
  while (!m.halted && !m.err && guard++ < limit) {
    if (m.waitingForInput) {
      throw new Error("Program waited for input (queue empty)");
    }
    m.step();
  }
  if (m.err) throw new Error(m.err);
  if (!m.halted) throw new Error("Program did not halt");
  return m;
}

function memByte(m: ReturnType<typeof createMachine>, name: string): number {
  const v = m.a.dataVars[name.toLowerCase()];
  if (!v) throw new Error(`Unknown var ${name}`);
  return m.mem[v.addr]!;
}

function memWord(m: ReturnType<typeof createMachine>, name: string): number {
  const v = m.a.dataVars[name.toLowerCase()];
  if (!v) throw new Error(`Unknown var ${name}`);
  return m.mem[v.addr]! | (m.mem[v.addr + 1]! << 8);
}

describe("addressing modes with uppercase registers", () => {
  const ADDR_MODES_SRC = `.MODEL SMALL
.STACK 100H
.DATA
A DW 1111H
B DW 2222H
ARR DW 0001H,0002H,0003H
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 MOV AX, 1234H
 MOV BX, AX
 MOV CX, A
 LEA SI, ARR
 MOV DX, [SI]
 MOV AX, [SI+2]
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`;

  it("reads ARR[0] and ARR[1] through uppercase [SI]", () => {
    const m = runSource(ADDR_MODES_SRC);
    assert.equal(m.reg.bx, 0x1234);
    assert.equal(m.reg.cx, 0x1111);
    assert.equal(m.reg.dx, 0x0001);
    // AH is overwritten by 4Ch exit; AL keeps ARR[1] low byte
    assert.equal(m.reg.ax & 0xff, 0x02);
  });

  it("sums a byte array through uppercase [SI] in a loop", () => {
    const m = runSource(`.MODEL SMALL
.STACK 100H
.DATA
ARR DB 02H,04H,06H,08H,0AH
SUM DB ?
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA SI, ARR
 MOV CX, 05H
 MOV AL, 00H
ADD_ARRAY:
 ADD AL, [SI]
 INC SI
 LOOP ADD_ARRAY
 MOV SUM, AL
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(memByte(m, "SUM"), 0x1e);
    assert.equal(m.reg.si, 5);
  });

  it("reads a row-major matrix element through uppercase [SI]", () => {
    const m = runSource(`.MODEL SMALL
.STACK 100H
.DATA
MAT DB 01H,02H,03H,04H,05H,06H
VALUE DB ?
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA SI, MAT
 MOV AL, 1
 MOV BL, 3
 MUL BL
 ADD AL, 2
 MOV AH, 00H
 ADD SI, AX
 MOV AL, [SI]
 MOV VALUE, AL
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(memByte(m, "VALUE"), 0x06);
  });
});

describe("string search all paths with uppercase [SI]", () => {
  const prog = (key: string) => `.MODEL SMALL
.STACK 100H
.DATA
STR DB 'ASSEMBLY$'
FOUND DB 'A found.$'
NOTFOUND DB 'A not found.$'
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA SI, STR
SEARCH_LOOP:
 MOV AL, [SI]
 CMP AL, '$'
 JE NOT_FOUND
 CMP AL, '${key}'
 JE FOUND_LABEL
 INC SI
 JMP SEARCH_LOOP
FOUND_LABEL:
 LEA DX, FOUND
 MOV AH, 09H
 INT 21H
 JMP END_SEARCH
NOT_FOUND:
 LEA DX, NOTFOUND
 MOV AH, 09H
 INT 21H
END_SEARCH:
 NOP
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`;

  it("finds first char 'A'", () => {
    assert.equal(runSource(prog("A")).output, "A found.");
  });

  it("finds middle char 'E'", () => {
    assert.equal(runSource(prog("E")).output, "A found.");
  });

  it("finds last char 'Y'", () => {
    assert.equal(runSource(prog("Y")).output, "A found.");
  });

  it("reports absent char 'Z' as not found (halts, no infinite loop)", () => {
    assert.equal(runSource(prog("Z")).output, "A not found.");
  });
});

describe("emu8086 case-insensitivity — registers in memory operands", () => {
  const byteProg = (memOp: string) => `.MODEL SMALL
.STACK 100H
.DATA
ARR DB 0AAH, 0BBH, 0CCH
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA SI, ARR
 MOV AL, ${memOp}
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`;

  it("[SI]/[si]/[Si]/[sI] all read ARR[0]", () => {
    for (const op of ["[SI]", "[si]", "[Si]", "[sI]"]) {
      const m = runSource(byteProg(op));
      assert.equal(m.reg.ax & 0xff, 0xaa, op);
    }
  });

  it("[SI+2]/[si+2]/[SI + 2] all read ARR[2]", () => {
    for (const op of ["[SI+2]", "[si+2]", "[SI + 2]", "[si + 2]"]) {
      const m = runSource(byteProg(op));
      assert.equal(m.reg.ax & 0xff, 0xcc, op);
    }
  });

  it("[BX]/[DI] uppercase read base element", () => {
    const bx = runSource(`.MODEL SMALL
.STACK 100H
.DATA
ARR DB 011H,022H,033H
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA BX, ARR
 MOV AL, [BX]
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(bx.reg.ax & 0xff, 0x11);

    const di = runSource(`.MODEL SMALL
.STACK 100H
.DATA
ARR DB 011H,022H,033H
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA DI, ARR
 MOV AL, [DI]
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(di.reg.ax & 0xff, 0x11);
  });

  it("ARR[SI]/arr[si]/Arr[Si] all honor the index", () => {
    const src = (op: string) => `.MODEL SMALL
.STACK 100H
.DATA
ARR DB 05H, 03H, 08H
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 MOV SI, 1
 MOV AL, ${op}
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`;
    for (const op of ["ARR[SI]", "arr[si]", "Arr[Si]", "ARR[si]"]) {
      const m = runSource(src(op));
      assert.equal(m.reg.ax & 0xff, 0x03, op);
    }
  });

  it("[BX+SI]/[bx+si]/MARK[BX][SI] combine registers", () => {
    const src = (op: string) => `.MODEL SMALL
.STACK 100H
.DATA
MARK DB 010H,020H,030H,040H
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA BX, MARK
 MOV SI, 2
 MOV AL, ${op}
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`;
    for (const op of ["[BX+SI]", "[bx+si]", "[Bx+Si]"]) {
      const m = runSource(src(op));
      assert.equal(m.reg.ax & 0xff, 0x30, op);
    }
    const m2 = runSource(`.MODEL SMALL
.STACK 100H
.DATA
MARK DB 010H,020H,030H,040H
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 MOV BX, 1
 MOV SI, 2
 MOV AL, MARK[BX][SI]
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(m2.reg.ax & 0xff, 0x40);
  });

  it("BYTE PTR / WORD PTR prefixes are case-insensitive", () => {
    const b = runSource(`.MODEL SMALL
.STACK 100H
.DATA
ARR DB 0AAH, 0BBH
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA SI, ARR
 MOV AL, BYTE PTR [SI]
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(b.reg.ax & 0xff, 0xaa);

    const w = runSource(`.MODEL SMALL
.STACK 100H
.DATA
ARR DW 01234H
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA SI, ARR
 MOV AX, WORD PTR [SI]
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(w.reg.ax & 0xff, 0x34);
  });
});

describe("emu8086 case-insensitivity — opcodes, directives, numbers", () => {
  it("mixed-case program assembles and runs", () => {
    const m = runSource(`.MODEL small
.stack 100H
.DATA
A dw 0005H
B dw 0003h
R dw ?
.code
main PROC
 mov ax, @data
 mov ds, ax
 Mov AX, A
 MOV bx, B
 XCHG ax, BX
 add AX, bx
 sub ax, 0001h
 inc AX
 dec BX
 neg bx
 mov R, AX
 mov ah, 4Ch
 int 21H
main ENDP
END MAIN`);
    assert.equal(memWord(m, "R"), 0x0008);
  });

  it("hex/binary suffixes H/h/B/b and @DATA/@data", () => {
    const m = runSource(`.MODEL SMALL
.STACK 100h
.DATA
A DB 00001111b
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 MOV AL, A
 SHL AL, 1
 MOV AH, 4Ch
 INT 21h
MAIN ENDP
END main`);
    assert.equal(m.reg.ax & 0xff, 0x1e);
  });

  it("DUP in any case", () => {
    for (const dup of ["DUP", "dup", "Dup"]) {
      const m = runSource(`.MODEL SMALL
.STACK 100H
.DATA
SRC DB 'TEST$'
DST DB 5 ${dup}('$')
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 MOV ES, AX
 CLD
 LEA SI, SRC
 LEA DI, DST
 MOV CX, 05H
 REP MOVSB
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
      assert.equal(m.mem[m.a.dataVars["dst"]!.addr], "T".charCodeAt(0), dup);
    }
  });

  it("LEA vs OFFSET (any case) resolve the same address", () => {
    const lea = runSource(`.MODEL SMALL
.STACK 100H
.DATA
MSG DB 'Hi$'
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA DX, MSG
 MOV AH, 09H
 INT 21H
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    const off = runSource(`.model small
.stack 100h
.data
msg db 'Hi$'
.code
main proc
 mov ax, @data
 mov ds, ax
 mov dx, offset msg
 mov ah, 09h
 int 21h
 mov ah, 4ch
 int 21h
main endp
end main`);
    assert.equal(lea.output, "Hi");
    assert.equal(off.output, "Hi");
  });

  it("semicolon inside quotes is not a comment", () => {
    const m = runSource(`.MODEL SMALL
.STACK 100H
.DATA
MSG DB 'a;b$'
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA DX, MSG
 MOV AH, 09H
 INT 21H
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(m.output, "a;b");
  });
});

describe("arithmetic spot checks — no regression", () => {
  it("MOV/XCHG/ADD/SUB/INC/DEC/NEG sequence", () => {
    const m = runSource(`.MODEL SMALL
.STACK 100H
.DATA
A DW 0005H
B DW 0003H
R DW ?
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 MOV AX, A
 MOV BX, B
 XCHG AX, BX
 ADD AX, BX
 SUB AX, 0001H
 INC AX
 DEC BX
 NEG BX
 MOV R, AX
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(memWord(m, "R"), 8);
  });

  it("counter-controlled sum loop", () => {
    const m = runSource(`.MODEL SMALL
.STACK 100H
.DATA
N DB 05H
SUM DB ?
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 MOV CX, 0000H
 MOV CL, N
 MOV AL, 00H
 MOV BL, 01H
SUM_LOOP:
 ADD AL, BL
 INC BL
 LOOP SUM_LOOP
 MOV SUM, AL
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`);
    assert.equal(memByte(m, "SUM"), 15);
  });

  it("two-digit decimal input echoes back", () => {
    const m = runSource(`.MODEL SMALL
.STACK 100H
.DATA
PROMPT DB 'Enter two digits: $'
OUTMSG DB 0DH,0AH,'Decimal value: $'
.CODE
MAIN PROC
 MOV AX, @DATA
 MOV DS, AX
 LEA DX, PROMPT
 MOV AH, 09H
 INT 21H
 MOV AH, 01H
 INT 21H
 SUB AL, '0'
 MOV BL, 10
 MUL BL
 MOV BH, AL
 MOV AH, 01H
 INT 21H
 SUB AL, '0'
 ADD BH, AL
 LEA DX, OUTMSG
 MOV AH, 09H
 INT 21H
 MOV AL, BH
 MOV AH, 00H
 MOV BL, 10
 DIV BL
 MOV BH, AH
 ADD AL, '0'
 MOV DL, AL
 MOV AH, 02H
 INT 21H
 ADD BH, '0'
 MOV DL, BH
 MOV AH, 02H
 INT 21H
 MOV AH, 4CH
 INT 21H
MAIN ENDP
END MAIN`, "42");
    assert.ok(m.output.includes("42"));
  });
});
