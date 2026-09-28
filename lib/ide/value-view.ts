/**
 * The Extended Value Viewer (v1.5.3) — every reading of one 16-bit 8086 value.
 *
 * The v1.5.1 register details show a value as hex and as decimal. The original
 * emu8086 viewer goes wider, and it splits by width rather than by base: the two
 * bytes are shown in hex, binary and octal and read on their own as unsigned,
 * signed and a character, while the word is shown as hex and binary and read as
 * unsigned and signed. Octal stops at the byte because that is the width it was
 * ever useful at — a six-digit octal word is a number nobody computes by hand —
 * and the original groups the 16-bit rows under "Decimal 16 bit" for the same
 * reason. That asymmetry is the point of the window: the byte in AH and the word
 * in AX are the same kind of number read at two widths, and nothing else on
 * screen says so.
 *
 * Every number here is copied out of the `RegView` the details view already
 * shows rather than re-derived from the raw value, so the high and low byte in
 * this dialog are the ones `Machine.get8` returns. This module never splits a
 * word itself.
 *
 * Pure: takes a `RegView` and returns a descriptor. No Machine, no React, no
 * state.
 */

import { cp437TableDisplay, getCp437Entry } from "@/lib/emulator/cp437";
import type { RegByteView, RegView } from "@/lib/ide/reg-info";

/** One 8-bit half, in every base the viewer shows. */
export type ValueByte = {
  /**
   * The name the 8086 gives this half: "AH", "AL", "BH", "BL", "CH", "CL",
   * "DH", "DL". There is no "H" or "L" case — reg-info sets both halves or
   * neither, and only for the four registers that have them.
   */
  name: string;
  /** 0 to 255. */
  value: number;
  /** "A3" — two digits, no `0x`. */
  hex: string;
  /** "1010 0011" — eight bits in two nibbles. */
  binary: string;
  /** "243" — three octal digits at most, no `0o`. */
  octal: string;
  /** Unsigned decimal, 0 to 255. */
  unsigned: number;
  /** Signed decimal, -128 to 127. */
  signed: number;
  /**
   * The character cell: the CP437 glyph DOS would draw, or a name where the
   * byte has no glyph a reader could see — "cret" for CR, "null" for zero,
   * "beep" for BEL. The same labels the character map uses.
   */
  char: string;
};

/** One register, in every base the viewer shows. */
export type ValueView = {
  /** "AX". */
  name: string;
  value: number;
  /** "0xA341" — four digits, matching the compact panel. */
  hex: string;
  /** "1010 0011 0100 0001" — sixteen bits in nibbles. */
  binary: string;
  /** Unsigned decimal, 0 to 65535. */
  unsigned: number;
  /** Signed decimal, -32768 to 32767. */
  signed: number;
  /** The high byte, or null where the 8086 has no name for one. */
  high: ValueByte | null;
  /** The low byte, or null where the 8086 has no name for one. */
  low: ValueByte | null;
};

/**
 * A byte as a character, in the map DOS actually drew with.
 *
 * The original viewer calls this row ASCII, but a byte above 0x7F is not ASCII
 * and this is a DOS emulator whose console already draws 0xA3 as "ú". Reading
 * the byte as Latin-1 here would show a control code where the program the
 * student is stepping would have shown a character, so the glyph comes from the
 * same CP437 table the console and the character map use.
 */
function valueByte(byte: RegByteView): ValueByte {
  return {
    name: byte.name,
    value: byte.value,
    hex: byte.hex,
    binary: byte.binary,
    // `byte.value` is already masked to a byte by reg-info, so a word wider
    // than eight bits cannot spill into the octal column.
    octal: byte.value.toString(8),
    unsigned: byte.dec,
    signed: byte.signed,
    char: cp437TableDisplay(getCp437Entry(byte.value)),
  };
}

/**
 * The viewer for one register.
 *
 * Takes the `RegView` the details view renders rather than a raw number so the
 * two dialogs cannot disagree about a value: a caller that has already looked a
 * register up does not get a second, subtly different answer here.
 */
export function describeValue(view: RegView): ValueView {
  return {
    name: view.name,
    value: view.value,
    hex: view.hex,
    binary: view.binary,
    unsigned: view.dec,
    signed: view.signed,
    high: view.high ? valueByte(view.high) : null,
    low: view.low ? valueByte(view.low) : null,
  };
}
