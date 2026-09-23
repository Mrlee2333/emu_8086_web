/**
 * DOS console CR/LF cursor semantics + CP437 mapping tests.
 * Run: bun test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import {
  CP437_CHARS,
  cp437Char,
  dosByteToPrintable,
  getCp437Entry,
} from "./cp437";
import { DosConsole } from "./dos-console";
import { createMachine } from "./machine";

function runSource(src: string): string {
  const program = assemble(src);
  const m = createMachine(program);
  let guard = 0;
  while (!m.halted && !m.err && guard++ < 500_000) {
    m.step();
  }
  if (m.err) throw new Error(m.err);
  return m.output;
}

const header = `.model small
.stack 100h
.data
.code
main proc
    mov ax, @data
    mov ds, ax
    mov ah, 02h
`;

const footer = `
    mov ah, 4ch
    int 21h
main endp
end main
`;

describe("CP437 map", () => {
  it("has 256 glyphs", () => {
    assert.equal(CP437_CHARS.length, 256);
  });

  it("uses classic DOS control glyphs", () => {
    assert.equal(cp437Char(0x01), "☺");
    assert.equal(cp437Char(0x02), "☻");
    assert.equal(cp437Char(0x03), "♥");
    assert.equal(cp437Char(0x0e), "♫");
    assert.equal(cp437Char(0x0f), "☼");
    assert.equal(cp437Char(0x7f), "⌂");
    assert.equal(cp437Char(0xfe), "■");
  });

  it("exposes NUL / SOH metadata for tooltips", () => {
    const nul = getCp437Entry(0);
    assert.equal(nul.char, "NUL");
    assert.equal(nul.meaning, "NUL");
    assert.equal(nul.fullForm, "Null");

    const soh = getCp437Entry(1);
    assert.equal(soh.char, "☺");
    assert.equal(soh.meaning, "SOH");
    assert.equal(soh.fullForm, "Start of Heading");
  });

  it("maps console control bytes without glyphs", () => {
    assert.equal(dosByteToPrintable(0x00), "");
    assert.equal(dosByteToPrintable(0x07), "");
    assert.equal(dosByteToPrintable(0x0a), "\n");
    assert.equal(dosByteToPrintable(0x0d), "\r");
    assert.equal(dosByteToPrintable(0x01), "☺");
  });
});

describe("DosConsole cursor (CR / LF independent)", () => {
  it("LF then CR starts the next line at column 0", () => {
    const c = new DosConsole();
    c.write("1 ");
    c.write("\n"); // down, keep col 2
    c.write("\r"); // back to col 0
    c.write("1 2 ");
    assert.equal(c.text, "1 \n1 2 ");
  });

  it("CR then LF also starts the next line at column 0", () => {
    const c = new DosConsole();
    c.write("1 ");
    c.write("\r"); // col 0, same row
    c.write("\n"); // down, col stays 0
    c.write("1 2 ");
    assert.equal(c.text, "1 \n1 2 ");
  });

  it("CR alone overwrites the same line", () => {
    const c = new DosConsole();
    c.write("1 ");
    c.write("\r");
    c.write("1 2 ");
    c.write("\r");
    c.write("1 2 3 ");
    assert.equal(c.text, "1 2 3 ");
    assert.equal(c.cursorRow, 0);
  });

  it("LF alone keeps column (stair-step indent)", () => {
    const c = new DosConsole();
    c.write("1 ");
    c.write("\n");
    c.write("1 2 ");
    c.write("\n");
    c.write("1 2 3 ");
    assert.equal(c.text, "1 \n  1 2 \n      1 2 3 ");
  });
});

describe("DOS INT 21h AH=02 CR/LF", () => {
  it("LFCR is a normal new line", () => {
    const out = runSource(`${header}
    mov dl, 'A'
    int 21h
    mov dl, 0ah
    int 21h
    mov dl, 0dh
    int 21h
    mov dl, 'B'
    int 21h
${footer}`);
    assert.equal(out, "A\nB");
  });

  it("CRLF is a normal new line", () => {
    const out = runSource(`${header}
    mov dl, 'A'
    int 21h
    mov dl, 0dh
    int 21h
    mov dl, 0ah
    int 21h
    mov dl, 'B'
    int 21h
${footer}`);
    assert.equal(out, "A\nB");
  });

  it("CR only rewrites the same line", () => {
    const out = runSource(`${header}
    mov dl, '1'
    int 21h
    mov dl, ' '
    int 21h
    mov dl, 0dh
    int 21h
    mov dl, '1'
    int 21h
    mov dl, ' '
    int 21h
    mov dl, '2'
    int 21h
${footer}`);
    assert.equal(out, "1 2");
  });

  it("LF only preserves column", () => {
    const out = runSource(`${header}
    mov dl, '1'
    int 21h
    mov dl, ' '
    int 21h
    mov dl, 0ah
    int 21h
    mov dl, 'X'
    int 21h
${footer}`);
    assert.equal(out, "1 \n  X");
  });

  it("triangle sample with LFCR", () => {
    const out = runSource(`.model small
.stack 100h
.data
.code
main proc
    mov ax, @data
    mov ds, ax

    mov ah, 02h
    mov ch, 1
    OL:
        mov cl, 1
        IL:
            mov dl, cl
            add dl, 30h
            int 21h

            mov dl, ' '
            int 21h

            inc cl
            cmp cl, ch
            jle IL

            mov dl, 0ah
            int 21h

            mov dl, 0dh
            int 21h

        inc ch
        cmp ch, 9
        jle OL

    mov ah, 4ch
    int 21h
main endp
end main
`);
    const lines = out.split("\n");
    assert.equal(lines.length, 10); // 9 content lines + trailing empty after final LF before CR
    // After last row: LF creates empty line 9, CR stays on it — trailing "" line
    assert.equal(lines[0], "1 ");
    assert.equal(lines[1], "1 2 ");
    assert.equal(lines[8], "1 2 3 4 5 6 7 8 9 ");
  });

  it("prints CP437 glyph for SOH via AH=02", () => {
    const out = runSource(`${header}
    mov dl, 1
    int 21h
${footer}`);
    assert.equal(out, "☺");
  });

  it("caps buffered lines so print loops cannot grow memory", () => {
    const c = new DosConsole();
    for (let i = 0; i < DosConsole.MAX_LINES + 500; i++) {
      c.write(`\rline${i}\n`); // CR resets column (LF alone keeps it, per DOS)
    }
    const lines = c.text.split("\n");
    assert.equal(lines.length, DosConsole.MAX_LINES);
    // Oldest lines dropped, newest retained (last entry is the empty
    // trailing row after the final LF).
    assert.equal(lines[0], "line501");
    assert.equal(lines[lines.length - 2], `line${DosConsole.MAX_LINES + 499}`);
    assert.equal(c.cursorRow, DosConsole.MAX_LINES - 1);
  });
});
