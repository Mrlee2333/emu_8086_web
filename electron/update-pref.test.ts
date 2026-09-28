/**
 * Update-policy tests (v1.5.2).
 *
 * The behaviour being pinned here is the "install does nothing" report: the
 * app was offering an install that could not succeed, and not remembering that
 * the user had declined it. Both are silent failures, so both are asserted
 * directly rather than inferred from the updater.
 *
 * Run: bun test electron
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  autoUpdateEnabled,
  bundlePathFrom,
  CODESIGN_ARGS,
  installBlocked,
  parseSignature,
  shouldCheckInBackground,
  updateActionFor,
  updatePromptButtons,
} from "./update-pref.js";

/**
 * Fixture output, captured from `codesign -dvvv` on two real `.app` bundles on
 * this machine — not written from what the output "should" look like. That
 * distinction is the whole point: the previous fixtures were invented, and
 * because `codesign -dv` prints no `Authority=` line at all, an invented
 * fixture hid that the real command could never produce the thing being
 * matched. The ad-hoc fixture is Electron's own bundle; the other is a
 * Developer-signed build produced by electron-builder.
 *
 * @see the live round-trip test at the end of this file
 */
const ADHOC = `Executable=/path/to/Electron.app/Contents/MacOS/Electron
Identifier=Electron
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=392 flags=0x20002(adhoc,linker-signed) hashes=9+0 location=embedded
Hash type=sha256 size=32
CDHash=098949f2901f57e20ce76ea6a1b17234c0bfd1db
Signature=adhoc
TeamIdentifier=not set
`;

/** A real Developer-signed bundle at -dvvv: authority chain, no adhoc. */
const DEVELOPMENT = `Executable=/path/to/emu8086web.app/Contents/MacOS/emu8086web
Identifier=com.nafiskabbo.emu8086web
Format=app bundle with Mach-O universal (binary)
CodeDirectory v=20500 size=453 flags=0x10000(runtime) hashes=3+7 location=embedded
Signature size=9097
Timestamp=28 Sep, 2026 at 7:20:53 AM
Authority=Apple Development: NAFIS ISLAM KABBO (85U76F99Y3)
Authority=Apple Worldwide Developer Relations Certification Authority
Authority=Apple Root CA
TeamIdentifier=3W4D22H624
`;

/** Not obtainable on this machine (no Developer ID certificate), so this one
 *  is constructed — but from the documented format, and the live test below
 *  proves the parser reads a real authority chain of the same shape. */
const DEVELOPER_ID = `Executable=/path/to/emu8086web.app/Contents/MacOS/emu8086web
Identifier=com.nafiskabbo.emu8086web
Format=app bundle with Mach-O universal (binary)
CodeDirectory v=20500 size=453 flags=0x10000(runtime) hashes=3+7 location=embedded
Signature size=8128
Timestamp=28 Sep, 2026 at 7:20:53 AM
Authority=Developer ID Application: Nafis Islam Kabbo (3W4D22H624)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=3W4D22H624
`;

describe("parseSignature", () => {
  it("reads an ad-hoc signature as ad-hoc, with no authority", () => {
    const info = parseSignature(ADHOC);
    assert.equal(info.adhoc, true);
    assert.equal(info.authority, null);
  });

  it("reads a Developer ID signature as not ad-hoc", () => {
    const info = parseSignature(DEVELOPER_ID);
    assert.equal(info.adhoc, false);
    assert.equal(info.teamId, "3W4D22H624");
  });

  it("reads a development signature as not ad-hoc", () => {
    assert.equal(parseSignature(DEVELOPMENT).adhoc, false);
  });

  it("treats output with no Authority line as ad-hoc", () => {
    // This is the real signal: a signed app always prints Authority, so its
    // absence is the thing to key on rather than the `Signature=` line alone.
    assert.equal(parseSignature("Identifier=com.example.app\n").adhoc, true);
  });

  it("does not throw on empty or non-string input", () => {
    for (const input of ["", null, undefined, 42, {}]) {
      assert.equal(parseSignature(input).adhoc, true, `${input} must be safe`);
    }
  });
});

