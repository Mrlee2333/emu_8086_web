import { AsmError } from "./errors";
import { evalExpr, isBareIdentifier } from "./expr";
import type { SymbolLookup } from "./expr";
import type { AssembledProgram, Instruction } from "./types";
import {
  parseNumber,
  splitArgs,
  stripComment,
  writeUnit,
} from "./utils";

/**
 * Assemble MASM-style 8086 source into an interpretive program model.
 * Uses a flat memory model: data starts at offset 0, code is instruction list.
 */
export function assemble(src: string): AssembledProgram {
  // A dispatch table such as `HANDLERS DW HANDLE_ADD, HANDLE_SUB` names code
  // labels that are only known once the code has been read, so the source is
  // read twice: once to find the labels, then for real. The first pass keeps
  // going past anything it cannot resolve, since the second pass is the one
  // that reports errors.
  const seed = firstPassLabels(src);
  return parse(src, seed, false);
}

/** Code labels of the source, found without reporting any error. */
function firstPassLabels(src: string): Record<string, number> {
  const program = parse(src, {}, true);
  return program.labels;
}

function parse(
  src: string,
  codeLabels: Record<string, number>,
  tolerant: boolean,
): AssembledProgram {
  const rawLines = src.split("\n");
  const mem = new Uint8Array(65536);
  const dataVars: AssembledProgram["dataVars"] = {};
  const symbols: AssembledProgram["symbols"] = {};
  let dataPtr = 0;
  const instrs: Instruction[] = [];
  const labels: Record<string, number> = {};
  let section: "data" | "code" | null = null;
  let entryLabel: string | null = null;
  let lastDataVar: string | null = null;

  /** Constants and data addresses visible to an expression at this point. */
  const lookup: SymbolLookup = (name) => {
    if (symbols[name] !== undefined) return symbols[name];
    if (dataVars[name] !== undefined) return dataVars[name]!.addr;
    // A code label in a data table holds the place of its instruction.
    if (codeLabels[name] !== undefined) return codeLabels[name];
    return undefined;
  };
  /** `$`: the location counter of whichever section is being read. */
  const here = () => (section === "code" ? instrs.length : dataPtr);

  /** A `db` / `dw` declaration, wherever in the source it was written. */
  const declareData = (text: string, ln: number): void => {
    lastDataVar = parseDataLine(
      text,
      ln,
      mem,
      dataVars,
      lookup,
      () => dataPtr,
      (v) => {
        dataPtr = v;
      },
      lastDataVar,
      tolerant,
    );
  };

  const cleaned: { text: string; ln: number }[] = [];
  for (let ln = 0; ln < rawLines.length; ln++) {
    const line = stripComment(rawLines[ln]).trim();
    if (!line) continue;
    cleaned.push({ text: line, ln: ln + 1 });
  }

  for (const { text, ln } of cleaned) {
    const lower = text.toLowerCase();

    if (/^\.model\b/i.test(text)) continue;
    if (/^\.stack\b/i.test(text)) continue;
    if (/^\.data\b/i.test(text)) {
      section = "data";
      // A bare `db`/`dw` continues the declaration before it, and only within
      // its own section.
      lastDataVar = null;
      continue;
    }
    if (/^\.code\b/i.test(text)) {
      section = "code";
      lastDataVar = null;
      continue;
    }
    if (/^end\s+/i.test(text) || /^end$/i.test(lower)) {
      const m = text.match(/^end\s+(\w+)/i);
      if (m) entryLabel = m[1].toLowerCase();
      continue;
    }

    // ORG sets a program origin. Code is an instruction list, so a code ORG
    // only matters to the address a COM file would load at; in data it moves
    // the location counter, and the gap is already zero in a fresh image.
    const org = text.match(/^org\b\s*(.+)$/i);
    if (org) {
      const at = evalExpr(org[1]!, lookup, here());
      if (at !== null && section === "data") dataPtr = at;
      continue;
    }

    // NAME EQU value, or the older `NAME = value` spelling.
    const equ = text.match(/^(\w+)\s+(?:equ|=)\s+(.+)$/i);
    if (equ) {
      const name = equ[1]!.toLowerCase();
      const value = evalExpr(equ[2]!, lookup, here());
      if (value === null) {
        if (tolerant) continue;
        throw new AsmError(
          `Cannot evaluate constant \`${equ[2]!.trim()}\` in \`${name} EQU\``,
          ln,
        );
      }
      symbols[name] = value;
      continue;
    }

    if (section === "data") {
      declareData(text, ln);
      continue;
    }

    if (section === "code" || section === null) {
      // A COM-style program keeps its data in the code segment, after a jump
      // over it. The data lands in the same flat memory, so the label resolves
      // and the declaration never becomes an instruction.
      if (/^(\w+)\s+(db|dw)\s+/i.test(text) || /^(db|dw)\s+/i.test(text)) {
        declareData(text, ln);
        continue;
      }
      parseCodeLine(text, ln, instrs, labels);
    }
  }

  let entry = 0;
  if (entryLabel && labels[entryLabel] !== undefined) {
    entry = labels[entryLabel];
  }

  return { mem, dataVars, instrs, labels, symbols, entry };
}

