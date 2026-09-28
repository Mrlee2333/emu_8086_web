/**
 * Port selection for the bundled Next server (v1.5.2).
 *
 * Why this exists: the desktop window loads `http://127.0.0.1:<port>`, and
 * localStorage is keyed by origin — scheme, host AND port. The packaged app
 * used to bind an ephemeral port, so every launch produced a new origin and
 * every stored preference was orphaned: the theme, the accent, the tab size,
 * the UI scale, the open files, the open tabs, the watch list and the keyboard
 * shortcuts all read back empty. The one thing that *did* survive was the
 * opened folder, which the main process writes to `userData` itself — that
 * asymmetry is what gave the bug away.
 *
 * So the port is pinned to a small stable set, and the ephemeral port is only
 * a last resort. Pure, so the ordering is unit-tested (see
 * `electron/port-candidates.test.ts`).
 */

/**
 * Ports tried in order before falling back to an ephemeral one.
 *
 * High and in a narrow band so that a collision is unlikely and, when it
 * happens, the next candidate is still fixed rather than random. Deliberately
 * not 3000: that is the Next dev server this project uses, and the desktop app
 * in dev mode already talks to it.
 */
const PREFERRED_PORTS = [39271, 39272, 39273, 39274];

/**
 * Candidate ports in the order they should be tried.
 *
 * An explicit `PORT` still wins, so a developer or a CI job can pin the port
 * themselves. `0` (ask the OS for anything free) is always last, because
 * taking it is what loses the settings.
 *
 * @param {string | undefined} envPort value of `process.env.PORT`
 * @returns {number[]}
 */
function portCandidates(envPort) {
  const fromEnv = Number.parseInt(envPort || "", 10);
  const out = [];
  if (Number.isInteger(fromEnv) && fromEnv >= 1024 && fromEnv <= 65535) {
    out.push(fromEnv);
  }
  for (const port of PREFERRED_PORTS) {
    if (!out.includes(port)) out.push(port);
  }
  out.push(0);
  return out;
}

/**
 * True when `port` is one the app pinned, i.e. the origin will still be
 * there next launch. False for an ephemeral port, which is a fresh origin.
 *
 * @param {number} port
 * @returns {boolean}
 */
function isStablePort(port) {
  return PREFERRED_PORTS.includes(port);
}

module.exports = { PREFERRED_PORTS, portCandidates, isStablePort };
