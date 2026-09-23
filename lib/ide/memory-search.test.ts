/**
 * Memory search helper tests (v1.3.2).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countMatches,
  findNextMatch,
  parseSearchPattern,
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

describe("findNextMatch", () => {
  const mem = new Uint8Array(256);
  mem[10] = 0x48;
  mem[11] = 0x69;
  mem[100] = 0x48;
  mem[101] = 0x69;

  it("finds first and next occurrences", () => {
    const pat = new Uint8Array([0x48, 0x69]);
    assert.equal(findNextMatch(mem, pat, 0), 10);
    assert.equal(findNextMatch(mem, pat, 11), 100);
  });

  it("returns -1 when absent or out of range", () => {
    assert.equal(findNextMatch(mem, new Uint8Array([0xff]), 0), -1);
    assert.equal(findNextMatch(mem, new Uint8Array([0x48, 0x69]), 101), -1);
    assert.equal(findNextMatch(mem, new Uint8Array([]), 0), -1);
  });

  it("clamps wild start offsets", () => {
    const pat = new Uint8Array([0x48, 0x69]);
    assert.equal(findNextMatch(mem, pat, -50), 10);
    assert.equal(findNextMatch(mem, pat, NaN), 10);
  });
});

describe("countMatches", () => {
  it("counts occurrences", () => {
    const mem = new Uint8Array(64);
    mem[5] = 1;
    mem[6] = 1;
    mem[7] = 1;
    assert.equal(countMatches(mem, new Uint8Array([1])), 3);
    assert.equal(countMatches(mem, new Uint8Array([2])), 0);
    assert.equal(countMatches(mem, new Uint8Array([])), 0);
  });
});
