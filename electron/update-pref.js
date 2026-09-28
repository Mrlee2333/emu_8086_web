/**
 * Update policy for the desktop app (v1.5.2).
 *
 * Two defects are fixed here, both of which the user reported as "the install
 * window does nothing":
 *
 * 1. **The prompt could not be honoured.** On macOS an in-place update is
 *    applied by Squirrel's ShipIt helper, which refuses to install over a
 *    build signed with a different identity than the update. The published
 *    builds are ad-hoc signed (CI sets `CSC_IDENTITY_AUTO_DISCOVERY: false`
 *    with no Developer ID), so ShipIt launched and then exited without doing
 *    anything. The button said "Restart now" and led nowhere. `installBlocked`
 *    detects that case up front so the app can offer a download instead of an
 *    install that cannot work.
 *
 * 2. **Nothing was remembered.** A check ran unconditionally 15 s after every
 *    launch, and `autoInstallOnAppQuit` defaults to true, so "Later" still
 *    installed on the next quit and the prompt came back every launch. Whether
 *    to check at all is now the user's setting, and the update is not applied
 *    behind their back.
 *
 * Pure, so the policy is unit-tested (`electron/update-pref.test.ts`).
 */

/** The default: check in the background, as every desktop app does. */
const DEFAULT_AUTO_UPDATE = true;

/**
 * Values that mean "yes", matched case-insensitively after trimming.
 *
 * Kept identical to `loadAutoUpdate` in `lib/ide/editor-prefs.ts`; the two
 * live in different processes and main stays dependency-free plain JS, so the
 * list is duplicated. `update-pref.test.ts` asserts the two agree, because a
 * disagreement here means the settings dialog says "off" while the updater is
 * still on.
 */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Read the auto-update preference out of the persisted settings blob.
 *
 * Absent means the user never chose, which is the default: check in the
 * background, as every desktop app does. Anything *present* that is not
 * recognised is false, because a user who has turned updates off must not get
 * them back from a typo.
 *
 * @param {Record<string, unknown> | null | undefined} settings
 * @returns {boolean}
 */
function autoUpdateEnabled(settings) {
  if (!settings || typeof settings !== "object") return DEFAULT_AUTO_UPDATE;
  const raw = settings.autoUpdate;
  if (raw === undefined || raw === null) return DEFAULT_AUTO_UPDATE;
  if (typeof raw === "boolean") return raw;
  return TRUTHY.has(String(raw).trim().toLowerCase());
}

/**
 * What `codesign -dv` output says about an app's signature.
 *
 * @typedef {{ adhoc: boolean, authority: string | null, teamId: string | null }} SignatureInfo
 */

/**
 * Parse `codesign -dv` output into the facts that matter here.
 *
 * An ad-hoc signature is reported as `Signature=adhoc` with no `Authority=`
 * line at all. That is the state the published builds are in, and it is the
 * state an in-place update cannot be applied from.
 *
 * `unknown` on the input, not `string`: this parses the output of a
 * subprocess that can fail, and a signature probe must not be the thing that
 * throws.
 *
 * @param {unknown} output
 * @returns {SignatureInfo}
 */
function parseSignature(output) {
  const text = typeof output === "string" ? output : "";
  const authority = text.match(/^Authority=(.*)$/m);
  const team = text.match(/^TeamIdentifier=(.*)$/m);
  const adhocLine = text.match(/^Signature=adhoc\s*$/m);
  return {
    adhoc: Boolean(adhocLine) || !authority,
    authority: authority ? authority[1].trim() : null,
    teamId: team ? team[1].trim() : null,
  };
}

/**
 * The `.app` bundle, from `process.resourcesPath`.
 *
 * `app.getPath("appPath")` does not exist — Electron's `getPath` throws
 * `Failed to get 'appPath' path` for that name, so the signature probe
 * silently never engaged and the whole feature was dead on packaged macOS.
 * `resourcesPath` is `<bundle>/Contents/Resources`, so the bundle is two levels
 * up. Pure, and tested against a real ad-hoc-signed `.app`, because getting
 * this wrong produces no error — only a feature that never turns on.
 *
 * @param {unknown} resourcesPath anything at all, including the non-strings a
 *   caller might hand it; nothing here may throw
 * @returns {string | null} null when the input is not a Resources path
 */
