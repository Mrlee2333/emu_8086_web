/**
 * Byte/word operand size, array sort, and INT 21h AH=01 input tests.
 * Run: bun test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import { createMachine } from "./machine";
import { SAMPLES } from "./samples";

function runSource(src: string, input = ""): string {
  const program = assemble(src);
  const m = createMachine(program);
  if (input) m.enqueueInput(input);
  let guard = 0;
  while (!m.halted && !m.err && guard++ < 500_000) {
    if (m.waitingForInput) {
      throw new Error("Program waited for input (queue empty)");
    }
    m.step();
  }
  if (m.err) throw new Error(m.err);
  return m.output;
}

const SORT_SRC = SAMPLES.sortArray;

describe("byte memory ops with [si]", () => {
  it("mov [si], bl writes one byte and does not zero [si+1]", () => {
    const out = runSource(`.model small
.stack 100h
.data
    array db 5, 3, 8
.code
main proc
    mov ax, @data
    mov ds, ax
    lea si, array
    mov al, [si]
    mov bl, [si+1]
    mov [si], bl
    mov [si+1], al

    mov cl, 3
    lea si, array
print_loop:
    mov dl, [si]
    add dl, 30h
    mov ah, 02h
    int 21h
    inc si
    dec cl
    jnz print_loop

    mov ah, 4ch
    int 21h
main endp
end main
`);
    assert.equal(out, "358");
  });

  it("sorts and prints a byte array", () => {
    assert.equal(runSource(SORT_SRC), "1 2 3 5 8 ");
  });

  it("prints an unsorted byte array", () => {
    assert.equal(runSource(SAMPLES.printArray), "5 3 8 1 2 ");
    assert.equal(runSource(SAMPLES.array), "5 3 8 1 2 ");
  });
});

describe("2D array memory ops with [bx][si]", () => {
  it("reads mark[bx][si] as mark + bx + si", () => {
    const out = runSource(`.model small
.stack 100h
.data
    mark db 10, 20, 15, 11, 0, 0, 0, 0
         db 12, 15, 16, 18, 0, 0, 0, 0
.code
main proc
    mov ax, @data
    mov ds, ax
    mov bx, 8
    mov si, 2
    mov al, mark[bx][si]
    add al, 30h
    mov dl, al
    mov ah, 02h
    int 21h
    mov ah, 4ch
    int 21h
main endp
end main
`);
    assert.equal(out, "@");
  });

  it("writes mark[bx][si] without disturbing neighboring cells", () => {
    const out = runSource(`.model small
.stack 100h
.data
    mark db 10, 20, 15, 11, 0, 0, 0, 0
         db 12, 15, 16, 18, 0, 0, 0, 0
.code
main proc
    mov ax, @data
    mov ds, ax
    mov bx, 0
    mov si, 1
    mov dl, 25
    mov mark[bx][si], dl
    mov cl, 4
    mov si, 0
print_loop:
    mov dl, mark[bx][si]
    add dl, 30h
    mov ah, 02h
    int 21h
    inc si
    dec cl
    jnz print_loop
    mov ah, 4ch
    int 21h
main endp
end main
`);
    assert.equal(out, ":I?;");
  });
});

describe("INT 21h AH=01 Enter is CR, not a newline", () => {
  const src = `.model small
.stack 100h
.data
.code
main proc
    mov ax, @data
    mov ds, ax

    lp:
        mov ah, 01h
        int 21h
        cmp al, 0dh
        je done
        jmp lp
    done:
    mov ah, 02h
    mov dl, 0dh
    int 21h
    mov dl, 0ah
    int 21h
    mov dl, 'X'
    int 21h

    mov ah, 4ch
    int 21h
main endp
end main
`;

  it("echoes digits and treats Enter as CR so program newline is one line", () => {
    assert.equal(runSource(src, "12\r"), "12\nX");
  });

  it("normalizes pasted LF to DOS CR (0Dh)", () => {
    assert.equal(runSource(src, "12\n"), "12\nX");
  });

  it("does not insert a blank line between echo and program CR/LF", () => {
    const out = runSource(src, "7\r");
    assert.equal(out, "7\nX");
    assert.equal(out.split("\n").length, 2);
  });
});
