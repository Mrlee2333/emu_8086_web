import {
  MAX_CALL_STACK,
  MAX_DATA_STACK,
  REG8,
  REG8_TO_REG16,
  REG16,
} from "./constants";
import { dosByteToPrintable } from "./cp437";
import { DosConsole } from "./dos-console";
import { AsmError } from "./errors";
import { handleInterrupt } from "./dos";
import { DosFiles } from "./dos-files";
import { evalExpr } from "./expr";
import {
  createDefaultFlags,
  flagsFromWord,
  flagsToWord,
  pushfWord,
  setFlagsAfterOp,
  setLogicFlags,
  setShiftFlags,
} from "./flags";
import type {
  AssembledProgram,
  FullMachineState,
  Instruction,
  MachineSnapshot,
  Reg16Name,
  Reg8Name,
  Registers,
} from "./types";
import { parityOf, parseNumber, writeUnit } from "./utils";

/** Interpretive 8086 CPU for classroom assembly programs. */
export class Machine {
  readonly a: AssembledProgram;
  mem: Uint8Array;
  reg: Registers;
  flags = createDefaultFlags();
  ip: number;
  halted = false;
  /** DOS text console (CR/LF are independent cursor motions). */
  private console = new DosConsole();
  callStack: number[] = [];
  dataStack: number[] = [];
  steps = 0;
  err: string | null = null;
  inputQueue: string[] = [];
  waitingForInput = false;
  /** In-memory DOS file system behind INT 21h AH=3Bh and friends. */
  files = new DosFiles();
  /** Latched I/O ports, keyed by port number. */
  private ports = new Map<number, number>();
  /** Active video mode, for INT 10h AH=0Fh. */
  private videoMode = 0x03;

  /** Serialized console text for the CRT / clipboard. */
  get output(): string {
    return this.console.text;
  }

  constructor(assembled: AssembledProgram) {
    this.a = assembled;
    this.mem = new Uint8Array(assembled.mem);
    this.reg = {
      ax: 0,
      bx: 0,
      cx: 0,
      dx: 0,
      si: 0,
      di: 0,
      bp: 0,
      sp: 0xfffe,
      ds: 0,
      es: 0,
      ss: 0,
      cs: 0,
    };
    this.ip = assembled.entry;
  }

  get8(regName: Reg8Name): number {
    const fullReg = REG8_TO_REG16[regName];
    const full = this.reg[fullReg];
    return regName[1] === "l" ? full & 0xff : (full >> 8) & 0xff;
  }

  set8(regName: Reg8Name, val: number): void {
    val = val & 0xff;
    const fullReg = REG8_TO_REG16[regName];
    const full = this.reg[fullReg];
    if (regName[1] === "l") {
      this.reg[fullReg] = (full & 0xff00) | val;
    } else {
      this.reg[fullReg] = (full & 0x00ff) | (val << 8);
    }
  }

  isReg8(t: string): t is Reg8Name {
    return (REG8 as readonly string[]).includes(t);
  }

  isReg16(t: string): t is Reg16Name {
    return (REG16 as readonly string[]).includes(t);
  }

