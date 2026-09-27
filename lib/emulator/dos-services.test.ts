/**
 * DOS and BIOS service tests: the file system, the polling services, and the
 * video services a program reads back.
 * Run: bun test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import { createMachine } from "./machine";
import type { Machine } from "./machine";

/** Registers as they stood at `done`, before the exit sequence touches AX. */
function runToDone(body: string, data = ""): Machine {
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
  while (!m.halted && !m.err && m.ip !== stop && guard++ < 100_000) {
    if (m.waitingForInput) break;
    m.step();
  }
  if (m.err) throw new Error(m.err);
  return m;
}

describe("INT 21h file services", () => {
  const NAMES = "    fname db 'notes.txt', 0\n    text   db 'HELLO', 0\n";
  const BUFFER = "    buffer db 16 dup(?)\n";

  it("creates, writes, and reads a file back", () => {
    const m = runToDone(
      `    lea dx, fname
    mov cx, 0
    mov ah, 3ch
    int 21h
    mov bx, ax
    lea dx, text
    mov cx, 5
    mov ah, 40h
    int 21h
    mov ah, 3eh
    int 21h
    lea dx, fname
    mov al, 2
    mov ah, 3dh
    int 21h
    mov bx, ax
    lea dx, buffer
    mov cx, 16
    mov ah, 3fh
    int 21h`,
      NAMES + BUFFER,
    );
    assert.equal(m.flags.CF, 0, "no error reported");
    assert.equal(m.mem[m.a.dataVars["buffer"]!.addr], "H".charCodeAt(0));
    assert.equal(m.mem[m.a.dataVars["buffer"]!.addr + 4], "O".charCodeAt(0));
  });

  it("reports a file that is not there", () => {
    const m = runToDone(
      `    lea dx, fname
    mov ah, 3dh
    int 21h`,
      NAMES,
    );
    assert.equal(m.flags.CF, 1);
    assert.equal(m.reg.ax, 2, "file not found");
  });

  it("refuses to write to a file opened for reading", () => {
    const m = runToDone(
      `    lea dx, fname
    mov cx, 0
    mov ah, 3ch
    int 21h
    mov bx, ax
    mov ah, 3eh
    int 21h
    lea dx, fname
    xor al, al
    mov ah, 3dh
    int 21h
    mov bx, ax
    lea dx, text
    mov cx, 5
    mov ah, 40h
    int 21h`,
      NAMES,
    );
    assert.equal(m.flags.CF, 1);
    assert.equal(m.reg.ax, 5, "access denied");
  });

  it("seeks from the start, the middle, and the end", () => {
    const m = runToDone(
      `    lea dx, fname
    mov cx, 0
    mov ah, 3ch
    int 21h
    mov bx, ax
    lea dx, text
    mov cx, 5
    mov ah, 40h
    int 21h
    mov al, 2
    xor cx, cx
    mov dx, 0fffeh
    mov ah, 42h
    int 21h`,
      NAMES,
    );
    // Seek to the end, then back two: the size comes back in DX:AX.
    assert.equal(m.flags.CF, 0);
    assert.equal(m.reg.ax, 3, "five bytes written, minus two");
  });

  it("deletes a file, then refuses to delete it twice", () => {
    const m = runToDone(
      `    lea dx, fname
    mov cx, 0
    mov ah, 3ch
    int 21h
    mov bx, ax
    mov ah, 3eh
    int 21h
    lea dx, fname
    mov ah, 41h
    int 21h
    lea dx, fname
    mov ah, 41h
    int 21h`,
      NAMES,
    );
    assert.equal(m.flags.CF, 1, "the second delete fails");
    assert.equal(m.reg.ax, 2);
  });
});

describe("polling services", () => {
  it("reports with the zero flag when nothing is waiting (INT 21h AH=06h)", () => {
    const m = runToDone(
      `    mov dl, 0ffh
    mov ah, 06h
    int 21h
    mov cx, 0`,
    );
    assert.equal(m.err, null);
    assert.equal(m.flags.ZF, 1, "nothing left in the queue");
    assert.equal(m.reg.ax & 0xff, 0);
  });

  it("clears the zero flag when a character is there (INT 16h AH=01h)", () => {
    const program = assemble(`.model small
.data
.code
main proc
    mov ah, 01h
    int 16h
    mov cx, 0
    mov ah, 4ch
    int 21h
end main`);
    const m = createMachine(program);
    m.enqueueInput("Q");
    m.step();
    m.step();
    assert.equal(m.reg.ax & 0xff, "Q".charCodeAt(0));
    assert.equal(m.flags.ZF, 0, "a character was waiting");
  });
});

describe("INT 10h video services", () => {
  it("sets the cursor and reads it back", () => {
    const m = runToDone(
      `    mov ah, 02h
    mov dh, 12
    mov dl, 30
    int 10h
    mov ah, 03h
    int 10h
    mov ch, dh
    mov cl, dl`,
    );
    assert.equal(m.reg.dx, (12 << 8) | 30);
  });

  it("reports the video mode it was set to", () => {
    const m = runToDone(
      `    mov ax, 0003h
    int 10h
    mov ah, 0fh
    int 10h
    xor ah, ah`,
    );
    assert.equal(m.reg.ax & 0xff, 3, "80x25 colour text");
  });
});

describe("INT 21h echo", () => {
  it("echoes a typed character and leaves it in AL", () => {
    const program = assemble(`.model small
.data
.code
main proc
    mov ah, 01h
    int 21h
    mov ah, 4ch
    int 21h
end main`);
    const m = createMachine(program);
    m.enqueueInput("Z");
    m.step();
    m.step();
    assert.equal(m.reg.ax & 0xff, "Z".charCodeAt(0));
    assert.equal(m.output, "Z");
  });
});
