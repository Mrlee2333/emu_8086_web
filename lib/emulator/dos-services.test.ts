/**
 * DOS and BIOS service tests: the file system, the polling services, and the
 * video services a program reads back.
 * Run: bun test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import { DosFiles } from "./dos-files";
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

  it("takes AH=3Bh as a change of directory, not an open", () => {
    const m = runToDone(
      `    lea dx, fname
    mov ah, 3bh
    int 21h`,
      NAMES,
    );
    assert.equal(m.flags.CF, 0, "an 8.3 name is the one directory there is");
    assert.equal(
      m.files.exists("notes.txt"),
      false,
      "changing directory must not have opened the file it named",
    );

    const missing = runToDone(
      `    lea dx, path
    mov ah, 3bh
    int 21h`,
      NAMES + "    path db 'sub\\dir', 0\n",
    );
    assert.equal(missing.flags.CF, 1);
    assert.equal(missing.reg.ax, 3, "path not found");
  });

  it("reads the access mode from the low two bits of AL", () => {
    // AL=10h sets the sharing mode, not the access mode: this is a read.
    const sharing = runToDone(
      `    lea dx, fname
    mov cx, 0
    mov ah, 3ch
    int 21h
    mov bx, ax
    mov ah, 3eh
    int 21h
    lea dx, fname
    mov ax, 3d10h
    int 21h
    mov bx, ax
    lea dx, text
    mov cx, 5
    mov ah, 40h
    int 21h`,
      NAMES,
    );
    assert.equal(sharing.flags.CF, 1, "AL=10h is read only, so the write is refused");
    assert.equal(sharing.reg.ax, 5, "access denied");
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

describe("the file system behind the services", () => {
  it("keeps handle numbers in range across many open and close cycles", () => {
    const files = new DosFiles();
    for (let i = 0; i < 200; i++) {
      const made = files.create("loop.txt");
      assert.ok(made.ok, `cycle ${i} failed`);
      assert.ok(
        made.value >= 5 && made.value <= 36,
        `handle drifted to ${made.value} on cycle ${i}`,
      );
      assert.ok(files.close(made.value).ok);
    }
  });

  it("still creates the thirty-third file", () => {
    // What runs out is open handles, not the number of names a session has seen.
    const files = new DosFiles();
    for (let i = 0; i < 32; i++) {
      const made = files.create(`file${i}.txt`);
      assert.ok(made.ok, `file ${i} refused`);
      assert.ok(files.close(made.value).ok);
    }
    assert.ok(files.exists("file31.txt"), "earlier files are still there to delete");
  });

  it("allows a second open of the same file, as the default sharing mode does", () => {
    // Sharing bits are ignored, which leaves DOS's default: compatibility, so a
    // program may hold the same file open more than once.
    const files = new DosFiles();
    const made = files.create("twice.txt");
    assert.ok(made.ok);
    const first = files.open("twice.txt");
    const second = files.open("twice.txt");
    assert.ok(first.ok && second.ok);
    if (first.ok && second.ok) {
      assert.notEqual(first.value, second.value, "each open has its own handle");
    }
  });

  it("refuses an open when 32 handles are already out", () => {
    const files = new DosFiles();
    for (let i = 0; i < 32; i++) {
      assert.ok(files.create(`open${i}.txt`).ok);
    }
    const tooMany = files.create("extra.txt");
    assert.equal(tooMany.ok, false);
    assert.ok(!tooMany.ok && tooMany.code === 4, "too many open files");
  });

  it("refuses a write to a file opened for reading", () => {
    const files = new DosFiles();
    const made = files.create("ro.txt");
    assert.ok(made.ok);
    assert.ok(files.close(made.value).ok);
    const opened = files.open("ro.txt", "read");
    assert.ok(opened.ok);
    if (!opened.ok) return;
    const written = files.write(opened.value, new Uint8Array([1, 2, 3]));
    assert.equal(written.ok, false);
    assert.ok(!written.ok && written.code === 5, "access denied");
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

  it("leaves the key in the queue when it polls (INT 16h AH=01h)", () => {
    // Polling reports what is waiting; it must not take it, or a program that
    // polls before every read loses the first key it found.
    const program = assemble(`.model small
.data
.code
main proc
    mov ah, 01h
    int 16h
    mov bl, al
    mov ah, 01h
    int 16h
    mov cl, al
    mov ah, 00h
    int 16h
    mov ah, 4ch
    int 21h
end main`);
    const m = createMachine(program);
    m.enqueueInput("Q");
    let guard = 0;
    while (!m.halted && !m.err && guard++ < 50) {
      if (m.waitingForInput) break;
      m.step();
    }
    assert.equal(m.err, null);
    assert.equal(m.reg.bx & 0xff, "Q".charCodeAt(0), "the first poll saw it");
    assert.equal(m.reg.cx & 0xff, "Q".charCodeAt(0), "and still sees it");
    assert.equal(m.waitingForInput, false, "the read after the polls got it");
    assert.equal(m.reg.ax & 0xff, "Q".charCodeAt(0));
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

  it("accepts a graphics pixel and a palette instead of stopping the program", () => {
    const m = runToDone(
      `    mov al, 14
    mov cx, 10
    mov dx, 10
    mov ah, 0ch
    int 10h
    mov al, 0
    mov ah, 10h
    int 10h
    mov al, 0
    mov ah, 10h
    int 10h
    xor ax, ax
    mov ah, 4ch
    int 21h`,
    );
    assert.equal(m.err, null, "a text console ignores both, it does not halt");
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
