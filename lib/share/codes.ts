import { createHash, randomBytes } from "node:crypto";
import { SHARE_CODE_LENGTH } from "@/lib/share/constants";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Largest multiple of the alphabet size that fits in a byte (36 × 7 = 252).
 * Bytes at or above this are rejected rather than folded, so every character
 * is equally likely — `byte % 36` would favour the first four by 1/252.
 */
const REJECT_AT = 252;

export function hashSource(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function byteLengthUtf8(source: string): number {
  return Buffer.byteLength(source, "utf8");
}

export function generateShareCode(): string {
  let out = "";
  while (out.length < SHARE_CODE_LENGTH) {
    // Draw a surplus so rejections still fill the code in one round, almost
    // always; the loop is only a correctness backstop.
    const bytes = randomBytes(SHARE_CODE_LENGTH * 2);
    for (const byte of bytes) {
      if (byte >= REJECT_AT) continue;
      out += ALPHABET[byte % ALPHABET.length]!;
      if (out.length === SHARE_CODE_LENGTH) break;
    }
  }
  return out;
}