describe("installBlocked", () => {
  const mac = { isMac: true, isPackaged: true };

  it("blocks an in-place install from an ad-hoc build", () => {
    // The reported bug: this build shipped ad-hoc, ShipIt refused, and the
    // button did nothing.
    assert.equal(
      installBlocked({ ...mac, signature: parseSignature(ADHOC) }),
      true,
    );
  });

  it("blocks a Development-signed build too, not just ad-hoc", () => {
    // A Development certificate is a real identity, but it is not the identity
    // the release pipeline publishes, and not the one in /Applications either.
    // Squirrel would refuse it in exactly the same way, so allowing "Restart
    // now" here would reproduce the dead button one step further along.
    assert.equal(
      installBlocked({ ...mac, signature: parseSignature(DEVELOPMENT) }),
      true,
      "a Development signature cannot replace the published artifact in place",
    );
  });

  it("allows an in-place install from a Developer ID Application build", () => {
    assert.equal(
      installBlocked({ ...mac, signature: parseSignature(DEVELOPER_ID) }),
      false,
    );
  });

  it("does not treat a Developer ID *Certificate* as an Application signature", () => {
    // The distinction matters: only the Application identity signs the app
    // bundle. A second "Authority=Developer ID Certification Authority" line
    // is the CA chain, not the signer.
    const caOnly = `Authority=Developer ID Certification Authority
TeamIdentifier=not set
Signature=821a
`;
    assert.equal(
      installBlocked({ ...mac, signature: parseSignature(caOnly) }),
      true,
    );
  });

  it("never blocks off macOS", () => {
    // Windows and Linux installers are plain executables; the signature
    // question does not apply and blocking them would be wrong.
    for (const sig of [ADHOC, DEVELOPER_ID, DEVELOPMENT]) {
      assert.equal(
        installBlocked({
          isMac: false,
          isPackaged: true,
          signature: parseSignature(sig),
        }),
        false,
      );
    }
  });

  it("never blocks in dev, where there is nothing installed", () => {
    assert.equal(
      installBlocked({
        ...mac,
        isPackaged: false,
        signature: parseSignature(ADHOC),
      }),
      false,
    );
  });

  it("does not block on an unknown signature", () => {
    // Refusing to update on a guess is worse than trying.
    assert.equal(installBlocked({ ...mac, signature: null }), false);
  });
});

describe("bundlePathFrom", () => {
  it("finds the .app bundle from a real resourcesPath", () => {
    // Captured from an actual Electron launch, not invented.
    assert.equal(
      bundlePathFrom("/Applications/emu8086web.app/Contents/Resources"),
      "/Applications/emu8086web.app",
    );
  });

  it("copes with a trailing slash and with a spaced path", () => {
    assert.equal(
      bundlePathFrom("/Users/a/Library/Caches/App.app/Contents/Resources/"),
      "/Users/a/Library/Caches/App.app",
    );
    assert.equal(
      bundlePathFrom("/Users/na/My Apps/emu8086web.app/Contents/Resources"),
      "/Users/na/My Apps/emu8086web.app",
    );
  });

  it("returns null rather than a wrong path for anything else", () => {
    // The bug this replaced, `app.getPath("appPath")`, threw an exception
    // instead — and the probe swallowed it, so the feature was simply never on.
    for (const bad of [
      "",
      undefined,
      null,
      42,
      "/Applications/emu8086web.app",
      "/Applications/emu8086web.app/Contents",
      "/Applications/emu8086web.app/Contents/MacOS",
      "/tmp/Resources",
    ]) {
      assert.equal(
        bundlePathFrom(bad),
        null,
        `${String(bad)} must not be guessed at`,
      );
    }
  });

  it("never returns a path that still contains Contents/Resources", () => {
    // The exact shape that made the original probe useless.
    const out = bundlePathFrom("/x/y.app/Contents/Resources");
    assert.ok(out);
    assert.ok(!out.includes("Contents/Resources"), out);
    assert.ok(out.endsWith(".app"), out);
  });
});

