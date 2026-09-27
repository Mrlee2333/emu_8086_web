/** Core types for the interpretive 8086 assembler and emulator. */

import type { DosFiles } from "./dos-files";

export type FlagName =
  | "CF"
  | "PF"
  | "AF"
  | "ZF"
  | "SF"
  | "TF"
  | "IF"
  | "DF"
  | "OF";

export type Flags = Record<FlagName, number>;

export type Reg16Name =
  | "ax"
  | "bx"
  | "cx"
  | "dx"
  | "si"
  | "di"
  | "bp"
  | "sp"
  | "ds"
  | "es"
  | "ss"
  | "cs";

export type Reg8Name =
  | "al"
  | "ah"
  | "bl"
  | "bh"
  | "cl"
  | "ch"
  | "dl"
  | "dh";

export type Registers = Record<Reg16Name, number>;

export interface DataVariable {
  addr: number;
  unitSize: 1 | 2;
  count: number;
}

export interface Instruction {
  op: string;
  args: string[];
  ln: number;
  rep?: "rep" | "repne" | "repe" | "repz" | "repnz";
}

export interface AssembledProgram {
  mem: Uint8Array;
  dataVars: Record<string, DataVariable>;
  instrs: Instruction[];
  labels: Record<string, number>;
  /** Constants defined with EQU or `=`, resolved at assembly time. */
  symbols: Record<string, number>;
  entry: number;
}

export type RunState = "idle" | "ready" | "running" | "halted" | "error";

export interface MachineSnapshot {
  reg: Registers;
  flags: Flags;
  ip: number;
  halted: boolean;
  output: string;
  callStack: number[];
  dataStack: number[];
  steps: number;
  err: string | null;
  inputQueue: string[];
  waitingForInput: boolean;
}

/**
 * Full reversible CPU state for Step Back (snapshot + memory + console).
 *
 * The port latch is included so a step back over `OUT` reads the port as it
 * stood. The DOS file system is not: it is a store of whole files rather than
 * machine registers, and rewinding it is not worth the memory.
 */
export interface FullMachineState {
  reg: Registers;
  flags: Flags;
  ip: number;
  halted: boolean;
  callStack: number[];
  dataStack: number[];
  steps: number;
  err: string | null;
  inputQueue: string[];
  waitingForInput: boolean;
  mem: Uint8Array;
  console: { lines: string[]; row: number; col: number };
  ports: [number, number][];
}

export interface DosContext {
  get8: (reg: Reg8Name) => number;
  set8: (reg: Reg8Name, val: number) => void;
  get16: (reg: Reg16Name) => number;
  reg: Registers;
  mem: Uint8Array;
  print: (text: string) => void;
  /** Write one DOS console byte with CP437 / control handling. */
  printByte: (byte: number) => void;
  halt: () => void;
  readInputChar: () => string | null;
  peekInputChar: () => string | null;
  waitingForInput: boolean;
  /** Carry flag, the DOS convention for reporting an error. */
  setCF: (value: number) => void;
  /** Zero flag, which the polling services use to say "nothing waiting". */
  setZF: (value: number) => void;
  /** Text console cursor, for the BIOS video services. */
  getCursor: () => { row: number; col: number };
  setCursor: (row: number, col: number) => void;
  clearScreen: () => void;
  /** Current video mode, for INT 10h AH=0Fh. */
  getVideoMode: () => number;
  setVideoMode: (mode: number) => void;
  /** In-memory files behind the INT 21h file services. */
  files: DosFiles;
}

export interface DosHandlerResult {
  handled: boolean;
  halt?: boolean;
  waitForInput?: boolean;
}
