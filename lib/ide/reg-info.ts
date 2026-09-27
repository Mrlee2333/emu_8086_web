/**
 * Register descriptions for the CPU-registers Details view (v1.5.1).
 *
 * The details dialog needs three things the compact panel cannot show: the
 * high and low byte of every register that has them, the signed and binary
 * reading of the same value, and a sentence saying what each register is for.
 * All of it is derived here from the flat `Registers` record so the view and
 * the emulator cannot drift apart — the byte split here is the same
 * `low & 0xff` / `(low >> 8) & 0xff` the CPU uses in `Machine.get8`.
 *
 * Pure: takes a `Registers` record and returns descriptors. No Machine, no
 * React, no state.
 */

import type { Reg16Name, Registers } from "@/lib/emulator/types";

export type RegKind = "general" | "segment" | "instruction";

/** One 8-bit half of a register, or the whole register where it has no halves. */
export type RegByteView = {
  /** Uppercase name: "AH", "AL". */
  name: string;
  /** 0 to 255. */
  value: number;
  /** "0F" — two digits, no `0x`, matching the memory dump. */
  hex: string;
  /** Unsigned decimal, 0 to 255. */
  dec: number;
  /** Signed decimal, -128 to 127. */
  signed: number;
  /** "0000 1111" — eight bits in two nibbles. */
  binary: string;
  /** "'A'" for a printable byte, null otherwise. */
  printable: string | null;
};

export type RegView = {
  /** Uppercase name: "AX", "CS", "IP". */
  name: string;
  value: number;
  /** "0x1234" — four digits, matching the compact panel. */
  hex: string;
  dec: number;
  /** Signed decimal, -32768 to 32767. */
  signed: number;
  /** "0001 0010 0011 0100" — sixteen bits in nibbles. */
  binary: string;
  kind: RegKind;
  /** One sentence on what the 8086 uses this register for. */
  purpose: string;
  /** AH / BH / CH / DH, or null for a register with no byte halves. */
  high: RegByteView | null;
  /** AL / BL / CL / DL, or null for a register with no byte halves. */
  low: RegByteView | null;
};

const GENERAL_ORDER: readonly Reg16Name[] = [
  "ax",
  "bx",
  "cx",
  "dx",
  "si",
  "di",
  "bp",
  "sp",
];

const SEGMENT_ORDER: readonly Reg16Name[] = ["cs", "ds", "ss", "es"];

const PURPOSE: Record<Reg16Name | "ip", string> = {
  ax: "Accumulator. The implicit operand of MUL, DIV, the word forms of the shifts, XLAT, IN and OUT, and the destination of most arithmetic.",
  bx: "Base. The base register of an effective address, and the implicit base of the string instructions.",
  cx: "Count. The loop count for LOOP and REP, the shift count for 8- and 16-bit shifts, and the high half of the DX:AX pair for word MUL and DIV.",
  dx: "Data. The other half of the DX:AX pair for word MUL, DIV, IDIV and IMUL, and the port number for IN and OUT.",
  si: "Source index. The source offset of the string instructions, and an index register in an effective address.",
  di: "Destination index. The destination offset of the string instructions, and an index register in an effective address.",
  bp: "Base pointer. The base of a stack-relative address; unlike the other pointers it addresses through SS by default.",
  sp: "Stack pointer. The offset of the top of the stack in SS. A PUSH decrements it by two before writing, a POP increments it after reading.",
  cs: "Code segment. The segment the instruction pointer is measured from, and the segment PUSH, CALL and the interrupts take from.",
  ds: "Data segment. The default segment for a data reference; an effective address uses the override prefix to name a different one.",
  ss: "Stack segment. The segment SP addresses through, and the default for a reference based on BP or SP.",
  es: "Extra segment. The destination segment of the string instructions, which is why it cannot be overridden by a prefix.",
  ip: "Instruction pointer. The offset in CS of the next instruction. A jump, call or interrupt replaces it; only IRET restores it.",
};

function hex2(value: number): string {
  return (value & 0xff).toString(16).padStart(2, "0").toUpperCase();
}

function hex4(value: number): string {
  return (value & 0xffff).toString(16).padStart(4, "0").toUpperCase();
}

/** `0b` in groups of four, so the byte and word rows line up. */
function binaryGrouped(value: number, bits: number): string {
  const text = (value >>> 0).toString(2).padStart(bits, "0");
  const nibbles = bits / 4;
  const out: string[] = [];
  for (let i = 0; i < text.length; i += nibbles) out.push(text.slice(i, i + nibbles));
  return out.join(" ");
}

function toSigned(value: number, bits: number): number {
  const v = value & ((1 << bits) - 1);
  return v >= 1 << (bits - 1) ? v - (1 << bits) : v;
}

function byteView(name: string, value: number): RegByteView {
  const v = value & 0xff;
  return {
    name,
    value: v,
    hex: hex2(v),
    dec: v,
    signed: toSigned(v, 8),
    binary: binaryGrouped(v, 8),
    printable: v >= 32 && v < 127 ? `'${String.fromCharCode(v)}'` : null,
  };
}

