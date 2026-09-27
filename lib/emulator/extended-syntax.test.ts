/**
 * Assembler and interpreter features that go past the classroom minimum:
 * EQU constants, constant expressions, code-segment data, dispatch tables,
 * shift and rotate flags, and the calling convention.
 * Run: bun test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import { createMachine } from "./machine";

/**
 * Assemble and run the body, stopping at `done` so the register values can be
 * read before the exit sequence has its say over AX.
 */
function run(body: string, data = ""): ReturnType<typeof createMachine> {
  const program = assemble(`.model small
.stack 100h
.data
${data}
.code
main proc
${body}
done:
    mov ah, 4ch
    int 21h
main endp
end main`);
  const m = createMachine(program);
  const stop = program.labels["done"]!;
  let guard = 0;
  while (!m.halted && !m.err && m.ip !== stop && guard++ < 100_000) m.step();
  if (m.err) throw new Error(m.err);
  return m;
}

function runSource(src: string): string {
  const program = assemble(src);
  const m = createMachine(program);
  let guard = 0;
  while (!m.halted && !m.err && guard++ < 500_000) m.step();
  if (m.err) throw new Error(m.err);
  return m.output;
}

describe("EQU and constant expressions", () => {
  it("defines a constant and uses it as an immediate", () => {
    const m = run(
      `    mov cx, HOWMANY
    mov ax, 0
    add ax, cx`,
      "    HOWMANY EQU 7",
    );
    assert.equal(m.reg.cx, 7);
    assert.equal(m.reg.ax, 7);
  });

  it("evaluates arithmetic on constants", () => {
    const m = run(
      `    mov ax, CELLS`,
      "    N EQU 4\n    CELLS EQU N * N - 1",
    );
    assert.equal(m.reg.ax, 15);
  });

  it("measures a block with $ minus its label", () => {
    const m = run(
      `    mov ax, SPAN
    mov cx, TEXTLEN`,
      `    TEXT DB 'HELLO'
    SPAN EQU $ - TEXT
    OTHER DB 'ABCDE'
    TEXTLEN EQU $ - TEXT`,
    );
    assert.equal(m.reg.ax, 5);
    assert.equal(m.reg.cx, 10);
  });

  it("uses a constant as a DUP count", () => {
    const program = assemble(`.model small
.data
    CELLS EQU 3
    ROW   DW CELLS DUP(7)
.code
    mov ax, 0
    ret
end`);
    const row = program.dataVars["row"]!;
    assert.equal(row.count, 3);
    assert.deepEqual([...program.mem.slice(row.addr, row.addr + 6)], [
      7, 0, 7, 0, 7, 0,
    ]);
  });

  it("reads octal with the Q suffix", () => {
    const m = run(`    mov ax, 101Q`);
    assert.equal(m.reg.ax, 65);
  });

  it("refuses to fold a division by zero into a value", () => {
    assert.throws(() => {
      assemble(`.model small
.data
    NOPE EQU 5 / 0
.code
    ret
end`);
    }, /Cannot evaluate constant|Bad value/);
  });

  it("refuses an undefined name that looks like a function", () => {
    // `FOO(5)` must not become 5, or a misspelt LENGTH or SIZE hides as a
    // number and the program is wrong in a way nothing reports.
    assert.throws(() => {
      assemble(`.model small
.data
    N EQU FOO(5)
.code
    ret
end`);
    }, /Cannot evaluate constant|Bad value/);
    assert.throws(() => {
      assemble(`.model small
.data
    ARR db 1, 2, 3
    N DW LENGHT(ARR)
.code
    ret
end`);
    }, /Cannot evaluate constant|Bad value/);
  });

  it("prefers a symbol to a number when a name is spelled like one", () => {
    // EACH is four, not 0xEAC, which is what the trailing H would say.
    const m = run(`    mov cx, EACH
    mov ax, 0
    add ax, cx`, "    EACH EQU 4");
    assert.equal(m.reg.cx, 4);
    assert.equal(m.reg.ax, 4);
  });

  it("still reads a symbol whose name is all hex digits", () => {
    const m = run(`    mov ax, 0ffffh
    xor ax, ax
    add ax, DEAD`, "    DEAD EQU 0beefh");
    assert.equal(m.reg.ax & 0xffff, 0xbeef);
  });

  it("reads NOT as a unary operator in an operand", () => {
    const m = run(`    mov al, MASK
    mov ax, 0
    and al, NOT 00000100B`, "    MASK EQU 00000100B");
    assert.equal(m.reg.ax & 0xff, 0);
  });
});

