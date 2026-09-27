/**
 * Frozen efficiency benchmark for `audit/vX.Y.Z.md`.
 *
 * The workload is specified in `audit/README.md` and must not change between
 * versions — that is the only way "vs previous version" means anything:
 *
 *   - Steps   `mov cx,0FFFFh / again: add ax,1 / loop again` (131072 steps)
 *   - Snapshot 200x `machine.capture()` on the halted loop machine
 *   - Console 3000-line `INT 21h AH=02` print loop (`X` + CR + LF per line)
 *   - Search  worst-case full 64 KiB byte scan (counting + next-hit)
 *
 * Timing is the median of `--runs` (default 3) after a warmup pass, so a JIT
 * tier-up does not get recorded as the result. Non-timing figures are real
 * measured values (retained lines, snapshot bytes), not estimates.
 *
 * Usage: bun audit/bench.mjs [--runs N] [--json]
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { assemble } from "../lib/emulator/assemble.ts";
import { createMachine } from "../lib/emulator/machine.ts";
import { DosConsole } from "../lib/emulator/dos-console.ts";
import * as search from "../lib/ide/memory-search.ts";
import * as emulatorConstants from "../lib/emulator/constants.ts";
import { APP_VERSION } from "../lib/version.ts";

/**
 * The search API changed in v1.4.2 (one combined pass replaced
 * `findNextMatch` + `countMatches`). This script is meant to run on the
 * previous version too, so it uses whichever is exported. `workload` is
 * recorded in the output so a report can never silently compare two different
 * searches.
 */
const SEARCH_API = search.searchAndCount ? "searchAndCount" : "findNextMatch+countMatches";
const doSearch = search.searchAndCount
  ? (mem, pat) => search.searchAndCount(mem, pat)
  : (mem, pat) => ({ next: search.findNextMatch(mem, pat, 0), count: search.countMatches(mem, pat) });

/**
 * Read a numeric constant out of a source file.
 *
 * `MAX_STEP_HISTORY` lives in `use-emulator.ts`, which is a "use client" React
 * hook — importing it here would pull React and the whole IDE into the
 * benchmark. Grepping the literal keeps this script dependency-free, and a
 * missing constant throws rather than reporting a silent zero.
 */
function constantFrom(file, name) {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const m = src.match(new RegExp(`${name}\\s*(?::\\s*number\\s*)?=\\s*(\\d[\\d_]*)`));
  if (!m) throw new Error(`bench: could not read ${name} from ${file}`);
  return Number(m[1].replace(/_/g, ""));
}

const LOOP_SRC = `.model small
.stack 100h
.code
main proc
    mov cx, 0FFFFh
again:
    add ax, 1
    loop again
    mov ah, 4Ch
    int 21h
main endp
end main`;

const PRINT_SRC = `.model small
.stack 100h
.code
main proc
    mov cx, 3000
    mov dl, 'X'
p:
    mov ah, 02h
    int 21h
    mov ah, 02h
    mov dl, 0Dh
    int 21h
    mov ah, 02h
    mov dl, 0Ah
    int 21h
    loop p
    mov ah, 4Ch
    int 21h
main endp
end main`;

const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf("--runs") + 1]) || 3;
const AS_JSON = args.includes("--json");

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Run `fn` RUNS times after one warmup, return every sample in ms. */
function timed(fn) {
  fn(); // warmup
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return { median: median(out), runs: out };
}

/** Step a program to completion; throw if it faulted. */
function runTo(src) {
  const m = createMachine(assemble(src));
  let g = 0;
  while (!m.halted && !m.err && g++ < 2_000_000) m.step();
  if (m.err) throw new Error(m.err);
  return m;
}

const out = { version: APP_VERSION, runs: RUNS };

// ---- Steps -----------------------------------------------------------------
const stepped = runTo(LOOP_SRC);
out.steps = { count: stepped.steps };
const stepTiming = timed(() => runTo(LOOP_SRC));
out.steps.ms = Number(stepTiming.median.toFixed(3));
out.steps.runs = stepTiming.runs.map((n) => Number(n.toFixed(3)));
out.steps.perSec = Math.round(out.steps.count / (stepTiming.median / 1000));