describe("updateActionFor", () => {
  it("opens the download when the install is blocked", () => {
    const buttons = updatePromptButtons(true);
    for (let i = 0; i < buttons.length; i++) {
      assert.equal(
        updateActionFor(true, i),
        buttons[i] === "Later" ? "none" : "download",
        `response ${i} of the blocked dialog`,
      );
    }
  });

  it("installs on restart when the install is allowed", () => {
    const buttons = updatePromptButtons(false);
    for (let i = 0; i < buttons.length; i++) {
      assert.equal(
        updateActionFor(false, i),
        buttons[i] === "Later" ? "none" : "install",
        `response ${i} of the allowed dialog`,
      );
    }
  });

  it("would have caught the dead download button", () => {
    // The shipped bug: `response === 2` against a two-button array, so the one
    // index the dialog can never return was the only one handled. The test is
    // that the actionable button sits at an index the dialog actually returns,
    // and that no such index is past the end of the array.
    for (const blocked of [true, false]) {
      const buttons = updatePromptButtons(blocked);
      const action = blocked ? "Download the update" : "Restart now";
      const index = buttons.indexOf(action);
      assert.ok(index >= 0, `${action} is not a button at all`);
      assert.ok(
        index < buttons.length,
        `${action} is at an index the dialog can never return`,
      );
      assert.notEqual(updateActionFor(blocked, index), "none");
      // And the other button is a deliberate no-op, not a dead end.
      const other = buttons.findIndex((b) => b !== action);
      assert.equal(updateActionFor(blocked, other), "none", "Later defers");
    }
  });

  it("has no unreachable action, whatever the button order", () => {
    // Positions are not load-bearing, so this holds even if the array is
    // reordered or a button inserted.
    for (const blocked of [true, false]) {
      const buttons = updatePromptButtons(blocked);
      const reachable = new Set(
        buttons.map((_, i) => updateActionFor(blocked, i)),
      );
      const wanted = blocked ? "download" : "install";
      assert.ok(reachable.has(wanted), `${wanted} is unreachable`);
    }
  });

  it("does nothing for a response the dialog cannot return", () => {
    assert.equal(updateActionFor(true, 99), "none");
    assert.equal(updateActionFor(false, -1), "none");
  });

  it("cannot go wrong if a button is added or reordered", () => {
    // The whole point of matching on the label: positions are not load-bearing.
    const buttons = updatePromptButtons(true);
    const downloadIndex = buttons.indexOf("Download the update");
    assert.equal(updateActionFor(true, downloadIndex), "download");
  });
});

describe("autoUpdateEnabled", () => {
  it("defaults to on when nothing has been stored", () => {
    assert.equal(autoUpdateEnabled(null), true);
    assert.equal(autoUpdateEnabled(undefined), true);
    assert.equal(autoUpdateEnabled({}), true);
  });

  it("reads the stored value", () => {
    assert.equal(autoUpdateEnabled({ autoUpdate: "1" }), true);
    assert.equal(autoUpdateEnabled({ autoUpdate: "0" }), false);
    assert.equal(autoUpdateEnabled({ autoUpdate: true }), true);
    assert.equal(autoUpdateEnabled({ autoUpdate: false }), false);
  });

  it("fails closed on a value it does not understand", () => {
    // A user who turned updates off must not get them back from a typo.
    for (const raw of ["no", "off", "maybe", "2", "-1", "null"]) {
      assert.equal(autoUpdateEnabled({ autoUpdate: raw }), false, raw);
    }
  });

  it("treats an empty string as a stored 'off', not as never chosen", () => {
    // An empty value can only come from a write, not from an absent key, and
    // the renderer reads it the same way — see the agreement test in
    // lib/ide/editor-prefs.test.ts.
    assert.equal(autoUpdateEnabled({ autoUpdate: "" }), false);
  });
});

describe("shouldCheckInBackground", () => {
  it("checks when enabled and packaged", () => {
    assert.equal(shouldCheckInBackground(true, true), true);
  });

  it("does not check when the user turned it off", () => {
    assert.equal(shouldCheckInBackground(false, true), false);
  });

  it("does not check in dev", () => {
    assert.equal(shouldCheckInBackground(true, false), false);
  });
});

/**
 * The real `codesign`, read from real bundles.
 *
 * The first version of this file used invented fixtures, and because
 * `codesign -dv` prints no `Authority=` line at all, an invented fixture
 * cheerfully asserted a string the command can never emit — the whole
 * signature feature was inverted and every test was green. So the verbosity
 * this module's caller must use is now pinned by a test that shells out to
 * the real binary.
 *
 * Skipped where codesign or a bundle is unavailable, which is everything that
 * is not macOS; the rest of the suite is hermetic.
 */
