/**
 * Assembler tests for MASM-style data declarations.
 * Run: bun test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";

describe("multi-line data declarations", () => {
  it("accepts continuation db lines without a label", () => {
    const program = assemble(`.model small
.stack 100h
.data
    marks db 10,20,15,11
          db 12,15,16,18
          db 10,10,10,10
.code
end
`);
    assert.equal(program.dataVars.marks.addr, 0);
    assert.equal(program.dataVars.marks.count, 12);
    assert.deepEqual(
      Array.from(program.mem.slice(0, 12)),
      [10, 20, 15, 11, 12, 15, 16, 18, 10, 10, 10, 10],
    );
  });

  it("assembles a 2D byte matrix as one flat array", () => {
    const program = assemble(`.model small
.stack 100h
.data
    marks db 10,20,15,11
          db 12,15,16,18
          db 10,10,10,10
          db 20,10,20,20
          db 0,0,0,0
          db 5,7,11,15
          db 10,20,10,20
.code
end
`);
    assert.equal(program.dataVars.marks.count, 28);
    assert.deepEqual(
      Array.from(program.mem.slice(0, 28)),
      [
        10, 20, 15, 11, 12, 15, 16, 18, 10, 10, 10, 10, 20, 10, 20, 20, 0, 0,
        0, 0, 5, 7, 11, 15, 10, 20, 10, 20,
      ],
    );
  });

  it("accepts continuation dw lines without a label", () => {
    const program = assemble(`.model small
.data
    values dw 1, 2
           dw 3, 4
.code
end
`);
    assert.equal(program.dataVars.values.count, 4);
    assert.equal(program.mem[0], 1);
    assert.equal(program.mem[2], 2);
    assert.equal(program.mem[4], 3);
    assert.equal(program.mem[6], 4);
  });
});
