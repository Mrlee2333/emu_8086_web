import { readDosName } from "./dos-files";
import type { DosContext, DosHandlerResult } from "./types";

/**
 * DOS INT 21h and BIOS INT 10h / 16h console services.
 * Classroom-oriented full console I/O coverage (text mode).
 */
export function handleInterrupt(
  vector: number,
  ctx: DosContext,
): DosHandlerResult {
  if (vector === 0x21) return handleInt21(ctx);
  if (vector === 0x10) return handleInt10(ctx);
  if (vector === 0x16) return handleInt16(ctx);
  if (vector === 0x1a) return handleInt1a(ctx);
  if (vector === 0x15) return handleInt15(ctx);
  if (vector === 0x20) return { handled: true, halt: true };
  // INT 3 is the software breakpoint. A machine with no debugger under it
  // simply carries on from the next instruction, which is what a program that
  // leaves one in expects.
  if (vector === 0x03) return { handled: true };
  return { handled: false };
}

function printMemBytes(ctx: DosContext, addr: number, count: number): void {
  for (let i = 0; i < count; i++) {
    ctx.printByte(ctx.mem[(addr + i) & 0xffff]!);
  }
}

function handleInt21(ctx: DosContext): DosHandlerResult {
  const ah = ctx.get8("ah");

  switch (ah) {
    case 0x00:
      return { handled: true, halt: true };

    case 0x01: {
      const ch = ctx.readInputChar();
      if (ch === null) {
        ctx.waitingForInput = true;
        return { handled: true, waitForInput: true };
      }
      // DOS keyboard Enter is CR (0Dh). Echo the real byte: CR moves to
      // column 0 and does not start a new line (programs print their own LF).
      const code = ch.charCodeAt(0) & 0xff;
      ctx.set8("al", code);
      ctx.printByte(code);
      return { handled: true };
    }

    case 0x02: {
      ctx.printByte(ctx.get8("dl"));
      return { handled: true };
    }

    case 0x05: {
      ctx.printByte(ctx.get8("dl"));
      return { handled: true };
    }

    case 0x06: {
      const dl = ctx.get8("dl");
      if (dl === 0xff) {
        // The only DOS service that asks without waiting. It says so with the
        // zero flag, which is what lets a program poll and carry on.
        const ch = ctx.readInputChar();
        if (ch === null) {
          ctx.set8("al", 0);
          ctx.setZF(1);
          return { handled: true };
        }
        ctx.set8("al", ch.charCodeAt(0) & 0xff);
        ctx.setZF(0);
        return { handled: true };
      }
      ctx.printByte(dl);
      return { handled: true };
    }

    case 0x07:
    case 0x08: {
      const ch = ctx.readInputChar();
      if (ch === null) {
        ctx.waitingForInput = true;
        return { handled: true, waitForInput: true };
      }
      ctx.set8("al", ch.charCodeAt(0) & 0xff);
      return { handled: true };
    }

    case 0x09: {
      let addr = ctx.reg.dx & 0xffff;
      let n = 0;
      while (ctx.mem[addr] !== 36 && n < 10_000) {
        ctx.printByte(ctx.mem[addr]!);
        addr = (addr + 1) & 0xffff;
        n++;
      }
      return { handled: true };
    }

    case 0x0a: {
      const bufferAddr = ctx.reg.dx & 0xffff;
      const maxLen = ctx.mem[bufferAddr];
      let count = ctx.mem[bufferAddr + 1] || 0;
      while (count < maxLen) {
        const ch = ctx.readInputChar();
        if (ch === null) {
          ctx.waitingForInput = true;
          ctx.mem[bufferAddr + 1] = count;
          return { handled: true, waitForInput: true };
        }
        if (ch === "\r" || ch === "\n") break;
        if (ch === "\b" && count > 0) {
          count--;
          ctx.print("\b \b");
          continue;
        }
        ctx.mem[(bufferAddr + 2 + count) & 0xffff] = ch.charCodeAt(0) & 0xff;
        ctx.print(ch);
        count++;
      }
      ctx.mem[bufferAddr + 1] = count;
      ctx.print("\r\n");
      return { handled: true };
    }

    case 0x0b: {
      ctx.set8("al", ctx.peekInputChar() !== null ? 0xff : 0);
      return { handled: true };
    }

    case 0x0c: {
      // Flush buffer then optionally call input function in AL
      const al = ctx.get8("al");
      while (ctx.readInputChar() !== null) {
        /* flush */
      }
      if (al === 0x01 || al === 0x07 || al === 0x08 || al === 0x0a) {
        ctx.set8("ah", al);
        return handleInt21(ctx);
      }
      return { handled: true };
    }

    case 0x25: {
      // Set interrupt vector — stub (flat model)
      return { handled: true };
    }

    case 0x2a: {
      const now = new Date();
      ctx.set8("al", now.getDay());
      ctx.reg.cx = now.getFullYear();
      ctx.set8("dh", now.getMonth() + 1);
      ctx.set8("dl", now.getDate());
      return { handled: true };
    }

    case 0x2c: {
      const now = new Date();
      ctx.set8("ch", now.getHours());
      ctx.set8("cl", now.getMinutes());
      ctx.set8("dh", now.getSeconds());
      ctx.set8("dl", Math.floor(now.getMilliseconds() / 10));
      return { handled: true };
    }

    case 0x30: {
      ctx.set8("al", 5); // DOS 5.0 major
      ctx.set8("ah", 0); // minor
      return { handled: true };
    }

    case 0x35: {
      // Get interrupt vector — stub returns 0
      ctx.reg.es = 0;
      ctx.reg.bx = 0;
      return { handled: true };
    }

    case 0x36: {
      // Free disk space: 64 KiB units per drive, one drive.
      ctx.reg.ax = 0x0080;
      ctx.reg.bx = 0;
      ctx.reg.cx = 0x2680;
      ctx.reg.dx = 0;
      return { handled: true };
    }

    case 0x39: {
      // Create a directory. There is one flat volume, so the name is checked
      // and the directory is "there".
      const made = ctx.files.makeDirectory(readDosName(ctx.mem, ctx.reg.dx & 0xffff));
      if (!made.ok) return dosError(ctx, made.code);
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x3b: {
      // Change directory. A program that names a directory this filesystem
      // does not have gets the path error DOS would give.
      const entered = ctx.files.changeDirectory(readDosName(ctx.mem, ctx.reg.dx & 0xffff));
      if (!entered.ok) return dosError(ctx, entered.code);
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x3c: {
      // Create a file, truncating it if it is there and not open.
      const name = readDosName(ctx.mem, ctx.reg.dx & 0xffff);
      const made = ctx.files.create(name);
      if (!made.ok) return dosError(ctx, made.code);
      ctx.reg.ax = made.value;
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x3d: {
      // Open a file, with the access mode in bits 4 to 6 of AL.
      const name = readDosName(ctx.mem, ctx.reg.dx & 0xffff);
      const opened = ctx.files.open(name, accessMode(ctx.get8("al")));
      if (!opened.ok) return dosError(ctx, opened.code);
      ctx.reg.ax = opened.value;
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x3e: {
      const closed = ctx.files.close(ctx.reg.bx);
      if (!closed.ok) return dosError(ctx, closed.code);
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x3f: {
      // Read from a handle: the keyboard, or a file.
      const handle = ctx.reg.bx;
      const count = ctx.reg.cx;
      const start = ctx.reg.dx & 0xffff;
      if (handle === 0) {
        let read = 0;
        let addr = start;
        while (read < count) {
          const ch = ctx.readInputChar();
          if (ch === null) {
            if (read === 0) {
              ctx.waitingForInput = true;
              return { handled: true, waitForInput: true };
            }
            break;
          }
          ctx.mem[addr] = ch.charCodeAt(0) & 0xff;
          addr = (addr + 1) & 0xffff;
          read++;
          if (ch === "\r" || ch === "\n") break;
        }
        ctx.reg.ax = read;
        ctx.setCF(0);
        return { handled: true };
      }
      const buf = new Uint8Array(count);
      const read = ctx.files.read(handle, buf, count);
      if (!read.ok) return dosError(ctx, read.code);
      for (let i = 0; i < read.value; i++) {
        ctx.mem[(start + i) & 0xffff] = buf[i]!;
      }
      ctx.reg.ax = read.value;
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x40: {
      // Write to a handle: the screen, or a file.
      const handle = ctx.reg.bx;
      const count = ctx.reg.cx;
      const addr = ctx.reg.dx & 0xffff;
      if (handle === 1 || handle === 2) {
        printMemBytes(ctx, addr, count);
        ctx.reg.ax = count;
        ctx.setCF(0);
        return { handled: true };
      }
      const buf = new Uint8Array(count);
      for (let i = 0; i < count; i++) buf[i] = ctx.mem[(addr + i) & 0xffff]!;
      const written = ctx.files.write(handle, buf);
      if (!written.ok) return dosError(ctx, written.code);
      ctx.reg.ax = written.value;
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x41: {
      const removed = ctx.files.remove(readDosName(ctx.mem, ctx.reg.dx & 0xffff));
      if (!removed.ok) return dosError(ctx, removed.code);
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x42: {
      // Seek: AL is the origin, CX:DX the offset.
      const method = (ctx.get8("al") & 3) as 0 | 1 | 2;
      const offset = (ctx.reg.cx << 16) | ctx.reg.dx;
      const pos = ctx.files.seek(ctx.reg.bx, method, signed32(offset));
      if (pos === null) return dosError(ctx, 6);
      ctx.reg.ax = pos & 0xffff;
      ctx.reg.dx = (pos >>> 16) & 0xffff;
      ctx.setCF(0);
      return { handled: true };
    }

    case 0x4b: {
      // Exit with a return code (AL).
      return { handled: true, halt: true };
    }

    case 0x4c:
      return { handled: true, halt: true };

    default:
      return { handled: false };
  }
}

/**
 * The access mode of AH=3Dh, which is the low two bits of AL: 0 read, 1 write,
 * 2 read and write. Bits 4 and 5 are the sharing mode and are ignored, so
 * AL=10h (compatibility sharing, read only) opens for reading and not for
 * writing, which is what the bits say.
 */
function accessMode(code: number): "read" | "write" | "readwrite" {
  const bits = code & 3;
  if (bits === 0) return "read";
  if (bits === 1) return "write";
  return "readwrite";
}

/** Report a DOS error the way the manual says: carry set, code in AX. */
function dosError(ctx: DosContext, code: number): DosHandlerResult {
  ctx.reg.ax = code;
  ctx.setCF(1);
  return { handled: true };
}

function signed32(v: number): number {
  return v > 0x7fffffff ? v - 0x100000000 : v;
}

function handleInt10(ctx: DosContext): DosHandlerResult {
  const ah = ctx.get8("ah");
  switch (ah) {
    case 0x00:
      // Set video mode. A mode with bit 7 clear is text; the console panel
      // only draws text, so a graphics mode is remembered but not rendered.
      ctx.setVideoMode(ctx.get8("al") & 0x7f);
      ctx.clearScreen();
      return { handled: true };
    case 0x02:
      // Set cursor position: DH row, DL column.
      ctx.setCursor(ctx.get8("dh"), ctx.get8("dl"));
      return { handled: true };
    case 0x03:
      // Read cursor position and shape.
      {
        const { row, col } = ctx.getCursor();
        ctx.set8("dh", row);
        ctx.set8("dl", col);
        ctx.set8("ch", 0x06);
        ctx.set8("cl", 0x07);
      }
      return { handled: true };
    case 0x05:
      // Select active page — the console has one page.
      return { handled: true };
    case 0x06:
    case 0x07: {
      // Scroll window up. AL=0 clears the window, which for a full-screen
      // scroll is a clear screen; a partial scroll is not drawn.
      if (ctx.get8("al") === 0) {
        const keepCursor = ctx.get8("ch") === 0 && ctx.get8("cl") === 0;
        ctx.clearScreen();
        if (keepCursor) ctx.setCursor(0, 0);
      }
      return { handled: true };
    }
    case 0x09:
    case 0x0a: {
      const al = ctx.get8("al");
      const count = Math.max(1, ctx.reg.cx);
      for (let i = 0; i < count; i++) ctx.printByte(al);
      return { handled: true };
    }
    case 0x0c:
    case 0x0d: {
      // Write a graphics pixel, in the normal and the selected pages. A text
      // console has no pixels, so this does what the other graphics-only
      // services do and returns: a program that plots a line should carry on
      // and say what it plotted, not stop dead at the first pixel.
      return { handled: true };
    }
    case 0x0e:
      ctx.printByte(ctx.get8("al"));
      return { handled: true };
    case 0x0f: {
      // Read video state: AL mode, AH 80 columns, BH page 0, CX/DX cursor.
      ctx.set8("al", ctx.getVideoMode());
      ctx.set8("ah", 80);
      ctx.set8("bh", 0);
      ctx.set8("bl", 0);
      const { row, col } = ctx.getCursor();
      ctx.set8("ch", row);
      ctx.set8("cl", col);
      ctx.set8("dh", row);
      ctx.set8("dl", col);
      return { handled: true };
    }
    case 0x13: {
      // Write string ES:BP, CX=length — flat: use BP as offset
      const addr = ctx.reg.bp & 0xffff;
      const len = ctx.reg.cx;
      printMemBytes(ctx, addr, len);
      return { handled: true };
    }
    case 0x1a:
      // Display combination code — text mode has none.
      ctx.set8("al", 0);
      return { handled: true };
    case 0x10: {
      // Palette. Setting one is accepted and ignored: a text console has no
      // palette to program, but a program that sets a border before drawing
      // should not be stopped by the attempt. Reading one reports zero
      // palettes, which is the truth here.
      const al = ctx.get8("al");
      if ((al & 0xf0) === 0x10) {
        ctx.set8("al", 0x00);
        return { handled: true };
      }
      return { handled: true };
    }
    default:
      return { handled: false };
  }
}

function handleInt16(ctx: DosContext): DosHandlerResult {
  const ah = ctx.get8("ah");
  switch (ah) {
    case 0x00:
    case 0x10: {
      const ch = ctx.readInputChar();
      if (ch === null) {
        ctx.waitingForInput = true;
        return { handled: true, waitForInput: true };
      }
      ctx.set8("al", ch.charCodeAt(0) & 0xff);
      ctx.set8("ah", 0);
      return { handled: true };
    }
    case 0x01:
    case 0x11: {
      // Check for a keystroke without waiting, and without taking it: the
      // character comes back in AX and is still there for the next read, so a
      // program that polls does not lose the key it found.
      const ch = ctx.peekInputChar();
      if (ch === null) {
        ctx.set8("al", 0);
        ctx.setZF(1);
      } else {
        ctx.set8("al", ch.charCodeAt(0) & 0xff);
        ctx.set8("ah", 0);
        ctx.setZF(0);
      }
      return { handled: true };
    }
    case 0x02:
    case 0x12:
      // Shift key state: no key is held in a program that reads it this way,
      // so every bit is clear.
      ctx.set8("al", 0);
      return { handled: true };
    default:
      return { handled: false };
  }
}

/** INT 1Ah: the BIOS tick counter and the midnight flag. */
function handleInt1a(ctx: DosContext): DosHandlerResult {
  const ah = ctx.get8("ah");
  if (ah === 0x00) {
    // Read the tick counter. Nothing advances it here, so it reads zero and
    // the midnight rollover flag stays clear.
    ctx.reg.cx = 0;
    ctx.reg.dx = 0;
    ctx.set8("al", 0);
    return { handled: true };
  }
  if (ah === 0x01) {
    // Set the tick counter.
    ctx.set8("al", 0);
    return { handled: true };
  }
  return { handled: false };
}

/** The handful of INT 15h services that classroom programs reach for. */
function handleInt15(ctx: DosContext): DosHandlerResult {
  const ah = ctx.get8("ah");
  if (ah === 0x86) {
    // Wait CX:DX milliseconds. Time here is the step count, so there is
    // nothing to wait for and the call returns at once.
    ctx.setCF(0);
    return { handled: true };
  }
  if (ah === 0x88) {
    // Extended memory size in KB: none beyond the 640 KB of real mode.
    ctx.reg.ax = 0;
    return { handled: true };
  }
  return { handled: false };
}
