/**
 * Step Back capture/restore tests (v1.3.1 time-travel).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import { createMachine } from "./machine";

const SRC = `.model small
.data
.code
main proc
    mov ax, 5
    mov bx, 10
    add ax, bx
    mov ah, 4ch
    int 21h
main endp
end main
`;

describe("step back capture/restore", () => {
  it("restores registers and ip", () => {
    const m = createMachine(assemble(SRC));
    const s0 = m.capture();
    m.step();
    assert.equal(m.reg.ax, 5);
    const s1 = m.capture();
    m.step();
    m.step();
    assert.equal(m.reg.ax, 15);
    m.restore(s1);
    assert.equal(m.reg.ax, 5);
    assert.equal(m.reg.bx, 0);
    m.restore(s0);
    assert.equal(m.reg.ax, 0);
    assert.equal(m.reg.bx, 0);
    assert.equal(m.ip, s0.ip);
  });

  it("restores memory and console output", () => {
    const src = `.model small
.data
msg db 'Hi$'
.code
main proc
    mov ah, 09h
    lea dx, msg
    int 21h
    mov ax, 1234h
    mov ah, 4ch
    int 21h
main endp
end main
`;
    const m = createMachine(assemble(src));
    m.step();
    m.step();
    m.step();
    assert.equal(m.output, "Hi");
    const snap = m.capture();
    m.step();
    assert.equal(m.reg.ax, 0x1234);
    m.restore(snap);
    assert.equal(m.output, "Hi");
    // AH=09h leftover from the print call, AL untouched
    assert.equal(m.reg.ax, 0x0900);
    assert.equal(m.halted, false);
  });

  it("restore un-halts from halted state", () => {
    const m = createMachine(assemble(SRC));
    const states = [];
    states.push(m.capture());
    while (m.step()) {
      states.push(m.capture());
      if (states.length > 10) break;
    }
    assert.equal(m.halted, true);
    m.restore(states[states.length - 1]);
    assert.equal(m.halted, false);
  });
});
