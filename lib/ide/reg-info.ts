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

/**
 * Display order of the general registers, exported because the compact panel
 * lays its cells out from this list rather than keeping its own copy. An
 * earlier version had the panel and the dialog each holding literals, which is
 * how they came to disagree about the segment order with nothing failing.
 */
export const GENERAL_ORDER: readonly Reg16Name[] = [
  "ax",
  "bx",
  "cx",
  "dx",
  "si",
  "di",
  "bp",
  "sp",
];

/**
 * Display order of the segment registers, matching the original emu8086
 * register view: DS, ES, SS, CS. Exported for the same reason as
 * `GENERAL_ORDER`: the panel and the dialog read this one list.
 */
export const SEGMENT_ORDER: readonly Reg16Name[] = ["ds", "es", "ss", "cs"];

const PURPOSE: Record<Reg16Name | "ip", string> = {
  ax: "Accumulator. One half of the DX:AX pair that MUL, DIV, IMUL and IDIV use, the register XLAT indexes with, and the target of CBW. It is a destination only where you name it — every arithmetic and logic instruction here writes to its first operand, so AX moves when the program says AX.",
  bx: "Base. The base register of an effective address, and the table index XLAT reads through as [BX + AL]. The string instructions do not use it: they move through SI and DI.",
  cx: "Count. The loop count for LOOP, the repeat count for REP, and the shift count in a form like SHL AX, CL.",
  dx: "Data. The other half of the DX:AX pair for word MUL, DIV, IDIV and IMUL, the register CWD fills with the sign of AX, and the port an IN or OUT names when it is written as DX.",
  si: "Source index. The source offset of the string instructions, and an index register in an effective address.",
  di: "Destination index. The destination offset of the string instructions, and an index register in an effective address.",
  bp: "Base pointer. The base of a stack-relative address; unlike the other pointers it addresses through SS by default.",
  sp: "Stack pointer. The offset of the top of the stack in SS. A PUSH decrements it by two before writing, a POP increments it after reading.",
  cs: "Code segment. The segment the instruction pointer is measured from. This model has one flat segment, so it reads 0 and no instruction here writes it: a PUSH moves the stack pointer and stores two bytes, with no segment alongside.",
  ds: "Data segment. The default segment for a data reference; an effective address uses the override prefix to name a different one.",
  ss: "Stack segment. The segment SP addresses through, and the default for a reference based on BP or SP.",
  es: "Extra segment. The destination segment of the string instructions, which is why it cannot be overridden by a prefix.",
  ip: "Instruction pointer. The offset in CS of the next instruction. A jump or a call replaces it, and RET restores it from the stack. An interrupt does not: INT runs its service and carries on at the following instruction.",
};

function hex2(value: number): string {
  return (value & 0xff).toString(16).padStart(2, "0").toUpperCase();
}

function hex4(value: number): string {
  return (value & 0xffff).toString(16).padStart(4, "0").toUpperCase();
}

/**
 * Binary in groups of four.
 *
 * A byte groups as two nibbles and a word as four, so the two line up in the
 * same column. Grouping a byte by two instead reads as `00 01 00 10`, which
 * looks like five separate values rather than one eight-bit one.
 */
function binaryGrouped(value: number, bits: number): string {
  const text = (value >>> 0).toString(2).padStart(bits, "0");
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 4) out.push(text.slice(i, i + 4));
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
      regView(
        name.toUpperCase(),
        reg[name],
        "general",
        halves?.[0] ?? null,
        halves?.[1] ?? null,
      ),
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

/**
 * The note for an instruction *including* its REP prefix.
 *
 * `instructionNote` describes a bare `MOVSB`, and says so ("once — CX only
 * moves under REP"). Attaching that to a `REP MOVSB` that is about to run five
 * times states the opposite of what is about to happen, and the panel used to
 * drop the prefix entirely while keeping the note. So the prefixed form gets its
 * own wording, and the ZF-termination of REPE/REPNE is spelled out because that
 * is the part a beginner cannot see.
 *
 * @param op lowercase instruction name
 * @param rep the prefix the assembler recorded, if any
 * @returns a sentence, or null when the operands already say everything
 */