describe("code segment data", () => {
  it("declares data in the code segment, as a COM program does", () => {
    const out = runSource(`.model small
.code
org 100h
start:
    jmp main_code
    msg db 'In the code segment', 0dh, 0ah, '$'
main_code:
    lea dx, msg
    mov ah, 09h
    int 21h
    mov ah, 4ch
    int 21h
end start`);
    assert.equal(out, "In the code segment\n");
  });
});

describe("dispatch tables and indirect jumps", () => {
  it("stores code labels in a table and jumps through it", () => {
    const out = runSource(`.model small
.data
    handlers dw zero, one
    choice   dw 1
    zero_msg db 'zero$'
    one_msg  db 'one$'
.code
main proc
    mov ax, [choice]
    shl ax, 1
    jmp [handlers + ax]
zero:
    lea dx, zero_msg
    jmp report
one:
    lea dx, one_msg
report:
    mov ah, 09h
    int 21h
    mov ah, 4ch
    int 21h
main endp
end main`);
    assert.equal(out, "one");
  });

  it("calls through a register", () => {
    const out = runSource(`.model small
.code
main proc
    mov bx, offset twice
    call bx
    mov ah, 4ch
    int 21h
main endp
twice proc
    mov dl, '2'
    mov ah, 2
    int 21h
    ret
twice endp
end main`);
    assert.equal(out, "2");
  });
});

describe("shift and rotate flags", () => {
  it("keeps the carry that shl shifts out", () => {
    const m = run(`    mov ax, 8001h
    shl ax, 1`);
    assert.equal(m.reg.ax, 0x0002);
    assert.equal(m.flags.CF, 1, "bit 15 left through the top");
  });

  it("sets overflow on a single shift from the old sign against the new", () => {
    const m = run(`    mov ax, 4000h
    shl ax, 1`);
    assert.equal(m.reg.ax, 0x8000);
    assert.equal(m.flags.CF, 0);
    assert.equal(m.flags.OF, 1, "the result turned negative");
  });

  it("takes the carry from shr into the flags, and popf puts it back", () => {
    const m = run(`    mov ax, 3
    shr ax, 1
    pushf
    mov ax, 0ffffh
    popf
    mov ax, 0
    jnc no_carry
    mov ax, 1
no_carry:`);
    assert.equal(m.reg.ax, 1);
  });

  it("rotates the carry through the operand with rcr", () => {
    const into = run(`    stc
    mov si, 0001h
    rcr si, 1`);
    assert.equal(into.reg.si, 0x8000, "the old carry enters at the top");
    assert.equal(into.flags.CF, 1, "the bit that left is the new carry");

    const outOf = run(`    clc
    mov si, 0001h
    rcr si, 1`);
    assert.equal(outOf.reg.si, 0x0000);
    assert.equal(outOf.flags.CF, 1);
  });

  it("shifts a word out to nothing at a count of one whole width", () => {
    const m = run(`    mov ax, 1234h
    mov cl, 16
    shl ax, cl`);
    assert.equal(m.reg.ax, 0, "sixteen left shifts leave nothing behind");
    assert.equal(m.flags.CF, 0, "the last bit to leave is bit 0");
  });

  it("fills with the sign on a right shift past the width", () => {
    const m = run(`    mov ax, 8000h
    mov cl, 16
    sar ax, cl`);
    assert.equal(m.reg.ax, 0xffff, "a negative value shifts in its own sign");
    assert.equal(m.flags.CF, 1);
  });

  it("comes full circle for a rotate of one whole width", () => {
    const m = run(`    mov ax, 1234h
    mov cl, 16
    rol ax, cl
    ror ax, cl`);
    assert.equal(m.reg.ax, 0x1234, "sixteen rotations land where they started");
  });

  it("counts a byte rotate through carry in nine steps", () => {
    const whole = run(`    clc
    mov al, 81h
    mov cl, 9
    rcr al, cl`);
    assert.equal(whole.reg.ax & 0xff, 0x81, "eight bits plus the carry is nine steps");

    const over = run(`    clc
    mov al, 81h
    mov cl, 10
    rcr al, cl`);
    assert.equal(over.reg.ax & 0xff, 0x40, "ten steps is one step past");
    assert.equal(over.flags.CF, 1);
  });

  it("counts a word rotate through carry in seventeen steps", () => {
    // Sixteen bits plus the carry is seventeen, not nine: the rotate unit is
    // as wide as the value it turns.
    const whole = run(`    clc
    mov ax, 8001h
    mov cl, 17
    rcr ax, cl`);
    assert.equal(whole.reg.ax, 0x8001, "seventeen steps is a whole turn");

    // Nine steps into a word: the value turns right nine times, and the carry
    // that leaves the bottom on the first step comes back in at the top.
    const nine = run(`    clc
    mov ax, 8001h
    mov cl, 9
    rcr ax, cl`);
    assert.equal(nine.reg.ax, 0x0140, "nine steps is not a whole turn of a word");
  });
});