// ---- Snapshot --------------------------------------------------------------
// capture() copies all 64 KiB of memory, so this is the cost of one step-back
// checkpoint and the direct driver of the history memory bound.
const snapTiming = timed(() => {
  for (let i = 0; i < 200; i++) stepped.capture();
});
out.snapshot = {
  perCallMs: Number((snapTiming.median / 200).toFixed(5)),
  bytesPerCall: stepped.mem.length,
  times200Ms: Number(snapTiming.median.toFixed(3)),
};

// ---- Console ---------------------------------------------------------------
const printMachine = runTo(PRINT_SRC);
const printTiming = timed(() => runTo(PRINT_SRC));
const console_ = printMachine.output.split("\n");
out.console = {
  ms: Number(printTiming.median.toFixed(3)),
  linesRetained: console_.length,
  charsRetained: printMachine.output.length,
  capLines: DosConsole.MAX_LINES,
};

// ---- Console text materialization (the per-render join) --------------------
// Regression guard for the v1.4.2 memoization: reading `.text` must not
// re-join the line array when the console has not changed.
{
  const c = new DosConsole();
  for (let i = 0; i < 2000; i++) c.write(`line ${i}\r\n`);
  const readTiming = timed(() => {
    for (let i = 0; i < 1000; i++) void c.text;
  });
  out.consoleTextReads = {
    per1000Ms: Number(readTiming.median.toFixed(4)),
    bytes: c.text.length,
  };
}

// ---- Search ----------------------------------------------------------------
// Worst case for a naive matcher: a one-byte pattern that matches everywhere.
const mem = new Uint8Array(65536);
mem.fill(0xaa);
const searchTiming = timed(() => doSearch(mem, new Uint8Array([0xaa])));
out.search = {
  api: SEARCH_API,
  ms: Number(searchTiming.median.toFixed(4)),
  bytesScanned: mem.length,
  matches: doSearch(mem, new Uint8Array([0xaa])).count,
};

// ---- Memory bounds (code constants, quoted not estimated) ------------------
const MAX_STEP_HISTORY = constantFrom(
  "../lib/ide/use-emulator.ts",
  "MAX_STEP_HISTORY",
);
out.bounds = {
  stepBackSnapshots: MAX_STEP_HISTORY,
  stepBackBytes: MAX_STEP_HISTORY * 65536,
  // null before v1.4.2 — the shadow stacks were uncapped, which is the point.
  dataStack: emulatorConstants.MAX_DATA_STACK ?? null,
  callStack: emulatorConstants.MAX_CALL_STACK ?? null,
  consoleLines: DosConsole.MAX_LINES,
};

if (AS_JSON) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`emu8086web benchmark — v${out.version} (median of ${RUNS})`);
  console.log(`  steps          ${out.steps.count} in ${out.steps.ms} ms  (${out.steps.perSec.toLocaleString()}/s)`);
  console.log(`  snapshot       ${out.snapshot.perCallMs} ms/call, ${(out.snapshot.bytesPerCall / 1024).toFixed(0)} KiB`);
  console.log(`  print loop     ${out.console.ms} ms, ${out.console.linesRetained} lines / ${out.console.charsRetained} chars retained`);
  console.log(`  console text   ${out.consoleTextReads.per1000Ms} ms per 1000 reads (${out.consoleTextReads.bytes} bytes)`);
  console.log(`  search 64 KiB  ${out.search.ms} ms, ${out.search.matches} matches (${out.search.api})`);
  console.log(`  bounds         history ${out.bounds.stepBackSnapshots} x 64 KiB = ${(out.bounds.stepBackBytes / 1048576).toFixed(1)} MiB, dataStack ${out.bounds.dataStack ?? "uncapped"}, callStack ${out.bounds.callStack ?? "uncapped"}, console ${out.bounds.consoleLines} lines`);
}
