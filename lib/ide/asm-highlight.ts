/**
 * Tiny 8086 assembly tokenizer for editor syntax highlighting (v1.4.0).
 * Pure + dependency-free so it is unit tested and reused by the CodeEditor
 * overlay. Keeps the textarea as the single source of truth — this only
 * maps text spans to CSS classes.
 */

export type AsmTokenKind =
  | "comment"
  | "string"
  | "number"
  | "register"
  | "mnemonic"
  | "directive"
  | "label"
  | "punct"
  | "text";

export type AsmToken = {
  kind: AsmTokenKind;
  value: string;
};

const REGISTERS = new Set([
  "ax", "bx", "cx", "dx", "si", "di", "bp", "sp",
  "al", "ah", "bl", "bh", "cl", "ch", "dl", "dh",
  "cs", "ds", "es", "ss",
]);

const MNEMONICS = new Set([
  "mov", "xchg", "lea", "lds", "les",
  "add", "adc", "sub", "sbb", "mul", "imul", "div", "idiv",
  "inc", "dec", "neg", "cmp", "cbw", "cwd",
  "and", "or", "xor", "not", "shl", "shr", "sal", "sar",
  "rol", "ror", "rcl", "rcr",
  "jmp", "je", "jne", "jz", "jnz", "jc", "jnc", "jb", "jnb",
  "ja", "jna", "jg", "jge", "jl", "jle", "loop", "loope",
  "loopne", "call", "ret", "int", "iret", "nop", "hlt",
  "push", "pop", "pushf", "popf",
  "movsb", "movsw", "stosb", "stosw", "lodsb", "lodsw",
  "cmpsb", "cmpsw", "scasb", "scasw", "rep", "repe", "repne",
  "in", "out", "test",
]);

const DIRECTIVES = new Set([
  "model", "stack", "data", "code", "end", "ends", "segment",
  "proc", "endp", "macro", "endm", "db", "dw", "dd", "dq", "dt",
  "dup", "equ", "org", "include", "byte", "word", "ptr", "offset",
]);

/** Tokenize one line; comments (`;`) terminate scanning unless in a string. */
export function tokenizeAsmLine(line: string): AsmToken[] {
  const tokens: AsmToken[] = [];
  let i = 0;
  const push = (kind: AsmTokenKind, value: string) => {
    if (value) tokens.push({ kind, value });
  };

  while (i < line.length) {
    const ch = line[i];
    // Comment starts at a bare `;` (strings handled below).
    if (ch === ";") {
      push("comment", line.slice(i));
      break;
    }
    // Whitespace stays unstyled so overlay alignment matches the textarea.
    if (ch === " " || ch === "\t") {
      let j = i + 1;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
      push("text", line.slice(i, j));
      i = j;
      continue;
    }
    // Strings: '...' or "..." (MASM allows both in DB/DW).
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j++;
      if (j < line.length) j++;
      push("string", line.slice(i, j));
      i = j;
      continue;
    }
    // Numbers: hex (1A2Bh / 0x1A / 1010b), decimal.
    const numMatch = /^[0-9][0-9a-fA-F]*[hHbBdD]?|^0[xX][0-9a-fA-F]+/.exec(
      line.slice(i),
    );
    if (numMatch && /[0-9]/.test(numMatch[0][0])) {
      const raw = numMatch[0];
      // Only accept suffix letters that form a valid number token.
      if (/^0[xX][0-9a-fA-F]+$/.test(raw) || /^[0-9][0-9a-fA-F]*[hHbBdD]?$/.test(raw)) {
        push("number", raw);
        i += raw.length;
        continue;
      }
    }
    // Words: registers, mnemonics, directives, labels (`name:`), or text.
    const wordMatch = /^[A-Za-z_?$@][A-Za-z0-9_?$@]*/.exec(line.slice(i));
    if (wordMatch) {
      const word = wordMatch[0];
      const low = word.toLowerCase();
      const j = i + word.length;
      const isLabel = line[j] === ":";
      if (isLabel) {
        push("label", word + ":");
        i = j + 1;
        continue;
      }
      if (REGISTERS.has(low)) push("register", word);
      else if (MNEMONICS.has(low)) push("mnemonic", word);
      else if (DIRECTIVES.has(low)) push("directive", word);
      else push("text", word);
      i = j;
      continue;
    }
    // Brackets, commas, operators, dots.
    push("punct", ch);
    i++;
  }
  return tokens;
}

/** Tokenize a full document into per-line token rows. */
export function tokenizeAsm(source: string): AsmToken[][] {
  return source.split("\n").map((line) => tokenizeAsmLine(line));
}

/** CSS class for a token kind (matches CodeEditor overlay styles). */
export function tokenClass(kind: AsmTokenKind): string {
  switch (kind) {
    case "comment":
      return "tok-comment";
    case "string":
      return "tok-string";
    case "number":
      return "tok-number";
    case "register":
      return "tok-register";
    case "mnemonic":
      return "tok-mnemonic";
    case "directive":
      return "tok-directive";
    case "label":
      return "tok-label";
    case "punct":
      return "tok-punct";
    case "text":
      return "tok-text";
  }
}