function regView(
  name: string,
  raw: number,
  kind: RegKind,
  high: string | null,
  low: string | null,
): RegView {
  const value = raw & 0xffff;
  return {
    name,
    value,
    hex: `0x${hex4(value)}`,
    dec: value,
    signed: toSigned(value, 16),
    binary: binaryGrouped(value, 16),
    kind,
    purpose: PURPOSE[name.toLowerCase() as Reg16Name | "ip"],
    high: high ? byteView(high, (value >> 8) & 0xff) : null,
    low: low ? byteView(low, value & 0xff) : null,
  };
}

/** The two byte names of a 16-bit register, e.g. AX -> ["AH", "AL"]. */
const BYTE_HALVES: Partial<Record<Reg16Name, [string, string]>> = {
  ax: ["AH", "AL"],
  bx: ["BH", "BL"],
  cx: ["CH", "CL"],
  dx: ["DH", "DL"],
};

/**
 * Every register the details view shows: the eight general registers, the four
 * segments, and the instruction pointer. The order is the 8086's own, not
 * alphabetical, so the dialog reads like a textbook diagram.
 */
export function describeRegisters(reg: Registers, ip: number): RegView[] {
  const views: RegView[] = [];
  for (const name of GENERAL_ORDER) {
    const halves = BYTE_HALVES[name];
    views.push(
      regView(name.toUpperCase(), reg[name], "general", halves?.[0] ?? null, halves?.[1] ?? null),
    );
  }
  for (const name of SEGMENT_ORDER) {
    views.push(regView(name.toUpperCase(), reg[name], "segment", null, null));
  }
  views.push(regView("IP", ip, "instruction", null, null));
  return views;
}

/**
 * A sentence on what the next instruction does beyond reading its operands.
 *
 * `MOVSB` moves through SI, DI and CX whether or not they appear in the source
 * line, which is the part of a 8086 a beginner cannot see. Returns null for an
 * instruction whose operands already say everything it touches.
 */
export function instructionNote(op: string): string | null {
  return IMPLICIT[op.toLowerCase()] ?? null;
}

const IMPLICIT: Record<string, string> = {
  movsb: "copies a byte from [SI] to [DI] and steps both, decrementing CX",
  movsw: "copies a word from [SI] to [DI] and steps both, decrementing CX",
  stosb: "stores AL at [DI] and steps DI, decrementing CX",
  stosw: "stores AX at [DI] and steps DI, decrementing CX",
  lodsb: "loads a byte from [SI] into AL and steps SI, decrementing CX",
  lodsw: "loads a word from [SI] into AX and steps SI, decrementing CX",
  scasb: "compares AL with [DI] and steps DI, decrementing CX",
  scasw: "compares AX with [DI] and steps DI, decrementing CX",
  cmpsb: "compares [SI] with [DI] and steps both, decrementing CX",
  cmpsw: "compares [SI] with [DI] and steps both, decrementing CX",
  xlat: "reads the table byte at [BX + AL] into AL",
  mul: "multiplies AL by a byte into AX, or AX by a word into DX:AX",
  imul: "multiplies signed AL into AX, or signed AX into DX:AX",
  div: "divides AX by a byte into AL and AH, or DX:AX by a word into AX and DX",
  idiv: "divides signed AX into AL and AH, or signed DX:AX into AX and DX",
  aaa: "adjusts AL after a BCD addition, folding the carry into AH",
  aas: "adjusts AL after a BCD subtraction, folding the borrow into AH",
  daa: "adjusts AL after a packed-BCD addition, using the carry out of it",
  das: "adjusts AL after a packed-BCD subtraction, using the carry out of it",
  aam: "splits AL into a quotient in AH and a remainder back in AL",
  aad: "folds AH into AL as a quotient and a remainder, for packed BCD",  cbw: "sign-extends AL into AX",
  cwd: "sign-extends AX into DX",
  lahf: "copies the flag bits into AH",
  sahf: "copies AH into the flag bits",
  xchg: "swaps the two operands, writing each one into the other's place",
  in: "reads a port into AL or AX; the port number is the second operand, usually DX",
  out: "writes AL or AX to a port; the port number is the first operand, usually DX",
  loop: "decrements CX and jumps while it is not zero",
  loopz: "decrements CX and jumps while it is not zero and ZF is set",
  loopnz: "decrements CX and jumps while it is not zero and ZF is clear",
  jcxz: "jumps when CX is zero, without touching it",
  pushf: "pushes the flags word onto the stack",
  popf: "pops a word into the flags",
  int: "runs the DOS or BIOS service for this number; in this flat model it pushes nothing, so a handler returns with a plain RET",
  iret: "returns from a handler; the same as RET here, because INT pushed nothing",
  les: "loads the word at [SI] into a register and the word after it into ES",
  lds: "loads the word at [SI] into a register and the word after it into DS",
  lea: "loads an address into a register without reading the memory it names",
};
