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
import { describe, it } from "node:test";
import {
  autoUpdateEnabled,
  bundlePathFrom,
  installBlocked,
  parseSignature,
  shouldCheckInBackground,
  updateActionFor,
  updatePromptButtons,
} from "./update-pref.js";

/** What `codesign -dv` prints for the two states that matter. */
const ADHOC = `Executable=/Applications/emu8086web.app/Contents/MacOS/emu8086web
Identifier=com.nafiskabbo.emu8086web
Format=app bundle with Mach-O universal
CodeDirectory v=20500 size=512 flags=0x10000(runtime)
Signature=adhoc
Info.plist entries=12
`;

const DEVELOPER_ID = `Executable=/Applications/emu8086web.app/Contents/MacOS/emu8086web
Identifier=com.nafiskabbo.emu8086web
Authority=Developer ID Application: Nafis Islam Kabbo (3W4D22H624)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=3W4D22H624
Signature=821a
`;

const DEVELOPMENT = `Executable=/Applications/emu8086web.app/Contents/MacOS/emu8086web
Authority=Apple Development: NAFIS ISLAM KABBO (85U76F99Y3)
TeamIdentifier=3W4D22H624
Signature=821a
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
