/**
 * Reproduce the CI artifact state on this machine, then verify it.
 *
 * CI builds with `CSC_IDENTITY_AUTO_DISCOVERY=false` (see
 * .github/workflows/release-desktop.yml), so no signing identity is used and
 * `scripts/after-pack.mjs` supplies the ad-hoc seal. A normal local build
 * instead finds whatever certificate is in your keychain, which produces a
 * *differently signed* app — and that divergence is exactly how the v1.4.0
 * "is damaged" defect stayed invisible to local testing.
 *
 * This script forces the no-identity path, so what you test locally is what
 * users download, then runs the same gate CI runs.
 *
 * Usage: bun run electron:dist:mac:ci-sim
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = ["--mac", "dmg", "--publish", "never"];

// Prefer the locally installed CLI: `node_modules/.bin` is not on PATH when
// this is spawned from Node, so falling back to a global runner would make
// the simulation depend on the machine rather than the lockfile.
const localCli = path.join(root, "node_modules", "electron-builder", "cli.js");
const useLocal = existsSync(localCli);

const build = spawnSync(
  process.execPath,
  useLocal ? [localCli, ...args] : args,
  {
    stdio: "inherit",
    cwd: root,
    shell: !useLocal,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  },
);

if (build.error) {
  console.error(
    `Failed to start electron-builder: ${build.error.message}\n` +
      "Run `bun install` first.",
  );
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status ?? 1);

const verify = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "verify-mac-bundle.mjs")],
  { stdio: "inherit", cwd: root },
);

console.log(
  "\nThis build has NO Developer ID signature. To install it locally, clear the\n" +
    "quarantine flag once, or the app will be blocked on launch:\n" +
    "  xattr -dr com.apple.quarantine /Applications/emu8086web.app",
);

process.exit(verify.status ?? 1);
