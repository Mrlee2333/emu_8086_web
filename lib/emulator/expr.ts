/** Constant expression evaluation for EQU symbols and data values. */
import { parseNumber } from "./utils";

/**
 * Resolves a bare name inside an expression. Returns undefined when the name
 * is not a known constant, which makes the whole expression unresolvable.
 */
export type SymbolLookup = (name: string) => number | undefined;

/**
 * Resolves a register name, for effective addresses such as `[BX+SI-2]`.
 * Register names are reserved words, so they are tried before symbols.
 */
export type RegisterLookup = (name: string) => number | undefined;

interface Parser {
  readonly src: string;
  pos: number;
  readonly lookup: SymbolLookup;
  readonly regs: RegisterLookup;
  readonly here: number;
}

/**
 * Evaluate a MASM-style constant expression.
 *
 * Supports numbers in every suffix this assembler accepts, character
 * constants, `$` (the location counter), named constants, parentheses, and the
 * arithmetic and bitwise operators classroom programs actually use. Returns
 * null rather than throwing, so the caller can word the error for its context.
 */
export function evalExpr(
  src: string,
  lookup: SymbolLookup,
  here = 0,
  regs: RegisterLookup = () => undefined,
): number | null {
  const parser: Parser = { src: src.trim(), pos: 0, lookup, regs, here };
  const value = parseSum(parser);
  if (value === null) return null;
  skipSpace(parser);
  return parser.pos >= parser.src.length ? value : null;
}

/** True when the text is a single name with no operators, e.g. a plain symbol. */
export function isBareIdentifier(src: string): boolean {
  return /^\$?[A-Za-z_][\w$]*$/.test(src.trim());
}

/**
 * True when `text` starts with the whole word `word`. Without the boundary
 * check a symbol called NOTHING would read as NOT followed by HING.
 */
function wordAt(text: string, word: string): boolean {
  if (!text.startsWith(word)) return false;
  const next = text[word.length];
  return next === undefined || !/[A-Za-z0-9_$]/.test(next);
}

function skipSpace(p: Parser): void {
  while (p.pos < p.src.length && /\s/.test(p.src[p.pos]!)) p.pos++;
}

function parseSum(p: Parser): number | null {
  let left = parseProduct(p);
  if (left === null) return null;
  for (;;) {
    skipSpace(p);
    const op = p.src[p.pos];
    if (op !== "+" && op !== "-") return left;
    p.pos++;
    const right = parseProduct(p);
    if (right === null) return null;
    left = op === "+" ? left + right : left - right;
  }
}

function parseProduct(p: Parser): number | null {
  let left = parseUnary(p);
  if (left === null) return null;
  for (;;) {
    skipSpace(p);
    const rest = p.src.slice(p.pos).toLowerCase();
    let op: string | null = null;
    let width = 0;
    if (rest.startsWith("<<") || rest.startsWith(">>")) {
      op = rest.slice(0, 2);
      width = 2;
    } else if (wordAt(rest, "mod")) {
      op = "mod";
      width = 3;
    } else if (rest[0] !== undefined && "*/%&|^".includes(rest[0])) {
      op = rest[0]!;
      width = 1;
    }
    if (op === null) return left;
    p.pos += width;
    const right = parseUnary(p);
    if (right === null) return null;
    switch (op) {
      case "*":
        left = left * right;
        break;
      case "/":
        // A zero divisor is an error, not a zero: folding it to 0 would let a
        // bad constant assemble quietly.
        if (right === 0) return null;
        left = Math.trunc(left / right);
        break;
      case "%":
      case "mod":
        if (right === 0) return null;
        left = left % right;
        break;
      case "&":
        left = left & right;
        break;
      case "|":
        left = left | right;
        break;
      case "^":
        left = left ^ right;
        break;
      case "<<":
        left = left << right;
        break;
      default:
        left = left >> right;
        break;
    }
  }
}

function parseUnary(p: Parser): number | null {
  skipSpace(p);
  const c = p.src[p.pos];
  if (c === "+" || c === "-") {
    p.pos++;
    const v = parseUnary(p);
    if (v === null) return null;
    return c === "-" ? -v : v;
  }
  if (c === "~" || wordAt(p.src.slice(p.pos).toLowerCase(), "not")) {
    p.pos += c === "~" ? 1 : 3;
    const v = parseUnary(p);
    return v === null ? null : ~v;
  }
  return parsePrimary(p);
}

function parsePrimary(p: Parser): number | null {
  skipSpace(p);
  if (p.pos >= p.src.length) return null;

  if (p.src[p.pos] === "(") {
    p.pos++;
    const v = parseSum(p);
    skipSpace(p);
    if (p.src[p.pos] !== ")") return null;
    p.pos++;
    return v;
  }

  if (p.src[p.pos] === "$") {
    p.pos++;
    return p.here;
  }

  const quote = p.src[p.pos];
  if (quote === "'" || quote === '"') {
    const end = p.src.indexOf(quote, p.pos + 1);
    if (end === -1) return null;
    const text = p.src.slice(p.pos + 1, end);
    p.pos = end + 1;
    if (text.length === 0) return null;
    return text.length === 1 ? text.charCodeAt(0) : (parseNumber(text) ?? null);
  }

  const rest = p.src.slice(p.pos);

  // A name is looked up before a number is read, because a symbol can be
  // spelled like a number: EACH is four in hex, and NOBODY is not a number at
  // all. A name that is not defined falls through to the number reading below,
  // and a name with parentheses is a typo rather than a call, so both end up
  // unresolved: `FOO(5)` must not quietly become 5.
  const named = rest.match(/^([A-Za-z_][\w$]*)/);
  if (named) {
    const value = p.regs(named[1]!.toLowerCase()) ?? p.lookup(named[1]!.toLowerCase());
    if (value !== undefined) {
      p.pos += named[1]!.length;
      return value;
    }
    return null;
  }

  const numMatch = rest.match(/^[0-9][0-9a-zA-Z_]*[bBhHdDoOqQ]?|^0x[0-9a-fA-F]+/);
  if (numMatch) {
    const val = parseNumber(numMatch[0]!);
    if (val === null) return null;
    p.pos += numMatch[0].length;
    return val;
  }

  return null;
}