describe("calling convention", () => {
  it("pushes the return address, so a frame can find its arguments", () => {
    const program = assemble(`.model small
.code
main proc
    mov ax, 7
    push ax
    mov ax, 12
    push ax
    call area
    add sp, 4
    mov ah, 4ch
    int 21h
main endp
area proc
    push bp
    mov bp, sp
    mov ax, [bp+4]
    add ax, [bp+6]
    pop bp
    ret
area endp
end main`);
    const m = createMachine(program);
    const stop = program.labels["main"]! + 6;
    let guard = 0;
    while (!m.halted && !m.err && m.ip !== stop && guard++ < 1000) m.step();
    assert.equal(m.err, null);
    assert.equal(m.reg.ax, 19, "12 + 7 read back through the frame");
  });

  it("takes the argument count in RET from a constant", () => {
    // `RET N` has to see through a name: dropping it would leave the caller's
    // arguments on the stack.
    const program = assemble(`.model small
.data
    TWO EQU 2
.code
main proc
    mov sp, 1000h
    mov ax, 11
    push ax
    mov ax, 22
    push ax
    call twice
    ret
main endp
twice proc
    add sp, TWO
    ret TWO
twice endp
end main`);
    const m = createMachine(program);
    let guard = 0;
    while (!m.halted && !m.err && guard++ < 1000) m.step();
    assert.equal(m.err, null);
    assert.equal(m.reg.sp, 0x1000, "the caller found its stack as it left it");
  });

  it("returns the same way for IRET as for RET", () => {
    // `INT` pushes nothing in this flat model, so an IRET has to read the
    // memory stack like a RET rather than only the call-stack mirror, or the
    // mirror and SP drift apart.
    const program = assemble(`.model small
.code
main proc
    call sub
    ret
main endp
sub proc
    push bp
    mov bp, sp
    int 21h
    iret
sub endp
end main`.replace("int 21h", "mov ah, 4ch\n    int 21h"));
    const m = createMachine(program);
    let guard = 0;
    while (!m.halted && !m.err && guard++ < 1000) m.step();
    assert.equal(m.err, null);
    assert.equal(m.halted, true, "IRET returned to the caller and the run ended");
  });

  it("leaves the stack alone when a call cannot be made", () => {
    // The destination is settled before the frame is pushed, so a bad target
    // cannot leave half a call behind for Step Back to restore.
    const program = assemble(`.model small
.code
main proc
    mov sp, 2000h
    call nowhere
    ret
end main`);
    const m = createMachine(program);
    let guard = 0;
    while (!m.halted && !m.err && guard++ < 100) m.step();
    assert.ok(m.err, "an unknown label is an error");
    assert.equal(m.reg.sp, 0x2000, "SP never moved");
  });

  it("removes the arguments itself with RET n", () => {
    const out = runSource(`.model small
.code
main proc
    mov ax, 30
    push ax
    call show
    mov ah, 4ch
    int 21h
show proc
    push ax
    push bx
    push dx
    mov bx, 10
    xor cx, cx
split:
    xor dx, dx
    div bx
    push dx
    inc cx
    or ax, ax
    jnz split
emit:
    pop dx
    add dl, '0'
    mov ah, 2
    int 21h
    loop emit
    pop dx
    pop bx
    pop ax
    ret 2
show endp
end main`);
    assert.equal(out, "30");
  });
});

