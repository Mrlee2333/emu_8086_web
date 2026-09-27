/**
 * Memory search helpers for the hex-dump panel (v1.3.2).
 * Pure functions over the 64 KiB address space — no DOM, no React.
 */

/** Longest searchable byte pattern (keeps scans instant). */
export const MAX_PATTERN_BYTES = 64;

/** Max matches counted for the status line (scan itself stays cheap). */
export const MAX_COUNTED_MATCHES = 1000;

/**
 * Parse a search query into bytes.
 * - `"48 65 6C"` / `"48,65,6C"` (hex pairs) → those bytes
 * - `"0x48 0x65"` → those bytes
 * - `'Hi'` / `"Hi"` (quoted) → ASCII bytes of the inner text
 * - anything else → UTF-8 bytes of the literal text
 * Returns null for empty / unparseable input.
 */
export function parseSearchPattern(raw: string): Uint8Array | null {
  const q = (raw ?? "").trim();
  if (!q) return null;

  const quoted = q.match(/^'([\s\S]*)'$/) ?? q.match(/^"([\s\S]*)"$/);
  if (quoted) {
    const bytes = new TextEncoder().encode(quoted[1] ?? "");
    if (bytes.length === 0 || bytes.length > MAX_PATTERN_BYTES) return null;
    return bytes;
  }

  const no0x = q.replace(/0x/gi, "");
  const compact = no0x.replace(/[\s,;]+/g, "");
  const hadSeparators = /[\s,;]/.test(q) || /0x/i.test(q);
  if (
    compact.length > 0 &&
    compact.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(compact) &&
    (hadSeparators || compact.length <= 8)
  ) {
    const out = new Uint8Array(compact.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    }
    if (out.length > MAX_PATTERN_BYTES) return null;
    return out;
  }

  // Bare short hex without separators is ambiguous with text ("beef"):
  // treat as literal text so ASCII search keeps working.
  if (!hadSeparators && /^[0-9a-f]+$/i.test(compact) && compact.length > 8) {
    const bytes = new TextEncoder().encode(q);
    return bytes.length > MAX_PATTERN_BYTES ? null : bytes;
  }

  const bytes = new TextEncoder().encode(q);
  if (bytes.length === 0 || bytes.length > MAX_PATTERN_BYTES) return null;
  return bytes;
}

/**
 * Next match at or after `from`, plus the match count, in a single pass.
 *
 * Two calls became one: the status line used to run `findNextMatch` and then
 * `countMatches`, traversing the 64 KiB space twice per click.
 *
 * The scan stops as soon as both answers are settled — `next` found and the
 * count at the display cap. That matters: for a common pattern the cap is
 * reached in the first few hundred bytes, and an unconditional full-space
 * scan would be *slower* than the two short scans this replaces. When matches
 * are sparse the pass is bounded by the address space and still halves the
 * work.
 */
export function searchAndCount(
  mem: Uint8Array,
  pattern: Uint8Array,
  from = 0,
  max = MAX_COUNTED_MATCHES,
): { next: number; count: number } {
  if (pattern.length === 0 || pattern.length > mem.length) {
    return { next: -1, count: 0 };
  }
  const start = Math.max(0, Math.min(Math.floor(from) || 0, mem.length - 1));
  const last = mem.length - pattern.length;
  const first = pattern[0]!;
  const tail = pattern.length - 1;
  let next = -1;
  let count = 0;

  for (let i = 0; i <= last; i++) {
    if (mem[i] !== first) continue;
    let hit = true;
    for (let j = 1; j <= tail; j++) {
      if (mem[i + j] !== pattern[j]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    if (next < 0 && i >= start) next = i;
    if (count < max) count++;
    // Both answers settled; the rest of the space cannot change the result.
    if (count >= max && next >= 0) break;
  }

  return { next, count };
}