function parseDataLine(
  text: string,
  ln: number,
  mem: Uint8Array,
  dataVars: AssembledProgram["dataVars"],
  lookup: SymbolLookup,
  getPtr: () => number,
  setPtr: (v: number) => void,
  lastDataVar: string | null,
  tolerant: boolean,
): string {
  const withLabel = text.match(/^(\w+)\s+(db|dw)\s+(.*)$/i);
  const continuation = !withLabel ? text.match(/^(db|dw)\s+(.*)$/i) : null;

  if (!withLabel && !continuation) {
    if (tolerant) return lastDataVar ?? "";
    throw new AsmError(`Cannot parse data declaration: "${text}"`, ln);
  }
  if (continuation && !lastDataVar) {
    throw new AsmError(`Cannot parse data declaration: "${text}"`, ln);
  }

  const name = withLabel ? withLabel[1].toLowerCase() : lastDataVar!;
  const kind = (withLabel ? withLabel[2] : continuation![1]).toLowerCase();
  const rest = withLabel ? withLabel[3] : continuation![2];
  const unitSize = kind === "dw" ? 2 : 1;

  if (continuation) {
    const prev = dataVars[name];
    if (prev.unitSize !== unitSize) {
      throw new AsmError(
        `Data type mismatch on continuation line (expected ${prev.unitSize === 2 ? "dw" : "db"})`,
        ln,
      );
    }
  }

  const addr = withLabel ? getPtr() : dataVars[name].addr;
  let count = 0;
  let dataPtr = getPtr();

  const parts = splitArgs(rest);
  for (let p of parts) {
    p = p.trim();
    const dupM = p.match(/^(.+?)\s+dup\s*\(\s*(.*?)\s*\)$/i);
    if (dupM) {
      const n = evalExpr(dupM[1]!, lookup, dataPtr);
      if (n === null || n < 0) {
        if (tolerant) continue;
        throw new AsmError(`Bad DUP count \`${dupM[1]!.trim()}\``, ln);
      }
      const fillTok = dupM[2]!.trim();
      const fillVal =
        fillTok === "?"
          ? 0
          : isBareIdentifier(fillTok)
            ? (evalExpr(fillTok, lookup, dataPtr) ?? parseNumber(fillTok) ?? 0)
            : (parseNumber(fillTok) ?? evalExpr(fillTok, lookup, dataPtr) ?? 0);
      for (let k = 0; k < n; k++) {
        writeUnit(mem, dataPtr, fillVal, unitSize as 1 | 2);
        dataPtr += unitSize;
        count++;
      }
      continue;
    }
    if (/^'.*'$/.test(p) || /^".*"$/.test(p)) {
      const str = p.slice(1, -1);
      for (let k = 0; k < str.length; k++) {
        writeUnit(mem, dataPtr, str.charCodeAt(k), unitSize as 1 | 2);
        dataPtr += unitSize;
        count++;
      }
      continue;
    }
    if (p === "?") {
      writeUnit(mem, dataPtr, 0, unitSize as 1 | 2);
      dataPtr += unitSize;
      count++;
      continue;
    }
    // A name that is defined is a value even when it is spelled like a number.
    const val = isBareIdentifier(p)
      ? (evalExpr(p, lookup, dataPtr) ?? parseNumber(p))
      : (parseNumber(p) ?? evalExpr(p, lookup, dataPtr));
    if (val === null) {
      if (tolerant) {
        dataPtr += unitSize;
        count++;
        continue;
      }
      throw new AsmError(`Bad value \`${p}\` in data declaration`, ln);
    }
    writeUnit(mem, dataPtr, val, unitSize as 1 | 2);
    dataPtr += unitSize;
    count++;
  }

  setPtr(dataPtr);

  if (withLabel) {
    dataVars[name] = { addr, unitSize: unitSize as 1 | 2, count };
  } else {
    dataVars[name].count += count;
  }

  return name;
}

function parseCodeLine(
  text: string,
  ln: number,
  instrs: Instruction[],
  labels: Record<string, number>,
): void {
  let line = text;

  const procM = line.match(/^(\w+)\s+proc\b/i);
  if (procM) {
    labels[procM[1].toLowerCase()] = instrs.length;
    return;
  }

  if (/^(\w+)\s+endp\b/i.test(line)) return;

  const labelM = line.match(/^(\w+)\s*:\s*(.*)$/);
  if (labelM) {
    labels[labelM[1].toLowerCase()] = instrs.length;
    line = labelM[2].trim();
    if (!line) return;
  }

  const repM = line.match(/^(repne|repnz|repe|repz|rep)\s+(.+)$/i);
  let rep: Instruction["rep"];
  if (repM) {
    const r = repM[1].toLowerCase();
    rep =
      r === "repne" || r === "repnz"
        ? "repne"
        : r === "repe" || r === "repz"
          ? "repe"
          : "rep";
    line = repM[2].trim();
  }

  const im = line.match(/^([a-z]+)\s*(.*)$/i);
  if (!im) throw new AsmError(`Cannot parse instruction: "${text}"`, ln);

  const op = im[1].toLowerCase();
  const argStr = im[2].trim();
  const args = argStr ? splitArgs(argStr).map((a) => a.trim()) : [];
  instrs.push({ op, args, ln, rep });
}
