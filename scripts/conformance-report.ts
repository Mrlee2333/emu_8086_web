/**
 * Conformance report: run every program in a third-party 8086 corpus through
 * this emulator and compare the console output with a recorded golden value.
 *
 * The corpus lives outside this repository, so the report is opt-in:
 *
 *   bun scripts/conformance-report.ts <path-to-corpus> [--limit N] [--out file]
 *
 * The corpus must contain expected-output.json, a map of
 * "Category/name.asm" -> { output, finished }, which is the format used by
 * Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS (MIT).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "../lib/emulator/assemble";
import { createMachine } from "../lib/emulator/machine";
import { AsmError } from "../lib/emulator/errors";

const BUDGET = 2_000_000;
const INPUT = "5\r3\rAMEY\r" + "A".repeat(40) + "\r";

type Verdict =
  | "pass"
  | "diff"
  | "assemble-error"
  | "runtime-error"
  | "needs-input"
  | "budget"
  | "unfinished-expected";

/**
 * Why a program that runs still fails the comparison. The corpus records the
 * output of its own simulator, and some of that output is not something a
 * program can be held to: a screen dump of raw memory, or the wall clock on the
 * day it was recorded.
 */
function diffKind(want: string): string {
  const high = [...want].filter((c) => c.charCodeAt(0) > 0x9f).length;
  if (high > 8) return "recorded output is a screen dump of raw memory";
  if (/\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}:\d{2}:\d{2}\b/.test(want)) {
    return "recorded output holds the clock or the calendar";
  }
  if (/SS, the stack segment|\bDS = |segment address/i.test(want)) {
    return "recorded output holds real segment values";
  }
  if (/\t/.test(want)) return "recorded output keeps tabs unexpanded";
  return "output differs";
}

interface Result {
  name: string;
  topic: string;
  verdict: Verdict;
  detail: string;
  line: number | null;
  source: string;
  got: string;
  want: string;
  steps: number;
}

/** Coarse reason, so the report counts missing features rather than wording. */
function classify(detail: string, source: string): string {
  const s = source.trim().toLowerCase();
  if (/\bequ\b/.test(s)) return "EQU symbol definition";
  if (/^org\b/.test(s)) return "ORG directive";
  if (/\bmacro\b|^%macro|endm/.test(s)) return "MACRO directives";
  if (/^#/.test(s)) return "corpus-specific #comment# syntax";
  if (/\bseg\b/.test(s) || /\bss\b|\bds\b|\bes\b/.test(s)) return "segment/SEG directives";
  if (/\binclude\b|^\s*%/.test(s)) return "INCLUDE / text macro";
  if (/\bdb\b|\bdw\b|\bdd\b/.test(s) && /\bdup\b/.test(s) === false && /[+\-*/()]/.test(s)) {
    return "expression in data declaration";
  }
  if (/\.(code|data|model|stack)\b/.test(s)) return "segment directive form";
  if (/^(include|extrn|public|assume|endm|proc|endp|ends|segment|ends)\b/.test(s)) {
    return "segment directive form";
  }
  return `other: ${detail}`;
}

function runSource(src: string): {
  output: string;
  steps: number;
  err: string | null;
  needsInput: boolean;
  budget: boolean;
} {
  const program = assemble(src);
  const m = createMachine(program);
  m.enqueueInput(INPUT);
  let n = 0;
  while (!m.halted && !m.err) {
    if (m.waitingForInput) break;
    if (n++ >= BUDGET) return { output: m.output, steps: n, err: null, needsInput: false, budget: true };
    m.step();
  }
  return { output: m.output, steps: n, err: m.err, needsInput: m.waitingForInput, budget: false };
}

function main(): void {
  const args = process.argv.slice(2);
  const corpus = args.find((a) => !a.startsWith("--"));
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 0;
  const outArg = args.indexOf("--out");
  const outFile = outArg >= 0 ? args[outArg + 1] : null;

  if (!corpus || !existsSync(corpus)) {
    console.error("usage: bun scripts/conformance-report.ts <corpus-dir> [--limit N] [--out f]");
    process.exit(2);
  }

  const goldenArg = args.indexOf("--golden");
  const goldenPath =
    goldenArg >= 0
      ? args[goldenArg + 1]!
      : [
          join(corpus, "expected-output.json"),
          join(
            corpus,
            "8086 Microprocessor Simulator/js/test/expected-output.json",
          ),
        ].find((p) => existsSync(p)) ?? join(corpus, "expected-output.json");
  if (!existsSync(goldenPath)) {
    console.error(`missing golden file: ${goldenPath} (pass --golden <path>)`);
    process.exit(2);
  }
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Record<
    string,
    { output: string; finished: boolean }
  >;

  let names = Object.keys(golden).sort();
  if (limit > 0) names = names.slice(0, limit);

  const results: Result[] = [];
  for (const name of names) {
    const file = join(corpus, name);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, "utf8");
    const want = golden[name]!.output;
    const topic = name.includes("/") ? name.slice(0, name.indexOf("/")) : "root";

    let verdict: Verdict = "pass";
    let detail = "";
    let got = "";
    let steps = 0;
    let errLine: number | null = null;
    try {
      const r = runSource(src);
      got = r.output;
      steps = r.steps;
      if (r.budget) {
        verdict = "budget";
        detail = `no halt within ${BUDGET} instructions`;
      } else if (r.err) {
        verdict = "runtime-error";
        detail = r.err;
        const lm = r.err.match(/\(line\s+(\d+)\)/);
        if (lm) errLine = Number(lm[1]);
      } else if (r.needsInput) {
        verdict = "needs-input";
        detail = "stalled waiting for keyboard input";
      } else if (!golden[name]!.finished) {
        verdict = "unfinished-expected";
        detail = "corpus records this program as not terminating";
      } else if (r.output === want) {
        verdict = "pass";
      } else {
        verdict = "diff";
        detail = firstDiff(r.output, want);
      }
    } catch (e) {
      verdict = "assemble-error";
      detail = (e as Error).message;
      if (e instanceof AsmError && e.line !== undefined) errLine = e.line;
    }
    const sourceLine = errLine ? (src.split("\n")[errLine - 1] ?? "") : "";
    results.push({
      name,
      topic,
      verdict,
      detail,
      line: errLine,
      source: sourceLine,
      got,
      want,
      steps,
    });
  }

  printReport(results);

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`\nraw results -> ${outFile}`);
  }
}

