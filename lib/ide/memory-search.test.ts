/**
 * Memory search helper tests (v1.3.2).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_COUNTED_MATCHES,
  parseSearchPattern,
  searchAndCount,
} from "./memory-search";

describe("parseSearchPattern", () => {
  it("parses hex pairs with spaces / commas", () => {
    assert.deepEqual([...parseSearchPattern("48 65 6C")!], [0x48, 0x65, 0x6c]);
    assert.deepEqual([...parseSearchPattern("48,65")!], [0x48, 0x65]);
  });

  it("parses 0x-prefixed hex", () => {
    assert.deepEqual([...parseSearchPattern("0x48 0x65")!], [0x48, 0x65]);
  });

  it("treats quoted input as ASCII", () => {
    assert.deepEqual([...parseSearchPattern("'Hi'")!], [0x48, 0x69]);
    assert.deepEqual([...parseSearchPattern('"Hi"')!], [0x48, 0x69]);
  });

  it("treats plain text as literal bytes", () => {
    assert.deepEqual([...parseSearchPattern("Hi")!], [0x48, 0x69]);
  });

  it("rejects empty input", () => {
    assert.equal(parseSearchPattern(""), null);
    assert.equal(parseSearchPattern("   "), null);
    assert.equal(parseSearchPattern("''"), null);
  });
});

describe("searchAndCount", () => {
  const mem = new Uint8Array(256);
  mem[10] = 0x48;
  mem[11] = 0x69;
  mem[100] = 0x48;
  mem[101] = 0x69;

  it("returns the next hit at or after `from`", () => {
    const pat = new Uint8Array([0x48, 0x69]);
    assert.equal(searchAndCount(mem, pat, 0).next, 10);
    assert.equal(searchAndCount(mem, pat, 11).next, 100);
    assert.equal(searchAndCount(mem, pat, 101).next, -1);
  });

  it("returns -1 when absent or the pattern is empty", () => {
    assert.equal(searchAndCount(mem, new Uint8Array([0xff]), 0).next, -1);
    assert.equal(searchAndCount(mem, new Uint8Array([]), 0).next, -1);
    assert.equal(searchAndCount(mem, new Uint8Array([]), 0).count, 0);
  });

  it("clamps wild start offsets", () => {
    const pat = new Uint8Array([0x48, 0x69]);
    assert.equal(searchAndCount(mem, pat, -50).next, 10);
    assert.equal(searchAndCount(mem, pat, NaN).next, 10);
  });

  it("counts every occurrence across the whole space", () => {
    const hits = new Uint8Array(64);
    hits[5] = 1;
    hits[6] = 1;
    hits[7] = 1;
    assert.equal(searchAndCount(hits, new Uint8Array([1])).count, 3);
    assert.equal(searchAndCount(hits, new Uint8Array([1])).next, 5);
    assert.equal(searchAndCount(hits, new Uint8Array([2])).count, 0);
  });

  it("counts overlapping matches", () => {
    const hits = new Uint8Array(8).fill(0xaa);
    assert.equal(searchAndCount(hits, new Uint8Array([0xaa, 0xaa])).count, 7);
  });

  it("caps the reported count but keeps scanning for the next hit", () => {
    const hits = new Uint8Array(4096).fill(0xaa);
    const { next, count } = searchAndCount(hits, new Uint8Array([0xaa]));
    assert.equal(count, MAX_COUNTED_MATCHES);
    assert.equal(next, 0);
  });

  it("stops scanning once the count cap and the next hit are both settled", () => {
    // Dense memory: the cap is reached in the first few hundred bytes, so a
    // correct implementation must not touch the rest of the address space.
    // Measured by proxy — a Uint8Array whose tail is a throwing getter would
    // be better, but the observable contract is simply that the answer is the
    // same as an exhaustive scan.
    const dense = new Uint8Array(65536).fill(0xaa);
    let reads = 0;
    const counting = new Proxy(dense, {
      get(target, prop) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) reads++;
        return Reflect.get(target, prop);
      },
    });
    const { next, count } = searchAndCount(counting, new Uint8Array([0xaa]));
    assert.equal(next, 0);
    assert.equal(count, MAX_COUNTED_MATCHES);
    // 1000 matches, and one probe per byte examined (0xaa matches every byte).
    // Allow the leading byte check plus the matches themselves.
    assert.ok(
      reads < 1200,
      `expected an early exit after ~1000 matches, read ${reads} bytes`,
    );
  });

  it("agrees with a naive reference implementation", () => {
    // Single pass, but verify the result matches the obvious two-loop form.
    const space = new Uint8Array(1024);
    for (let i = 0; i < space.length; i++) {
      space[i] = (i * 7 + (i % 3)) & 0xff;
    }
    const pat = new Uint8Array([space[5], space[6]]);
    space[500] = pat[0];
    space[501] = pat[1];

    const expectedCount = (() => {
      let n = 0;
      for (let i = 0; i <= space.length - pat.length; i++) {
        if (space[i] === pat[0] && space[i + 1] === pat[1]) n++;
      }
      return n;
    })();

    assert.equal(searchAndCount(space, pat).count, expectedCount);
    // The planted pair at 500 is the only hit at or after 499.
    assert.equal(searchAndCount(space, pat, 499).next, 500);
  });
});
