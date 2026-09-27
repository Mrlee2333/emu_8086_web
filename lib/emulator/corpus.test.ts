/**
 * Conformance suite: real 8086 programs, run to completion, output compared
 * character for character.
 *
 * The programs in `lib/emulator/corpus/` come from
 * Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS (MIT, see corpus/README.md).
 * Each one is a worked example from a topic a student meets, it prints what it
 * computed, and it finishes on its own. `expected.json` holds the output each
 * program produced when the corpus was recorded, so this suite answers two
 * questions at once: which topics the emulator covers, and whether it still
 * computes the right answers.
 *
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { assemble } from "./assemble";
import { createMachine } from "./machine";

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "corpus");

/** Keystrokes offered to any program that reads, matching the corpus harness. */
const INPUT = "5\r3\rAMEY\r" + "A".repeat(40) + "\r";

/** A program that needs more than this has stopped making progress. */
const STEP_BUDGET = 2_000_000;

interface Outcome {
  output: string;
  steps: number;
  err: string | null;
  halted: boolean;
}

function runProgram(src: string): Outcome {
  const machine = createMachine(assemble(src));
  machine.enqueueInput(INPUT);
  let steps = 0;
  while (!machine.halted && !machine.err) {
    if (machine.waitingForInput) break;
    if (steps++ >= STEP_BUDGET) {
      return { output: machine.output, steps, err: null, halted: false };
    }
    machine.step();
  }
  return {
    output: machine.output,
    steps,
    err: machine.err,
    halted: machine.halted,
  };
}

const expected = JSON.parse(
  readFileSync(join(CORPUS_DIR, "expected.json"), "utf8"),
) as Record<string, string>;

const source = new Map<string, string>();
for (const key of Object.keys(expected)) {
  source.set(key, readFileSync(join(CORPUS_DIR, key), "utf8"));
}

const topics = readdirSync(CORPUS_DIR)
  .filter((entry) => statSync(join(CORPUS_DIR, entry)).isDirectory())
  .sort();

describe("corpus coverage", () => {
  it("covers every topic the corpus fixtures claim", () => {
    // Guards against a fixture folder being emptied or renamed by accident:
    // the suite would otherwise pass while testing nothing.
    assert.ok(topics.length >= 35, `only ${topics.length} topics in the corpus`);
    for (const topic of topics) {
      const count = Object.keys(expected).filter((k) =>
        k.startsWith(`${topic}/`),
      ).length;
      assert.ok(count > 0, `topic ${topic} has no programs`);
    }
  });

  it("has an expected output for every program on disk", () => {
    const onDisk: string[] = [];
    for (const topic of topics) {
      for (const entry of readdirSync(join(CORPUS_DIR, topic))) {
        if (entry.endsWith(".asm")) onDisk.push(`${topic}/${entry}`);
      }
    }
    const orphans = onDisk.filter((key) => expected[key] === undefined);
    assert.deepEqual(orphans, [], "programs with no recorded output");
    assert.deepEqual(
      Object.keys(expected).filter((k) => !source.has(k)),
      [],
      "recorded outputs with no program",
    );
  });
});

for (const topic of topics) {
  const programs = Object.keys(expected)
    .filter((key) => key.startsWith(`${topic}/`))
    .sort();

  describe(`corpus: ${topic}`, () => {
    for (const key of programs) {
      const name = key.slice(topic.length + 1).replace(/\.asm$/, "");

      it(name, () => {
        const result = runProgram(source.get(key)!);
        assert.equal(result.err, null, `${key} stopped: ${result.err}`);
        assert.ok(result.halted, `${key} did not finish`);
        assert.equal(result.output, expected[key]);
      });
    }
  });
}