export function prefixedInstructionNote(
  op: string,
  rep?: string,
): string | null {
  const base = instructionNote(op);
  if (!rep) return base;
  // REP only means something to the string instructions. Handing a repeat
  // sentence to anything else would be inventing behaviour, so fall through to
  // the bare note instead.
  if (!STRING_OPS.has(op.toLowerCase())) return base;
  const repeat = rep.toUpperCase();
  if (repeat === "REP") {
    return "runs the whole instruction CX times, stepping SI or DI each time and counting CX down to zero";
  }
  // repe/repne also stop early on the flags, which is their whole point.
  return repeat === "REPE"
    ? "runs the instruction up to CX times, stopping early when the comparison sets ZF"
    : "runs the instruction up to CX times, stopping early when the comparison clears ZF";
}

/** The instructions REP can prefix. */
const STRING_OPS = new Set([
  "movsb",
  "movsw",
  "stosb",
  "stosw",
  "lodsb",
  "lodsw",
  "cmpsb",
  "cmpsw",
  "scasb",
  "scasw",
]);

const IMPLICIT: Record<string, string> = {
  movsb:
    "copies a byte from [SI] to [DI] and steps both, once — CX only moves under REP",
  movsw:
    "copies a word from [SI] to [DI] and steps both, once — CX only moves under REP",
  stosb: "stores AL at [DI] and steps DI, once — CX only moves under REP",
  stosw: "stores AX at [DI] and steps DI, once — CX only moves under REP",
  lodsb:
    "loads a byte from [SI] into AL and steps SI, once — CX only moves under REP",
  lodsw:
    "loads a word from [SI] into AX and steps SI, once — CX only moves under REP",
  scasb: "compares AL with [DI] and steps DI, once — CX only moves under REP",
  scasw: "compares AX with [DI] and steps DI, once — CX only moves under REP",
  cmpsb:
    "compares [SI] with [DI] and steps both, once — CX only moves under REP",
  cmpsw:
    "compares [SI] with [DI] and steps both, once — CX only moves under REP",
  xlat: "reads the table byte at [BX + AL] into AL",
  xlatb: "reads the table byte at [BX + AL] into AL",
  mul: "multiplies AL by a byte into AX, or AX by a word into DX:AX",
  imul: "one operand multiplies signed AL into AX, or signed AX into DX:AX; the two- and three-operand forms multiply into the first operand instead",
  div: "divides AX by a byte into AL and AH, or DX:AX by a word into AX and DX",
  idiv: "divides signed AX into AL and AH, or signed DX:AX into AX and DX",
  aaa: "adjusts AL after a BCD addition, folding the carry into AH",
  aas: "adjusts AL after a BCD subtraction, folding the borrow into AH",
  daa: "adjusts AL after a packed-BCD addition, using the carry out of it",
  das: "adjusts AL after a packed-BCD subtraction, using the carry out of it",
  aam: "splits AL into a quotient in AH and a remainder back in AL, the inverse of AAD",
  aad: "folds AH into AL as a tens-and-ones pair, the inverse of AAM — unpacked BCD, not the packed form DAA and DAS adjust",
  cbw: "sign-extends AL into AX",
  cwd: "sign-extends AX into DX",
  lahf: "copies the flag bits into AH",
  sahf: "copies AH into the flag bits",
  xchg: "swaps the two operands, writing each one into the other's place",
  in: "reads a port into AL or AX; the port number is the second operand, usually DX",
  out: "writes AL or AX to a port; the port number is the first operand, usually DX",
  loop: "decrements CX and jumps while it is not zero",
  loopz: "decrements CX and jumps while it is not zero and ZF is set",
  loopnz: "decrements CX and jumps while it is not zero and ZF is clear",
  loope: "decrements CX and jumps while it is not zero and ZF is set",
  loopne: "decrements CX and jumps while it is not zero and ZF is clear",
  jcxz: "jumps when CX is zero, without touching it",
  pushf: "pushes the flags word onto the stack",
  popf: "pops a word into the flags",
  int: "runs the DOS or BIOS service for this number; in this flat model it pushes nothing, so a handler returns with a plain RET",
  iret: "returns from a handler; the same as RET here, because INT pushed nothing",
  les: "loads a word from memory into a register and the word after it into ES; [SI] is the usual operand, not a requirement",
  lds: "loads a word from memory into a register and the word after it into DS; [SI] is the usual operand, not a requirement",
  lea: "loads an address into a register without reading the memory it names",
};
