/**
 * Verify every packaged macOS `.app` in `dist/`.
 *
 * Checks the two things that silently shipped broken in v1.4.0:
 *
 *  1. The bundle carries a valid code signature seal
 *     (`Contents/_CodeSignature/CodeResources`). Missing seal + an Electron
 *     binary that expects sealed resources = "emu8086web.app is damaged and
 *     can't be opened".
 *  2. The bundled Next server exists as a real file outside the asar, at
 *     `app.asar.unpacked/.next/standalone/server.js`. The main process
 *     `spawn`s it, and a child process cannot read inside an archive.
 *
 * Used by CI (`release-desktop.yml`) and by `bun run electron:dist:mac:ci-sim`
 * so the local reproduction and the release gate cannot drift apart.
 *
 * Usage: node scripts/verify-mac-bundle.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");

/** `dist/mac-arm64/emu8086web.app` + `dist/mac/emu8086web.app` → both. */
function findBundles() {
  if (!existsSync(distDir)) return [];
  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
    .map((entry) => path.join(distDir, entry.name, "emu8086web.app"))
    .filter((appPath) => existsSync(appPath));
}

const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`  FAIL ${label}\n       ${detail}`);
    failures.push(label);
  }
}

const bundles = findBundles();
if (bundles.length === 0) {
  console.error("No packaged .app bundles found in dist/.");
  console.error("Run `bun run electron:dist:mac` (or :ci-sim) first.");
  process.exit(1);
}

for (const appPath of bundles) {
  console.log(`\n${path.relative(root, appPath)}`);

  check("code signature seal is valid", () => {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
      stdio: "pipe",
    });
  });

  check("bundle-level CodeResources exists", () => {
    const seal = path.join(
      appPath,
      "Contents",
      "_CodeSignature",
      "CodeResources",
    );
    if (!existsSync(seal)) {
      throw new Error(
        `missing ${seal} — the bundle is unsealed, so macOS reports it as damaged`,
      );
    }
  });

  check("bundled Next server is present outside the asar", () => {
    const server = path.join(
      appPath,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      ".next",
      "standalone",
      "server.js",
    );
    if (!existsSync(server)) {
      throw new Error(
        `missing ${server} — the app cannot spawn a server from inside app.asar`,
      );
    }
  });

  // Informational only: un-notarized builds are always "rejected" here, which
  // is expected until Developer ID signing + notarization are configured.
  try {
    execFileSync("spctl", ["-a", "-t", "exec", appPath], { stdio: "pipe" });
    console.log("  note Gatekeeper: accepted (signed + notarized)");
  } catch {
    console.log(
      "  note Gatekeeper: not notarized (expected; users clear quarantine once)",
    );
  }
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} check(s) failed — do not ship this build.`,
  );
  process.exit(1);
}

console.log(`\nAll ${bundles.length} bundle(s) passed.`);
