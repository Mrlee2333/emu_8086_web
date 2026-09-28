/**
 * Font vendoring guard (v1.5.2).
 *
 * The point of vendoring is that the build must not touch the network for
 * typefaces. A `next/font/google` import puts that call back, and it fails
 * quietly in the worst possible place — after the tag and the release exist —
 * so the import is checked rather than trusted.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "lib"];
/** This file, which quotes the import in a fixture and would match itself. */
const SELF = fileURLToPath(import.meta.url);

/**
 * An import of the Google Fonts loader, not a mention of it in prose.
 *
 * `import(...)` with a literal specifier is statically analysable by the
 * bundler, so a dynamic import would fetch at build time exactly like a static
 * one. It is matched here for that reason.
 */
const GOOGLE_FONT_IMPORT =
  /(?:from\s+|require\(\s*|import\(\s*)["']next\/font\/google["']/;

/** Every source file the bundler could pick a font import up from. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("fonts are vendored", () => {
  it("imports no Google Fonts anywhere in the source tree", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        if (file === SELF) continue;
        if (GOOGLE_FONT_IMPORT.test(readFileSync(file, "utf8"))) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "next/font/google fetches at build time and can fail a release: " +
        offenders.join(", "),
    );
  });

  it("would catch a reintroduced import, or this test proves nothing", () => {
    // A guard that cannot fail is decoration. The rule is matched against
    // exactly the line shapes the old import had, plus a dynamic import, which
    // a bundler resolves statically and so would fetch just the same.
    const staticForms = [
      'import { IBM_Plex_Sans } from "next/font/google";',
      "import X from 'next/font/google';",
      'const f = require("next/font/google");',
      'const { VT323 } = await import("next/font/google");',
      "await import('next/font/google')",
    ];
    for (const form of staticForms) {
      assert.ok(GOOGLE_FONT_IMPORT.test(form), `missed: ${form}`);
    }
    // Prose is not an import, and neither is a different package.
    const notImports = [
      "// we used to use next/font/google for this",
      "import { WOFF2 } from 'next/font/local'",
      'const x = "next/font/google"',
    ];
    for (const form of notImports) {
      assert.ok(!GOOGLE_FONT_IMPORT.test(form), `false positive: ${form}`);
    }
  });

  it("declares the same three families and the same CSS variables", () => {
    const src = readFileSync(path.join(ROOT, "lib", "fonts.ts"), "utf8");
    for (const family of [
      "IBMPlexSans-Variable",
      "IBMPlexMono-Regular",
      "VT323-Regular",
    ]) {
      assert.ok(src.includes(family), `${family} is not referenced`);
    }
    for (const variable of [
      "--font-plex-sans",
      "--font-plex-mono",
      "--font-vt323",
    ]) {
      assert.ok(src.includes(variable), `${variable} is not bound`);
    }
  });

  it("has every woff2 the declarations point at, and none that is empty", () => {
    const src = readFileSync(path.join(ROOT, "lib", "fonts.ts"), "utf8");
    const referenced = [...src.matchAll(/app\/fonts\/([\w.-]+\.woff2)/g)].map(
      (m) => m[1]!,
    );
    assert.ok(referenced.length > 0, "no font files are referenced at all");

    const dir = path.join(ROOT, "app", "fonts");
    for (const name of referenced) {
      const full = path.join(dir, name);
      assert.ok(statSync(full).size > 1000, `${name} is missing or truncated`);
      // woff2 magic: 'wOF2'. A truncated download still parses as a file.
      assert.equal(
        readFileSync(full).subarray(0, 4).toString("latin1"),
        "wOF2",
        `${name} is not a woff2`,
      );
    }
  });

  it("fails the build if a family is declared without its file on disk", () => {
    // A typo in a path is a build error from next/font/local, but only once
    // someone runs a build. Reading the directory is the cheap early signal.
    const dir = path.join(ROOT, "app", "fonts");
    const onDisk = readdirSync(dir).filter((f) => f.endsWith(".woff2"));
    const src = readFileSync(path.join(ROOT, "lib", "fonts.ts"), "utf8");
    const referenced = new Set(
      [...src.matchAll(/app\/fonts\/([\w.-]+\.woff2)/g)].map((m) => m[1]!),
    );
    for (const name of onDisk) {
      assert.ok(referenced.has(name), `${name} is vendored but never used`);
    }
  });
});