function bundlePathFrom(resourcesPath) {
  if (typeof resourcesPath !== "string" || resourcesPath === "") return null;
  // Normalise the separator and drop a trailing slash *before* splitting, so
  // ".../Contents/Resources/" does not yield a phantom empty final segment and
  // then walk up one directory too few.
  const posix = resourcesPath.replace(/\\/g, "/").replace(/\/+$/, "");
  // Must end in Contents/Resources, else the path is not what we think it is.
  if (!/\/Contents\/Resources$/.test(posix)) return null;
  return pathResolve(posix, "..", "..");
}

/**
 * `path.resolve` without requiring `node:path` at module scope, so this file
 * stays importable by a test that has no Electron runtime.
 *
 * @param {string} from
 * @param {...string} rest
 * @returns {string}
 */
function pathResolve(from, ...rest) {
  const parts = from.replace(/\\/g, "/").split("/");
  for (const part of rest) {
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const joined = parts.filter((p, i) => p !== "" || i === 0).join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

/**
 * True when an in-place install cannot be trusted to work, so the app should
 * offer a download rather than a restart.
 *
 * Only macOS is judged: on Windows and Linux the installer is a plain
 * executable and the signature question does not arise. An unknown signature
 * is not treated as blocked — refusing to update on a guess would be worse
 * than trying.
 *
 * The bar is a **Developer ID Application** signature, not merely "not ad-hoc".
 * A Development-signed build carries a real identity, but it is a different
 * identity from the published artifact and the one in /Applications, so Squirrel
 * would still refuse to replace it in place — the same failure, one step
 * further along. Only a Developer ID Application signature matches what the
 * release pipeline produces.
 *
 * @param {{ isMac: boolean, signature: ReturnType<typeof parseSignature> | null, isPackaged: boolean }} input
 * @returns {boolean}
 */
function installBlocked(input) {
  if (!input.isMac) return false;
  if (!input.isPackaged) return false;
  if (!input.signature) return false;
  const authority = input.signature.authority || "";
  return !/^Developer ID Application:/.test(authority);
}

/**
 * The buttons of the ready-to-install prompt.
 *
 * @param {boolean} blocked true when an in-place install cannot work
 * @returns {string[]}
 */
function updatePromptButtons(blocked) {
  return blocked ? ["Download the update", "Later"] : ["Restart now", "Later"];
}

/**
 * What the user chose in the ready-to-install prompt.
 *
 * Resolved by **label, not by button index**. This was `response === 2` against
 * a two-button array whose indices are 0 and 1, so the download button was
 * dead — the same class of defect as the one it was written to fix. Matching on
 * the label cannot drift when a button is added, removed or reordered, which
 * is the only way this bug happens.
 *
 * @param {boolean} blocked
 * @param {number} response index the dialog returned
 * @returns {"download" | "install" | "none"}
 */
function updateActionFor(blocked, response) {
  const label = updatePromptButtons(blocked)[response];
  if (blocked) return label === "Download the update" ? "download" : "none";
  return label === "Restart now" ? "install" : "none";
}

/**
 * Whether a background update check should run at all.
 *
 * @param {boolean} enabled user preference
 * @param {boolean} isPackaged false in dev, where there is nothing to install over
 * @returns {boolean}
 */
function shouldCheckInBackground(enabled, isPackaged) {
  return Boolean(enabled) && Boolean(isPackaged);
}

module.exports = {
  DEFAULT_AUTO_UPDATE,
  autoUpdateEnabled,
  parseSignature,
  installBlocked,
  bundlePathFrom,
  updatePromptButtons,
  updateActionFor,
  shouldCheckInBackground,
};