  resolveMemOperand(token: string): number | null {
    const t = token.replace(/^(byte|word)\s+ptr\s+/i, "").trim();
    const firstBracket = t.indexOf("[");
    if (firstBracket === -1) {
      const name = t.toLowerCase();
      if (this.a.dataVars[name]) return this.a.dataVars[name].addr;
      // A direct operand may carry a displacement without brackets:
      // `SEEN+2` is the third cell after SEEN.
      const bare = t.match(/^(\w+)([\s+-].*)$/);
      if (bare && this.a.dataVars[bare[1]!.toLowerCase()]) {
        const off = this.evalIndex(bare[2]!);
        if (off === null) return null;
        return this.a.dataVars[bare[1]!.toLowerCase()]!.addr + off;
      }
      return null;
    }

    const base = t.slice(0, firstBracket).trim().toLowerCase() || null;
    const bracketRe = /\[\s*([^\]]+)\s*\]/g;
    const brackets: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = bracketRe.exec(t)) !== null) {
      brackets.push(m[1]!.trim());
    }
    if (brackets.length === 0) return null;

    let addr = 0;
    if (base) {
      if (this.a.dataVars[base]) addr += this.a.dataVars[base].addr;
      else if (this.a.symbols[base] !== undefined) addr += this.a.symbols[base];
    }
    for (const offsetExpr of brackets) {
      const value = this.evalIndex(offsetExpr);
      if (value === null) return null;
      addr += value;
    }
    return addr;
  }

  /**
   * Value of the terms inside one `[...]`, which may mix registers, labels and
   * constants: `[BX+SI-2]`, `[DI-2]`, `[BP+4]`, `[DATA_W+HOWMANY*2]`.
   */
  private evalIndex(expr: string): number | null {
    return evalExpr(expr, this.symbolLookup, 0, this.registerLookup);
  }

  private symbolLookup = (name: string): number | undefined => {
    if (this.a.symbols[name] !== undefined) return this.a.symbols[name];
    if (this.a.dataVars[name] !== undefined) return this.a.dataVars[name]!.addr;
    if (this.a.labels[name] !== undefined) return this.a.labels[name];
    return undefined;
  };

  private registerLookup = (name: string): number | undefined =>
    this.isReg16(name) ? this.reg[name] : undefined;

  varUnitSize(token: string): 1 | 2 {
    if (/^byte\s+ptr/i.test(token)) return 1;
    if (/^word\s+ptr/i.test(token)) return 2;
    const t = token.replace(/^(byte|word)\s+ptr\s+/i, "").trim();
    const m = t.match(/^(\w+)/);
    if (m && this.a.dataVars[m[1].toLowerCase()]) {
      return this.a.dataVars[m[1].toLowerCase()]!.unitSize;
    }
    return 2;
  }

  isMemOperand(token: string): boolean {
    const low = token.toLowerCase();
    if (token.includes("[")) return true;
    if (this.a.dataVars[low] !== undefined) return true;
    const stripped = low.replace(/^(byte|word)\s+ptr\s+/, "").trim();
    if (stripped !== low && this.a.dataVars[stripped] !== undefined) return true;
    // `SEEN+2` and friends: a data label plus a displacement, no brackets.
    const bare = stripped.match(/^(\w+)([\s+-].*)$/);
    return bare !== null && this.a.dataVars[bare[1]!] !== undefined;
  }

  readOperand(token: string, sizeHint?: 1 | 2): number {
    token = token.trim();
    const low = token.toLowerCase();
    if (this.isReg8(low)) return this.get8(low);
    if (this.isReg16(low)) return this.reg[low];
    if (low === "@data") return 0;
    const num = parseNumber(token);
    if (num !== null) {
      // A defined name wins over a number, and a name is only ever read as a
      // number when it ends in a radix letter: EACH is four, not 0xEAC. The
      // symbol table is consulted for those alone, which keeps it off the path
      // every immediate and register operand takes.
      if (endsWithRadixLetter(token)) {
        const constant = this.a.symbols[low];
        if (constant !== undefined) return constant;
      }
      return num;
    }
    if (this.a.symbols[low] !== undefined) return this.a.symbols[low];
    if (/^offset\s+/i.test(token)) {
      const name = token.replace(/^offset\s+/i, "").trim().toLowerCase();
      if (this.a.dataVars[name]) return this.a.dataVars[name].addr;
      if (this.a.symbols[name] !== undefined) return this.a.symbols[name];
      // The offset of a routine is where it sits in the instruction list.
      if (this.a.labels[name] !== undefined) return this.a.labels[name];
      throw new AsmError(`Unknown symbol "${name}"`);
    }
    // A bare name that is not a constant is a data label, an address to read
    // through rather than a value.
    if (low === "data" || low === "code" || low === "datasg" || low === "codesg") {
      return 0;
    }
    if (low.startsWith("seg ")) {
      // The flat memory model has one segment, so every segment value is 0.
      return 0;
    }
    if (this.isMemOperand(low)) {
      const addr = this.resolveMemOperand(token);
      if (addr === null) throw new AsmError(`Unknown operand "${token}"`);
      const size = sizeHint ?? this.varUnitSize(token);
      if (size === 2) return this.mem[addr] | (this.mem[addr + 1] << 8);
      return this.mem[addr];
    }
    const expr = this.evalConst(token);
    if (expr !== null) return expr;
    throw new AsmError(`Cannot read operand "${token}"`);
  }

  /** Constant expression over EQU symbols, data labels and code labels. */
  private evalConst(token: string): number | null {
    return evalExpr(token, this.symbolLookup);
  }

  writeOperand(token: string, val: number, sizeHint?: 1 | 2): void {
    token = token.trim();
    const low = token.toLowerCase();
    if (this.isReg8(low)) {
      this.set8(low, val);
      return;
    }
    if (this.isReg16(low)) {
      this.reg[low] = val & 0xffff;
      return;
    }
    if (this.isMemOperand(low)) {
      const addr = this.resolveMemOperand(token);
      if (addr === null) throw new AsmError(`Unknown operand "${token}"`);
      const size = sizeHint ?? this.varUnitSize(token);
      writeUnit(this.mem, addr, val, size);
      return;
    }
    throw new AsmError(`Cannot write operand "${token}"`);
  }

  jumpTo(label: string): void {
    label = label.toLowerCase();
    if (this.a.labels[label] === undefined) {
      throw new AsmError(`Unknown label "${label}"`);
    }
    this.ip = this.a.labels[label];
  }

  /** Emit a DOS console byte (INT 21h AH=02 style) with CP437 glyphs. */
  printByte(byte: number): void {
    this.print(dosByteToPrintable(byte));
  }

  print(str: string): void {
    this.console.write(str);
  }

  enqueueInput(text: string): void {
    for (const ch of text) {
      // Browser / paste newlines are LF; DOS keyboard Enter is CR (0Dh).
      this.inputQueue.push(ch === "\n" ? "\r" : ch);
    }
    this.waitingForInput = false;
  }

  readInputChar(): string | null {
    return this.inputQueue.length > 0 ? (this.inputQueue.shift() ?? null) : null;
  }

  peekInputChar(): string | null {
    return this.inputQueue.length > 0 ? this.inputQueue[0] : null;
  }

  /** Source line of the last error, if any. */
  getErrorLine(): number | null {
    if (!this.err) return null;
    const m = this.err.match(/\(line\s+(\d+)\)/i);
    return m ? parseInt(m[1], 10) : this.getCurrentLine();
  }

  /**
   * 8086 size: an 8-bit register forces a byte op (`mov [si], bl`).
   * Bare `[si]` without a register or BYTE/WORD PTR defaults to word.
   */
  operandSize(token: string, other?: string): 1 | 2 {
    const low = token.toLowerCase();
    if (this.isReg8(low)) return 1;
    if (this.isReg16(low)) return 2;
    if (other) {
      const o = other.toLowerCase();
      if (this.isReg8(o)) return 1;
      if (this.isReg16(o)) return 2;
    }
    if (this.isMemOperand(low) || /^(byte|word)\s+ptr/i.test(token)) {
      return this.varUnitSize(token);
    }
    return 2;
  }

  /**
   * Effective shift/rotate count.
   *
   * The 8086 takes the low five bits of the count, which is 0 to 31, and a
   * count of zero leaves the operand and every flag alone. What happens past
   * one pass differs by instruction:
   *
   * - A shift keeps going: shifting a word by sixteen leaves it zero, and the
   *   carry holds the last bit to leave, which is bit 0. `SAR` fills with the
   *   sign instead and the carry ends as the sign.
   * - A rotate comes full circle, so a count of one width is a no-op on the
   *   value and still updates the carry.
   * - A rotate through carry turns a value plus the carry, so its cycle is one
   *   wider than the operand: nine steps for a byte, seventeen for a word.
   */
  private shiftCount(token: string, size: 1 | 2, kind: "shift" | "rotate" | "rotate-carry"): number {
    const raw = this.readOperand(token) & 0x1f;
    if (raw === 0) return 0;
    const bits = size * 8;
    if (kind === "shift") return Math.min(raw, bits);
    return raw % (kind === "rotate-carry" ? bits + 1 : bits);
  }

  /**
   * True when a jump or call target is a value rather than a label name: a
   * bracketed address, a bare data label, or a register.
   */
  private isIndirectTarget(token: string): boolean {
    const low = token.trim().toLowerCase();
    if (low.includes("[") || this.isReg16(low) || this.isReg8(low)) return true;
    if (this.a.labels[low] !== undefined) return false;
    return this.isMemOperand(low);
  }

  getCurrentLine(): number | null {
    if (this.halted || this.ip >= this.a.instrs.length) return null;
    return this.a.instrs[this.ip]?.ln ?? null;
  }

  snapshot(): MachineSnapshot {
    return {
      reg: { ...this.reg },
      flags: { ...this.flags },
      ip: this.ip,
      halted: this.halted,
      output: this.output,
      callStack: [...this.callStack],
      dataStack: [...this.dataStack],
      steps: this.steps,
      err: this.err,
      inputQueue: [...this.inputQueue],
      waitingForInput: this.waitingForInput,
    };
  }

  /**
   * Push onto the display mirror of the memory stack. SP and `this.mem` hold
   * the real values; this is only what the stack panel renders, so the oldest
   * entry is dropped past the cap rather than growing without bound.
   */
  private pushData(v: number): void {
    if (this.dataStack.length >= MAX_DATA_STACK) this.dataStack.shift();
    this.dataStack.push(v);
  }

  /** Push a return address. Overflowing halts: dropping one would break `ret`. */
  private pushCall(ip: number, line: number): void {
    if (this.callStack.length >= MAX_CALL_STACK) {
      throw new AsmError("Call stack overflow (recursion too deep)", line);
    }
    this.callStack.push(ip);
  }

  /** Full reversible state for Step Back (registers + flags + memory + console). */
  capture(): FullMachineState {
    return {
      reg: { ...this.reg },
      flags: { ...this.flags },
      ip: this.ip,
      halted: this.halted,
      callStack: [...this.callStack],
      dataStack: [...this.dataStack],
      steps: this.steps,
      err: this.err,
      inputQueue: [...this.inputQueue],
      waitingForInput: this.waitingForInput,
      mem: new Uint8Array(this.mem),
      console: this.console.getState(),
      ports: [...this.ports],
    };
  }

  restore(s: FullMachineState): void {
    this.reg = { ...s.reg };
    this.flags = { ...s.flags };
    this.ip = s.ip;
    this.halted = s.halted;
    this.callStack = [...s.callStack];
    this.dataStack = [...s.dataStack];
    this.steps = s.steps;
    this.err = s.err;
    this.inputQueue = [...s.inputQueue];
    this.waitingForInput = s.waitingForInput;
    this.mem.set(s.mem);
    this.console.setState(s.console);
    this.ports = new Map(s.ports);
  }

  /** Execute one instruction. Returns false when halted or errored. */
  step(): boolean {
    if (this.halted) return false;
    if (this.waitingForInput) return false;
    if (this.ip >= this.a.instrs.length) {
      this.halted = true;
      return false;
    }

    const instr = this.a.instrs[this.ip];
    let nextIp = this.ip + 1;

    try {
      const continued = this.executeInstruction(instr, nextIp);
      if (continued === false) return false;
      if (typeof continued === "number") nextIp = continued;
    } catch (e) {
      const msg = e instanceof AsmError ? e.message : (e as Error).message;
      this.err = msg + (instr.ln ? ` (line ${instr.ln})` : "");
      this.halted = true;
      return false;
    }

    this.ip = nextIp;
    this.steps++;
    if (this.ip >= this.a.instrs.length) this.halted = true;
    return !this.halted;
  }

  private executeInstruction(
    instr: Instruction,
    nextIp: number,
  ): boolean | number {
    const { op, args, rep } = instr;

    if (
      rep &&
      [
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
      ].includes(op)
    ) {
      return this.executeStringOp(op, rep);
    }

    switch (op) {
      case "mov": {
        const size = this.operandSize(args[0], args[1]);
        const v = this.readOperand(args[1], size);
        this.writeOperand(args[0], v, size);
        break;
      }
      case "xchg": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        this.writeOperand(args[0], b, size);
        this.writeOperand(args[1], a, size);
        break;
      }
      case "lea": {
        const addr = this.resolveMemOperand(args[1]);
        if (addr === null) {
          // `LEA SI, BUFFER + 2` addresses a label plus a constant, which MASM
          // allows without brackets. The address is the value, so it reduces to
          // a constant expression.
          const konst = this.evalConst(args[1]!);
          if (konst === null) throw new AsmError(`LEA needs memory operand`);
          this.writeOperand(args[0]!, konst);
          break;
        }
        this.writeOperand(args[0], addr);
        break;
      }
      case "add": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a + b;
        this.writeOperand(args[0], r, size);
        setFlagsAfterOp(this.flags, r, size, "add", a, b);
        break;
      }
      case "sub": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a - b;
        this.writeOperand(args[0], r & (size === 2 ? 0xffff : 0xff), size);
        setFlagsAfterOp(this.flags, r, size, "sub", a, b);
        break;
      }
      case "cmp": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a - b;
        setFlagsAfterOp(this.flags, r, size, "cmp", a, b);
        break;
      }
      case "test": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a & b;
        setLogicFlags(this.flags, r, size);
        break;
      }
      case "inc": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const r = a + 1;
        this.writeOperand(args[0], r, size);
        setFlagsAfterOp(this.flags, r, size, "add", a, 1);
        break;
      }
      case "dec": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const r = a - 1;
        this.writeOperand(args[0], r & (size === 2 ? 0xffff : 0xff), size);
        setFlagsAfterOp(this.flags, r, size, "sub", a, 1);
        break;
      }
      case "mul": {
        const size = this.operandSize(args[0]);
        const b = this.readOperand(args[0], size);
        const isByte = size === 1;
        if (isByte) {
          const r = this.get8("al") * b;
          this.reg.ax = r & 0xffff;
          this.flags.CF = this.flags.OF = r > 0xff ? 1 : 0;
        } else {
          const r = this.reg.ax * b;
          this.reg.ax = r & 0xffff;
          this.reg.dx = (r >> 16) & 0xffff;
          this.flags.CF = this.flags.OF = r > 0xffff ? 1 : 0;
        }
        break;
      }
      case "imul": {
        if (args.length >= 2) {
          // Two operands multiply into the destination: IMUL dest, src.
          // Three ignore what the destination held: IMUL dest, src, imm.
          const size = this.operandSize(args[0]);
          const first =
            args[2] !== undefined
              ? this.readOperand(args[1], size)
              : this.readOperand(args[0], size);
          const second =
            args[2] !== undefined
              ? (parseNumber(args[2]) ?? this.readOperand(args[2], size))
              : this.readOperand(args[1], size);
          const r = signedValue(first, size) * signedValue(second, size);
          this.writeOperand(args[0]!, r, size);
          const fits = r === signedValue(r, size);
          this.flags.CF = this.flags.OF = fits ? 0 : 1;
          break;
        }
        // One-operand form: a byte multiplies AL into AX, a word multiplies AX
        // into DX:AX. Both operands are signed, which is the whole difference
        // from MUL.
        const size = this.operandSize(args[0]);
        const b = signedValue(this.readOperand(args[0], size), size);
        const a = size === 1 ? signedValue(this.get8("al"), 1) : signedValue(this.reg.ax, 2);
        const r = a * b;
        if (size === 1) {
          this.reg.ax = r & 0xffff;
          const fits = r >= -128 && r <= 127;
          this.flags.CF = this.flags.OF = fits ? 0 : 1;
        } else {
          this.reg.ax = r & 0xffff;
          this.reg.dx = (r >> 16) & 0xffff;
          const fits = r >= -32768 && r <= 32767;
          this.flags.CF = this.flags.OF = fits ? 0 : 1;
        }
        break;
      }
      case "div": {
        const size = this.operandSize(args[0]);
        const b = this.readOperand(args[0], size);
        if (b === 0) throw new AsmError("Division by zero");
        const isByte = size === 1;
        if (isByte) {
          const dividend = this.reg.ax;
          this.set8("al", Math.floor(dividend / b));
          this.set8("ah", dividend % b);
        } else {
          const dividend = (this.reg.dx << 16) | this.reg.ax;
          this.reg.ax = Math.floor(dividend / b) & 0xffff;
          this.reg.dx = (dividend % b) & 0xffff;
        }
        break;
      }
      case "and": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a & b;
        this.writeOperand(args[0], r, size);
        setLogicFlags(this.flags, r, size);
        break;
      }
      case "or": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a | b;
        this.writeOperand(args[0], r, size);
        setLogicFlags(this.flags, r, size);
        break;
      }
      case "xor": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a ^ b;
        this.writeOperand(args[0], r, size);
        setLogicFlags(this.flags, r, size);
        break;
      }
      case "not": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        this.writeOperand(args[0], ~a & (size === 2 ? 0xffff : 0xff), size);
        break;
      }
      case "neg": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const r = (-a) & (size === 2 ? 0xffff : 0xff);
        this.writeOperand(args[0], r, size);
        this.flags.ZF = r === 0 ? 1 : 0;
        this.flags.CF = a !== 0 ? 1 : 0;
        break;
      }
      case "adc": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a + b + this.flags.CF;
        this.writeOperand(args[0], r, size);
        setFlagsAfterOp(this.flags, r, size, "add", a, b + this.flags.CF);
        break;
      }
      case "sbb": {
        const size = this.operandSize(args[0], args[1]);
        const a = this.readOperand(args[0], size);
        const b = this.readOperand(args[1], size);
        const r = a - b - this.flags.CF;
        this.writeOperand(args[0], r & (size === 2 ? 0xffff : 0xff), size);
        setFlagsAfterOp(this.flags, r, size, "sub", a, b + this.flags.CF);
        break;
      }
      case "idiv": {
        const size = this.operandSize(args[0]);
        const b = this.readOperand(args[0], size);
        if (b === 0) throw new AsmError("Division by zero");
        const isByte = size === 1;
        if (isByte) {
          const dividend = (this.reg.ax << 16) >> 16;
          this.set8("al", Math.trunc(dividend / b) & 0xff);
          this.set8("ah", Math.trunc(dividend % b) & 0xff);
        } else {
          const dividend = (this.reg.dx << 16) | this.reg.ax;
          const signed = dividend > 0x7fffffff ? dividend - 0x100000000 : dividend;
          const divisor = (b << 16) >> 16;
          this.reg.ax = Math.trunc(signed / divisor) & 0xffff;
          this.reg.dx = Math.trunc(signed % divisor) & 0xffff;
        }
        break;
      }
      case "sal":
      case "shl": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const n = this.shiftCount(args[1], size, "shift");
        if (n === 0) break;
        const bits = size * 8;
        const mask = size === 2 ? 0xffff : 0xff;
        const r = (a << n) & mask;
        this.writeOperand(args[0], r, size);
        const carry = (a >> (bits - n)) & 1;
        // OF is the old top bit against the bit that left, the one case where
        // a shift is a signed operation.
        const overflow = ((r >> (bits - 1)) & 1) ^ carry;
        setShiftFlags(this.flags, r, size, carry, overflow);
        break;
      }
      case "sar": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const n = this.shiftCount(args[1], size, "shift");
        if (n === 0) break;
        const bits = size * 8;
        const signed = (a << (32 - bits)) >> (32 - bits);
        const r = (signed >> n) & (size === 2 ? 0xffff : 0xff);
        this.writeOperand(args[0], r, size);
        const carry = (signed >> (n - 1)) & 1;
        setShiftFlags(this.flags, r, size, carry, 0);
        break;
      }
      case "rol": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const n = this.shiftCount(args[1], size, "rotate");
        if (n === 0) break;
        const bits = size * 8;
        const r = ((a << n) | (a >>> (bits - n))) & (size === 2 ? 0xffff : 0xff);
        this.writeOperand(args[0], r, size);
        this.flags.CF = r & 1;
        break;
      }
      case "ror": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const n = this.shiftCount(args[1], size, "rotate");
        if (n === 0) break;
        const bits = size * 8;
        const r = ((a >>> n) | (a << (bits - n))) & (size === 2 ? 0xffff : 0xff);
        this.writeOperand(args[0], r, size);
        this.flags.CF = (r >> (bits - 1)) & 1;
        break;
      }
      case "rcl": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const n = this.shiftCount(args[1], size, "rotate-carry");
        if (n === 0) break;
        const bits = size * 8;
        let val = a;
        let cf = this.flags.CF;
        for (let i = 0; i < n; i++) {
          const newCf = (val >> (bits - 1)) & 1;
          val = ((val << 1) | cf) & (size === 2 ? 0xffff : 0xff);
          cf = newCf;
        }
        this.writeOperand(args[0], val, size);
        this.flags.CF = cf;
        break;
      }
      case "rcr": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const n = this.shiftCount(args[1], size, "rotate-carry");
        if (n === 0) break;
        const bits = size * 8;
        let val = a;
        let cf = this.flags.CF;
        for (let i = 0; i < n; i++) {
          const newCf = val & 1;
          val = ((cf << (bits - 1)) | (val >>> 1)) & (size === 2 ? 0xffff : 0xff);
          cf = newCf;
        }
        this.writeOperand(args[0], val, size);
        this.flags.CF = cf;
        break;
      }
      case "shr": {
        const size = this.operandSize(args[0]);
        const a = this.readOperand(args[0], size);
        const n = this.shiftCount(args[1], size, "shift");
        if (n === 0) break;
        const r = a >>> n;
        this.writeOperand(args[0], r & (size === 2 ? 0xffff : 0xff), size);
        const carry = (a >>> (n - 1)) & 1;
        // The bit that entered the top is the old sign bit.
        const overflow = size === 2 ? (a >> 15) & 1 : (a >> 7) & 1;
        setShiftFlags(this.flags, r, size, carry, overflow);
        break;
      }
      case "aaa": {
        if ((this.get8("al") & 0x0f) > 9 || this.flags.AF) {
          this.reg.ax = (this.reg.ax + 0x106) & 0xffff;
          this.flags.AF = this.flags.CF = 1;
        } else {
          this.flags.AF = this.flags.CF = 0;
        }
        this.set8("al", this.get8("al") & 0x0f);
        break;
      }
      case "aas": {
        if ((this.get8("al") & 0x0f) > 9 || this.flags.AF) {
          this.reg.ax = (this.reg.ax - 0x106) & 0xffff;
          this.flags.AF = this.flags.CF = 1;
        } else {
          this.flags.AF = this.flags.CF = 0;
        }
        this.set8("al", this.get8("al") & 0x0f);
        break;
      }
      case "daa": {
        let al = this.get8("al");
        // The carry the addition left is what the second test looks at, and
        // what the instruction reports: DAA is what tells the next addition
        // that the answer ran past a hundred.
        let carry = this.flags.CF;
        if ((al & 0x0f) > 9 || this.flags.AF) {
          al = (al + 6) & 0xff;
          this.flags.AF = 1;
        }
        if (al > 0x9f || carry) {
          al = (al + 0x60) & 0xff;
          carry = 1;
        }
        this.set8("al", al);
        this.flags.ZF = al === 0 ? 1 : 0;
        this.flags.SF = (al & 0x80) ? 1 : 0;
        this.flags.PF = parityOf(al);
        this.flags.CF = carry;
        // Overflow is undefined after a decimal adjust, and is left as the
        // addition set it.
        break;
      }
      case "das": {
        const before = this.get8("al");
        let al = before;
        let carry = this.flags.CF;
        if ((al & 0x0f) > 9 || this.flags.AF) {
          al = (al - 6) & 0xff;
          this.flags.AF = 1;
        }
        if (before > 0x9f || carry) {
          al = (al - 0x60) & 0xff;
          carry = 1;
        }
        this.set8("al", al);
        this.flags.ZF = al === 0 ? 1 : 0;
        this.flags.SF = (al & 0x80) ? 1 : 0;
        this.flags.PF = parityOf(al);
        this.flags.CF = carry;
        break;
      }
      case "aam": {
        const base = args[0] ? this.readOperand(args[0]) : 10;
        const al = this.get8("al");
        this.set8("ah", Math.floor(al / base) & 0xff);
        this.set8("al", (al % base) & 0xff);
        setLogicFlags(this.flags, this.get8("al"), 1);
        break;
      }
      case "aad": {
        const base = args[0] ? this.readOperand(args[0]) : 10;
        const r = (this.get8("al") + this.get8("ah") * base) & 0xff;
        this.set8("al", r);
        this.set8("ah", 0);
        setLogicFlags(this.flags, r, 1);
        break;
      }
      case "xlat":
      case "xlatb": {
        const addr = (this.reg.bx + this.get8("al")) & 0xffff;
        this.set8("al", this.mem[addr]);
        break;
      }
      case "lds":
      case "les": {
        const addr = this.resolveMemOperand(args[1]);
        if (addr === null) throw new AsmError(`${op.toUpperCase()} needs memory operand`);
        const off = this.mem[addr] | (this.mem[addr + 1] << 8);
        const seg = this.mem[addr + 2] | (this.mem[addr + 3] << 8);
        this.writeOperand(args[0], off);
        if (op === "lds") this.reg.ds = seg;
        else this.reg.es = seg;
        break;
      }
      case "cli":
        this.flags.IF = 0;
        break;
      case "sti":
        this.flags.IF = 1;
        break;
      case "hlt":
        this.halted = true;
        return false;
      case "wait":
      case "fwait":
      case "lock":
        break;
      case "in": {
        // The port space is a latch: whatever a program wrote to a port reads
        // back from it, which is what lets an OUT/IN pair be followed. Ports
        // with a device behind them in a real machine are not emulated.
        const port = this.readOperand(args[1]) & 0xffff;
        this.writeOperand(args[0], this.ports.get(port) ?? 0);
        break;
      }
      case "out": {
        const port = this.readOperand(args[0]) & 0xffff;
        const size = this.operandSize(args[1]);
        this.ports.set(port, this.readOperand(args[1], size) & (size === 2 ? 0xffff : 0xff));
        break;
      }
      case "cbw": {
        const al = this.get8("al");
        this.reg.ax = al >= 0x80 ? 0xff00 | al : al;
        break;
      }
      case "cwd":
        this.reg.dx = this.reg.ax & 0x8000 ? 0xffff : 0;
        break;
      case "clc":
        this.flags.CF = 0;
        break;
      case "stc":
        this.flags.CF = 1;
        break;
      case "cmc":
        this.flags.CF = this.flags.CF ? 0 : 1;
        break;
      case "cld":
        this.flags.DF = 0;
        break;
      case "std":
        this.flags.DF = 1;
        break;
      case "lahf":
        // LAHF loads AH, not AL, with SF ZF AF PF CF in that order.
        this.reg.ax = (this.reg.ax & 0x00ff) | ((flagsToWord(this.flags) & 0xff) << 8);
        break;
      case "sahf": {
        const low = this.get8("ah");
        const merged = (flagsToWord(this.flags) & 0xff00) | low;
        Object.assign(this.flags, flagsFromWord(merged));
        break;
      }
      case "pushf": {
        const v = pushfWord(this.flags);
        this.reg.sp -= 2;
        writeUnit(this.mem, this.reg.sp, v, 2);
        this.pushData(v);
        break;
      }
      case "popf": {
        const v = this.mem[this.reg.sp] | (this.mem[this.reg.sp + 1] << 8);
        this.reg.sp += 2;
        if (this.dataStack.length) this.dataStack.pop();
        Object.assign(this.flags, flagsFromWord(v));
        break;
      }
      case "push": {
        const v = this.readOperand(args[0]);
        this.reg.sp -= 2;
        writeUnit(this.mem, this.reg.sp, v, 2);
        this.pushData(v);
        break;
      }
      case "pop": {
        const v = this.mem[this.reg.sp] | (this.mem[this.reg.sp + 1] << 8);
        this.reg.sp += 2;
        if (this.dataStack.length) this.dataStack.pop();
        this.writeOperand(args[0], v);
        break;
      }
      case "jmp":
        // `JMP [BX]` and `JMP BX` jump through a word held in memory or in a
        // register, which is how a dispatch table is indexed.
        if (this.isIndirectTarget(args[0]!)) {
          this.ip = this.readOperand(args[0]!, 2);
          return this.ip;
        }
        this.jumpTo(args[0]);
        return this.ip;
      case "je":
      case "jz":
        if (this.flags.ZF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jne":
      case "jnz":
        if (!this.flags.ZF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jg":
      case "jnle":
        if (!this.flags.ZF && this.flags.SF === this.flags.OF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jge":
      case "jnl":
        if (this.flags.SF === this.flags.OF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jl":
      case "jnge":
        if (this.flags.SF !== this.flags.OF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jle":
      case "jng":
        if (this.flags.ZF || this.flags.SF !== this.flags.OF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "ja":
      case "jnbe":
        if (!this.flags.CF && !this.flags.ZF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jae":
      case "jnb":
      case "jnc":
        if (!this.flags.CF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jb":
      case "jnae":
      case "jc":
        if (this.flags.CF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jbe":
      case "jna":
        if (this.flags.CF || this.flags.ZF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "js":
        if (this.flags.SF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jns":
        if (!this.flags.SF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jo":
        if (this.flags.OF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jno":
        if (!this.flags.OF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jp":
      case "jpe":
        if (this.flags.PF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jnp":
      case "jpo":
        if (!this.flags.PF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "jcxz":
        if (this.reg.cx === 0) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "loop":
        this.reg.cx = (this.reg.cx - 1) & 0xffff;
        if (this.reg.cx !== 0) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "loope":
      case "loopz":
        this.reg.cx = (this.reg.cx - 1) & 0xffff;
        if (this.reg.cx !== 0 && this.flags.ZF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "loopne":
      case "loopnz":
        this.reg.cx = (this.reg.cx - 1) & 0xffff;
        if (this.reg.cx !== 0 && !this.flags.ZF) {
          this.jumpTo(args[0]);
          return this.ip;
        }
        break;
      case "call": {
        // The destination is settled first: a call that cannot be made must
        // leave the stack exactly as it found it.
        const indirect = this.isIndirectTarget(args[0]!);
        const target = indirect
          ? this.readOperand(args[0]!, 2)
          : (this.a.labels[args[0]!.trim().toLowerCase()] ?? -1);
        if (target < 0) this.jumpTo(args[0]!); // throws the usual unknown-label error
        // The return address goes on the memory stack, because that is where a
        // procedure expects to find it: [BP+2] inside a `PUSH BP / MOV BP, SP`
        // frame, and where `RET n` measures the frame from. The call stack is
        // the display mirror of the same return.
        this.reg.sp -= 2;
        writeUnit(this.mem, this.reg.sp, this.ip + 1, 2);
        this.pushData(this.ip + 1);
        this.pushCall(this.ip + 1, instr.ln);
        this.ip = target;
        return this.ip;
      }
      case "ret":
      case "iret": {
        // `INT` pushes nothing in this flat model, so `IRET` is the same
        // return as `RET`. Both read the destination off the memory stack and
        // keep the call stack as its mirror; `RET n` also drops n bytes of
        // arguments the caller left behind.
        if (this.callStack.length === 0) {
          this.halted = true;
          return false;
        }
        const extra = args[0]
          ? (parseNumber(args[0]) ?? this.evalConst(args[0]) ?? 0)
          : 0;
        const target = this.mem[this.reg.sp] | (this.mem[this.reg.sp + 1] << 8);
        this.reg.sp += 2 + extra;
        if (this.dataStack.length) this.dataStack.pop();
        this.callStack.pop();
        return target;
      }
      case "nop":
        break;
      case "movsb":
      case "movsw":
      case "stosb":
      case "stosw":
      case "lodsb":
      case "lodsw":
      case "cmpsb":
      case "cmpsw":
      case "scasb":
      case "scasw":
        this.executeStringOp(op, rep);
        break;
      case "int": {
        const n = parseNumber(args[0]) ?? parseInt(args[0], 16);
        if (Number.isNaN(n)) throw new AsmError(`Bad interrupt number "${args[0]}"`, instr.ln);
        const ctx = {
          get8: (r: Reg8Name) => this.get8(r),
          set8: (r: Reg8Name, v: number) => this.set8(r, v),
          get16: (r: Reg16Name) => this.reg[r],
          reg: this.reg,
          mem: this.mem,
          print: (s: string) => this.print(s),
          printByte: (b: number) => this.printByte(b),
          halt: () => {
            this.halted = true;
          },
          readInputChar: () => this.readInputChar(),
          peekInputChar: () => this.peekInputChar(),
          waitingForInput: this.waitingForInput,
          setCF: (v: number) => {
            this.flags.CF = v ? 1 : 0;
          },
          setZF: (v: number) => {
            this.flags.ZF = v ? 1 : 0;
          },
          getCursor: () => ({
            row: this.console.cursorRow,
            col: this.console.cursorCol,
          }),
          setCursor: (row: number, col: number) => {
            this.console.setCursor(row, col);
          },
          clearScreen: () => {
            this.console.clear();
          },
          getVideoMode: () => this.videoMode,
          setVideoMode: (mode: number) => {
            this.videoMode = mode;
          },
          files: this.files,
        };
        const result = handleInterrupt(n, ctx);
        this.waitingForInput = ctx.waitingForInput;
        if (result.halt) {
          this.halted = true;
          return false;
        }
        if (result.waitForInput) return this.ip;
        if (!result.handled) {
          const service = this.get8("ah").toString(16).toUpperCase().padStart(2, "0");
          throw new AsmError(
            `Unsupported INT ${n.toString(16).toUpperCase()}h service ${service}h`,
            instr.ln,
          );
        }
        break;
      }
      case "into":
        if (this.flags.OF) throw new AsmError("INTO: overflow trap");
        break;
      default:
        throw new AsmError(`Unsupported instruction "${op.toUpperCase()}"`, instr.ln);
    }

    return nextIp;
  }

  private executeStringOp(
    op: string,
    rep?: Instruction["rep"],
  ): boolean | number {
    const step = op.endsWith("w") ? 2 : 1;
    const count = rep ? this.reg.cx : 1;
    const df = this.flags.DF ? -step : step;

    for (let i = 0; i < count; i++) {
      if (rep && this.reg.cx === 0) break;

      switch (op) {
        case "movsb":
        case "movsw": {
          const val =
            step === 2
              ? this.mem[this.reg.si] | (this.mem[this.reg.si + 1] << 8)
              : this.mem[this.reg.si];
          if (step === 2) writeUnit(this.mem, this.reg.di, val, 2);
          else this.mem[this.reg.di] = val & 0xff;
          this.reg.si = (this.reg.si + df) & 0xffff;
          this.reg.di = (this.reg.di + df) & 0xffff;
          break;
        }
        case "stosb":
        case "stosw": {
          const val = step === 2 ? this.reg.ax : this.get8("al");
          if (step === 2) writeUnit(this.mem, this.reg.di, val, 2);
          else this.mem[this.reg.di] = val & 0xff;
          this.reg.di = (this.reg.di + df) & 0xffff;
          break;
        }
        case "lodsb":
        case "lodsw": {
          const val =
            step === 2
              ? this.mem[this.reg.si] | (this.mem[this.reg.si + 1] << 8)
              : this.mem[this.reg.si];
          if (step === 2) this.reg.ax = val;
          else this.set8("al", val);
          this.reg.si = (this.reg.si + df) & 0xffff;
          break;
        }
        case "cmpsb":
        case "cmpsw": {
          const a =
            step === 2
              ? this.mem[this.reg.si] | (this.mem[this.reg.si + 1] << 8)
              : this.mem[this.reg.si];
          const b =
            step === 2
              ? this.mem[this.reg.di] | (this.mem[this.reg.di + 1] << 8)
              : this.mem[this.reg.di];
          setFlagsAfterOp(this.flags, a - b, step as 1 | 2, "cmp", a, b);
          this.reg.si = (this.reg.si + df) & 0xffff;
          this.reg.di = (this.reg.di + df) & 0xffff;
          break;
        }
        case "scasb":
        case "scasw": {
          const a = step === 2 ? this.reg.ax : this.get8("al");
          const b =
            step === 2
              ? this.mem[this.reg.di] | (this.mem[this.reg.di + 1] << 8)
              : this.mem[this.reg.di];
          setFlagsAfterOp(this.flags, a - b, step as 1 | 2, "cmp", a, b);
          this.reg.di = (this.reg.di + df) & 0xffff;
          break;
        }
      }

      if (rep) {
        this.reg.cx = (this.reg.cx - 1) & 0xffff;
        if (rep === "repe" || rep === "repz") {
          if (!this.flags.ZF) break;
        } else if (rep === "repne" || rep === "repnz") {
          if (this.flags.ZF) break;
        }
        if (this.reg.cx === 0) break;
      } else {
        break;
      }
    }

    return this.ip + 1;
  }
}

/** True when a token ends in one of the radix letters `parseNumber` accepts. */
function endsWithRadixLetter(token: string): boolean {
  switch (token.charCodeAt(token.length - 1)) {
    case 0x62: // b
    case 0x42: // B
    case 0x64: // d
    case 0x44: // D
    case 0x68: // h
    case 0x48: // H
    case 0x6f: // o
    case 0x4f: // O
    case 0x71: // q
    case 0x51: // Q
      return true;
    default:
      return false;
  }
}

/** Reinterpret a value of the given width as two's complement. */
function signedValue(v: number, size: 1 | 2): number {
  return size === 1 ? (v << 24) >> 24 : (v << 16) >> 16;
}

export function createMachine(assembled: AssembledProgram): Machine {
  return new Machine(assembled);
}

export function resetMachine(assembled: AssembledProgram): Machine {
  return new Machine(assembled);
}