describe("multiply", () => {
  it("multiplies signed bytes into ax", () => {
    const m = run(`    mov al, 0f8h
    mov bl, 9
    imul bl`);
    assert.equal(m.reg.ax, 0xffb8, "-8 times 9 is -72 as a word");
  });

  it("multiplies signed words into dx:ax", () => {
    const m = run(`    mov ax, 0fff8h
    mov bx, 3
    imul bx`);
    assert.equal(m.reg.ax, 0xffe8);
    assert.equal(m.reg.dx, 0xffff);
  });

  it("has the two and three operand forms", () => {
    const m = run(`    mov bx, 100
    imul ax, bx, 3
    mov dx, 0
    imul dx, bx, 5`);
    assert.equal(m.reg.ax, 300);
    assert.equal(m.reg.dx, 500);
  });
});

describe("flags transfer", () => {
  it("loads the flags into AH, not AL", () => {
    const m = run(`    sub bx, bx
    stc
    lahf
    xor al, al`);
    assert.equal(m.reg.ax & 0xff00, 0x4700, "ZF, PF and CF");
    assert.equal(m.reg.ax & 0xff, 0);
  });

  it("pushes a word that reads F2 in the top byte, as the 8086 does", () => {
    const m = run(`    cli
    pushf
    pop ax`);
    assert.equal(m.reg.ax, 0xf002, "bits 12 to 15 read as one");
  });
});

describe("ports", () => {
  it("reads back what was written to a port", () => {
    const m = run(`    mov al, 0a5h
    out 40h, al
    in al, 40h
    xor ah, ah`);
    assert.equal(m.reg.ax & 0xff, 0xa5);
  });

  it("keeps word and byte ports apart", () => {
    const m = run(`    mov ax, 1234h
    out 60h, ax
    in al, 60h
    xor ah, ah`);
    assert.equal(m.reg.ax & 0xff, 0x34);
  });
});

describe("operand forms", () => {
  it("reads a direct operand written without brackets", () => {
    const m = run(
      `    mov ax, seen + 2`,
      "    seen db 1, 2, 3, 4",
    );
    assert.equal(m.reg.ax & 0xff, 3);
  });

  it("accepts WORD PTR on a bare label", () => {
    const m = run(
      `    mov word ptr count, 40h
    mov ax, count`,
      "    count dw 0",
    );
    assert.equal(m.reg.ax, 0x40);
  });

  it("adds a negative displacement in brackets", () => {
    const m = run(
      `    lea si, cells + 6
    mov ax, [si-2]`,
      "    cells db 10, 20, 30, 40, 50, 60, 70",
    );
    assert.equal(m.reg.ax & 0xff, 50);
  });
});
