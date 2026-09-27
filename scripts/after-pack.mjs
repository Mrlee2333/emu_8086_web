/**
 * Guarantee every packaged `.app` is a validly sealed code-signed bundle.
 *
 * Why this exists: with `CSC_IDENTITY_AUTO_DISCOVERY=false` (what CI uses,
 * see .github/workflows/release-desktop.yml) electron-builder skips signing
 * entirely. Electron's prebuilt Mach-O binaries still carry an ad-hoc
 * `linker-signed` signature, but no bundle-level `Contents/_CodeSignature`
 * is written, so the seal and the signature disagree and macOS refuses to
 * launch the app with:
 *
 *   "emu8086web.app" is damaged and can't be opened.
 *
 * Ad-hoc signing the whole bundle writes the missing CodeResources seal and
 * the app launches normally (still unsigned as to Developer ID, so Gatekeeper
 * quarantine still needs the documented `xattr -dr com.apple.quarantine`).
 *
 * A properly Developer-ID-signed bundle already verifies, so this hook is a
 * no-op once signing credentials are configured.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

/** Runs `codesign --verify --deep --strict`; true when the bundle is valid. */
function isValidlySigned(appPath) {
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * electron-builder `afterPack` hook.
 * @param {{ appOutDir: string, packager: { appInfo: { productFilename: string } }, electronPlatformName: string }} context
 */
export async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  if (isValidlySigned(appPath)) {
    console.log(`[after-pack] already signed, skipping: ${appPath}`);
    return;
  }

  // `--deep` re-signs the nested helpers and frameworks so the parent's
  // CodeResources seal matches their bytes. Sign innermost-first (deep) and
  // hard-strip any previous signature so nothing stale survives.
  console.log(`[after-pack] ad-hoc signing unsealed bundle: ${appPath}`);
  execFileSync(
    "codesign",
    [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--timestamp=none",
      appPath,
    ],
    { stdio: "inherit" },
  );

  if (!isValidlySigned(appPath)) {
    throw new Error(
      `afterPack: ${appPath} still fails codesign --verify after ad-hoc signing`,
    );
  }
  console.log(`[after-pack] sealed and verified: ${appPath}`);
}
