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
  installBlocked,
  parseSignature,
  shouldCheckInBackground,
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
  const mac = { isMac: true, isPackaged: true, appPath: "/Applications/x.app" };

  it("blocks an in-place install from an ad-hoc build", () => {
    // The reported bug: this build shipped ad-hoc, ShipIt refused, and the
    // button did nothing.
    assert.equal(
      installBlocked({ ...mac, signature: parseSignature(ADHOC) }),
      true,
    );
  });

  it("allows an in-place install from a Developer ID build", () => {
    assert.equal(
      installBlocked({ ...mac, signature: parseSignature(DEVELOPER_ID) }),
      false,
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
          appPath: "C:\\x.exe",
          signature: parseSignature(sig),
        }),
        false,
      );
    }
  });

  it("never blocks in dev, where there is nothing installed", () => {
    assert.equal(
      installBlocked({ ...mac, isPackaged: false, signature: parseSignature(ADHOC) }),
      false,
    );
  });

  it("does not block on an unknown signature", () => {
    // Refusing to update on a guess is worse than trying.
    assert.equal(installBlocked({ ...mac, signature: null }), false);
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
