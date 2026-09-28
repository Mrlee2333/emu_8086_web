/**
 * Port-selection tests (v1.5.2 — the desktop app losing its settings).
 *
 * The failure this guards is not a crash, it is a silent reset: an ephemeral
 * port gives a new origin, localStorage reads back empty, and the user sees
 * their theme revert with no error anywhere. So the assertion that matters is
 * the ordering — the ephemeral port must come last, always.
 *
 * Run: bun test electron
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isStablePort,
  PREFERRED_PORTS,
  portCandidates,
} from "./port-candidates.js";

describe("portCandidates", () => {
  it("puts the pinned ports ahead of the ephemeral one", () => {
    const candidates = portCandidates(undefined);
    const ephemeral = candidates.indexOf(0);
    assert.ok(ephemeral === candidates.length - 1, "0 must be the last resort");
    assert.equal(new Set(candidates).size, candidates.length, "no duplicates");
    for (const port of PREFERRED_PORTS) {
      assert.ok(
        candidates.indexOf(port) < ephemeral,
        `${port} must be tried before the ephemeral port`,
      );
    }
  });

  it("always offers at least one stable port before falling back", () => {
    const stable = portCandidates(undefined).filter(isStablePort);
    assert.ok(
      stable.length > 0,
      "nothing stable to try means settings are lost",
    );
  });

  it("honours an explicit PORT first, so dev and CI can pin it", () => {
    assert.equal(portCandidates("8123")[0], 8123);
  });

  it("ignores a PORT that is not a usable port number", () => {
    for (const bad of ["", "0", "80", "70000", "abc", "-1", "12.5.6"]) {
      const candidates = portCandidates(bad);
      assert.equal(
        candidates[candidates.length - 1],
        0,
        `"${bad}" must not be accepted as a pinned port`,
      );
    }
  });

  it("does not list a PINNED_PORT twice when PORT happens to name one", () => {
    const candidates = portCandidates(String(PREFERRED_PORTS[0]));
    assert.equal(
      candidates.filter((p) => p === PREFERRED_PORTS[0]).length,
      1,
      "a duplicate probe would waste a bind and can resolve the same port twice",
    );
  });

  it("does not sit on the Next dev port", () => {
    // electron:dev runs the dev server on 3000 and points the shell at it.
    assert.ok(
      !PREFERRED_PORTS.includes(3000),
      "pinning 3000 would collide with `bun run dev`",
    );
  });

  it("classifies a pinned port as stable and an ephemeral one as not", () => {
    assert.equal(isStablePort(PREFERRED_PORTS[0]), true);
    assert.equal(isStablePort(0), false);
    assert.equal(isStablePort(41234), false);
  });
});