function firstDiff(got: string, want: string): string {
  const g = got.split("\n");
  const w = want.split("\n");
  for (let i = 0; i < Math.max(g.length, w.length); i++) {
    if (g[i] !== w[i]) {
      return `line ${i + 1}: got ${JSON.stringify(g[i])} want ${JSON.stringify(w[i])}`;
    }
  }
  return "identical lines, different text";
}

function printReport(results: Result[]): void {
  const byTopic = new Map<string, Result[]>();
  for (const r of results) {
    const list = byTopic.get(r.topic) ?? [];
    list.push(r);
    byTopic.set(r.topic, list);
  }

  const counts = new Map<Verdict, number>();
  for (const r of results) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);

  const total = results.length;
  const pass = counts.get("pass") ?? 0;
  console.log(`\nprograms: ${total}`);
  console.log(`exact output match: ${pass} (${((pass / total) * 100).toFixed(1)}%)`);
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  console.log("\nper topic (pass/total)");
  for (const topic of [...byTopic.keys()].sort()) {
    const list = byTopic.get(topic)!;
    const p = list.filter((r) => r.verdict === "pass").length;
    console.log(`  ${topic.padEnd(24)} ${p}/${list.length}`);
  }

  console.log("\nassemble errors (grouped by feature)");
  const asmErrors = results.filter((r) => r.verdict === "assemble-error");
  const groups = new Map<string, number>();
  for (const r of asmErrors) {
    const key = classify(r.detail, r.source);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log("\nassemble errors (raw message)");
  const raw = new Map<string, number>();
  for (const r of asmErrors) {
    const key = r.detail.replace(/`.*`/, "`<expr>`").replace(/\(line \d+\)/, "");
    raw.set(key, (raw.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...raw].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  console.log("\nruntime errors (grouped by feature)");
  const rtErrors = results.filter((r) => r.verdict === "runtime-error");
  const rgroups = new Map<string, number>();
  for (const r of rtErrors) {
    const key = classify(r.detail, r.source) + " :: " + r.detail.replace(/\(line \d+\)/, "").replace(/0x[0-9a-f]+/gi, "<addr>").slice(0, 60);
    rgroups.set(key, (rgroups.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...rgroups].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  console.log("\noutput differences, grouped by cause");
  const diffs = results.filter((r) => r.verdict === "diff");
  const kinds = new Map<string, Result[]>();
  for (const r of diffs) {
    const key = diffKind(r.want);
    const list = kinds.get(key) ?? [];
    list.push(r);
    kinds.set(key, list);
  }
  for (const [kind, list] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(4)}  ${kind}`);
    for (const r of list) {
      console.log(`          ${r.name}`);
      console.log(`            ${r.detail.slice(0, 100)}`);
    }
  }
}

main();
