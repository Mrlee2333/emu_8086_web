import type { Flags, Instruction, Registers } from "@/lib/emulator/types";

/** ALU-affecting ops (a subset of the emulator's executeInstruction switch). */
const ALU_OPS = new Set([
  "add", "adc", "sub", "sbb", "cmp",
  "and", "or", "xor", "test", "not", "neg",
  "inc", "dec", "mul", "imul", "div", "idiv",
  "shl", "sal", "shr", "sar", "rol", "ror", "rcl", "rcr",
  "aaa", "aas", "daa", "das", "aam", "aad",
]);

/** Ops whose flags are undefined on real 8086 hardware. */
const FLAGS_UNDEFINED = new Set(["div", "idiv"]);

/** Ops that leave flags untouched (NOT writes the operand only). */
const FLAGS_UNCHANGED = new Set(["not"]);

const FLAG_AFFECTED: Record<string, string[]> = {
  add: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  mul: ["CF", "OF"],
  imul: ["CF", "OF"],
  aaa: ["AF", "CF"],
  aas: ["AF", "CF"],
  daa: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  das: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  aam: ["CF", "PF", "ZF", "SF", "OF"],
  aad: ["CF", "PF", "ZF", "SF", "OF"],
  adc: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  sub: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  sbb: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  cmp: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  and: ["CF", "PF", "ZF", "SF", "OF"],
  or: ["CF", "PF", "ZF", "SF", "OF"],
  xor: ["CF", "PF", "ZF", "SF", "OF"],
  test: ["CF", "PF", "ZF", "SF", "OF"],
  inc: ["PF", "AF", "ZF", "SF", "OF"],
  dec: ["PF", "AF", "ZF", "SF", "OF"],
  neg: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  shl: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  sal: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  shr: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  sar: ["CF", "PF", "AF", "ZF", "SF", "OF"],
  rol: ["CF", "OF"],
  ror: ["CF", "OF"],
  rcl: ["CF", "OF"],
  rcr: ["CF", "OF"],
};

export type AluDescription = {
  /** Lowercase op of the current instruction (e.g. "add"). */
  op: string;
  /** True when the op updates flags like the original emu8086 ALU view. */
  isAluOp: boolean;
  /** Human sentence, e.g. 'ADD AX, 1 — updates CF PF AF ZF SF OF'. */
  summary: string;
  /** Flag names this op affects (empty for MOV / JMP / etc.). */
  affectedFlags: string[];
};

function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Describe the instruction at `ip` as the original emu8086 ALU panel does:
 * which operation runs next and which flags it touches. Pure — the UI
 * passes the assembled instruction list, ip, and current reg/flags.
 */
export function describeAlu({
  instrs,
  ip,
  reg,
  flags,
}: {
  instrs: Instruction[];
  ip: number;
  reg: Registers;
  flags: Flags;
}): AluDescription | null {
  const instr = instrs[ip];
  if (!instr) return null;
  const op = instr.op.toLowerCase();
  const affected = FLAG_AFFECTED[op] ?? [];
  const isAluOp = ALU_OPS.has(op);
  const args = instr.args.join(", ").toUpperCase();
  const head = args ? `${op.toUpperCase()} ${args}` : op.toUpperCase();

  if (!isAluOp) {
    return {
      op,
      isAluOp: false,
      summary: `${head} — no flags changed`,
      affectedFlags: [],
    };
  }
  if (FLAGS_UNDEFINED.has(op)) {
    return {
      op,
      isAluOp: true,
      summary: `${head} — flags undefined on 8086`,
      affectedFlags: [],
    };
  }
  if (FLAGS_UNCHANGED.has(op)) {
    return {
      op,
      isAluOp: true,
      summary: `${head} — flags unchanged`,
      affectedFlags: [],
    };
  }
  const live = affected.map((f) => `${f}=${flags[f as keyof Flags] ?? 0}`).join(" ");
  const ax = `AX=${hex4(reg.ax)}`;
  return {
    op,
    isAluOp: true,
    summary: `${head} — updates ${affected.join(" ")} · ${ax} · ${live}`,
    affectedFlags: affected,
  };
}