describe("codesign, for real", () => {
  const ELECTRON_BUNDLE = "node_modules/electron/dist/Electron.app"; // ad-hoc signed by the installer
  /** A Developer-signed bundle from a local electron-builder run, if present. */
  const DEVELOPER_BUNDLE = "dist/mac-arm64/emu8086web.app";
  const isMac = process.platform === "darwin";
  const codesign = "/usr/bin/codesign";

  function read(verbosity: string, bundle: string): string {
    const r = spawnSync(codesign, [verbosity, bundle], {
      encoding: "utf8",
      timeout: 10_000,
    });
    // codesign reports on stderr, not stdout.
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  }

  it("prints no Authority line at -dv, which is why -dvvv is required", function () {
    if (!isMac || !existsSync(codesign) || !existsSync(ELECTRON_BUNDLE)) {
      return;
    }
    // This is the trap: -dv is verbosity 0 because the first -v is consumed as
    // --verify. Anything matching on Authority at that verbosity always fails.
    assert.equal(
      /^Authority=/m.test(read("-dv", ELECTRON_BUNDLE)),
      false,
      "-dv must not emit Authority, or the verbosity argument in main.js is wrong",
    );
    assert.equal(
      /^Authority=/m.test(read("-dvvv", ELECTRON_BUNDLE)),
      false,
      "an ad-hoc bundle has no authority chain even at -dvvv",
    );
  });

  it("reads a real ad-hoc bundle as ad-hoc and blocks the install", function () {
    if (!isMac || !existsSync(codesign) || !existsSync(ELECTRON_BUNDLE)) {
      return;
    }
    const out = read("-dvvv", ELECTRON_BUNDLE);
    const sig = parseSignature(out);
    assert.equal(sig.adhoc, true, "no authority chain and flags say adhoc");
    assert.equal(sig.authority, null);
    assert.equal(sig.teamId, null, '"not set" is not a team');
    assert.equal(
      installBlocked({ isMac: true, isPackaged: true, signature: sig }),
      true,
    );
  });

  it("reads a real Developer-signed bundle as not ad-hoc, and still blocks it", function () {
    if (!isMac || !existsSync(codesign) || !existsSync(DEVELOPER_BUNDLE)) {
      return;
    }
    const out = read("-dvvv", DEVELOPER_BUNDLE);
    const sig = parseSignature(out);
    // The regression this whole block exists for: at -dv this came back
    // authority=null, adhoc=true, and every build was blocked.
    assert.equal(sig.adhoc, false, "a signed bundle is not ad-hoc");
    assert.ok(sig.authority, "an authority line is now visible at -dvvv");
    assert.equal(sig.teamId, "3W4D22H624", "a real team id is parsed");
    // Signed, but not with Developer ID Application, so still blocked.
    assert.equal(
      installBlocked({ isMac: true, isPackaged: true, signature: sig }),
      true,
    );
    // And the rule reads the authority, not the absence of one.
    assert.match(sig.authority!, /^(Apple|Developer) /);
  });

  it("asks for a verbosity that actually prints the authority chain", function () {
    if (!isMac || !existsSync(codesign) || !existsSync(ELECTRON_BUNDLE)) {
      return;
    }
    // The check that would have caught the original bug. Everything else here
    // tests codesign's behaviour, which is identical whatever the caller asks
    // for — only this ties the constant to the output it is parsed from.
    assert.notDeepEqual(
      CODESIGN_ARGS,
      ["-dv"],
      "CODESIGN_ARGS must not be -dv: that is verbosity 0 and emits no Authority=",
    );
    const out = spawnSync(
      codesign,
      [...CODESIGN_ARGS, DEVELOPER_BUNDLE].filter((a, i) =>
        i === 0 ? true : existsSync(DEVELOPER_BUNDLE),
      ),
      { encoding: "utf8", timeout: 10_000 },
    );
    const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
    if (!existsSync(DEVELOPER_BUNDLE)) {
      assert.equal(text.length, 0, "no bundle to read");
      return;
    }
    assert.match(
      text,
      /^Authority=/m,
      "CODESIGN_ARGS must be a level that prints Authority=",
    );
    // And the round trip the app actually performs.
    const sig = parseSignature(text);
    assert.equal(sig.adhoc, false, "a signed bundle parses as not ad-hoc");
    assert.ok(sig.authority, "and yields an authority to match on");
  });
});
