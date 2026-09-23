/**
 * Watch-expression evaluation for the debugger (v1.3.2).
 * Read-only: reuses the Machine operand readers, never mutates CPU state.
 * Supported: registers (`ax`, `al`), data-variable names, memory operands
 * (`[0x100]`, `arr[si]`, `byte ptr [bx]`), and numeric literals
 * (`255`, `0xFF`, `FFh`, `101b`, `'A'`).
 */

import type { Machine } from "@/lib/emulator/machine";

export type WatchResult =
  | {
      expr: string;
      ok: true;
      size: 1 | 2;
      dec: string;
      hex: string;
      signed: string;
      ascii: string | null;
    }
  | { expr: string; ok: false; error: string };

export const WATCH_STORAGE_KEY = "emu8086web:watch:v1";

/** Hard caps so a pasted list cannot blow up localStorage / render. */
export const MAX_WATCHES = 32;
export const MAX_WATCH_CHARS = 64;

function toSigned(value: number, size: 1 | 2): number {
  if (size === 1) {
    const v = value & 0xff;
    return v >= 0x80 ? v - 0x100 : v;
  }
  const v = value & 0xffff;
  return v >= 0x8000 ? v - 0x10000 : v;
}

export function evaluateWatch(
  expr: string,
  machine: Machine | null,
): WatchResult {
  const token = (expr ?? "").trim();
  if (!token) return { expr, ok: false, error: "Empty expression" };
  if (token.length > MAX_WATCH_CHARS) {
    return { expr, ok: false, error: "Expression too long" };
  }
  if (!machine) {
    return { expr, ok: false, error: "Compile first" };
  }
  try {
    const size = machine.operandSize(token);
    const raw = machine.readOperand(token, size);
    const value = raw & (size === 2 ? 0xffff : 0xff);
    const hex =
      size === 2
        ? `0x${value.toString(16).padStart(4, "0").toUpperCase()}`
        : `0x${value.toString(16).padStart(2, "0").toUpperCase()}`;
    const ascii =
      size === 1 && value >= 32 && value < 127
        ? `'${String.fromCharCode(value)}'`
        : null;
    return {
      expr,
      ok: true,
      size,
      dec: String(value),
      hex,
      signed: String(toSigned(value, size)),
      ascii,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cannot evaluate";
    return { expr, ok: false, error: msg };
  }
}

export function loadWatches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(WATCH_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((w): w is string => typeof w === "string")
      .map((w) => w.trim())
      .filter((w) => w.length > 0 && w.length <= MAX_WATCH_CHARS)
      .slice(0, MAX_WATCHES);
  } catch {
    return [];
  }
}

export function saveWatches(list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      WATCH_STORAGE_KEY,
      JSON.stringify(list.slice(0, MAX_WATCHES)),
    );
  } catch {
    /* quota / private mode — watches simply don't persist */
  }
}
