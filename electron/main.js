/**
 * Electron main process (v1.3.0 offline desktop shell + v1.4.0 folder workspace).
 *
 * Packaged mode: forks the Next standalone server bundled at
 * `.next/standalone/server.js` on a free loopback port, waits for
 * `/api/health`, then shows the window. Works fully offline — the only
 * network use is loopback to itself.
 *
 * Dev mode (`ELECTRON_START_URL` set by `electron:dev`): loads the running
 * `next dev` server instead of spawning one.
 *
 * Folder workspace: scoped IPC (`emu8086web:*`) lets the renderer open one
 * user-picked directory and read/write `.asm`/`.txt`/`.inc` files inside it.
 * Every relPath is validated and confined to the picked root.
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { buildAppMenu, showUpdateError } = require("./menu");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { isStablePort, portCandidates } = require("./port-candidates");
const {
  autoUpdateEnabled,
  bundlePathFrom,
  CODESIGN_ARGS,
  installBlocked,
  parseSignature,
  shouldCheckInBackground,
  updateActionFor,
  updatePromptButtons,
} = require("./update-pref");

const APP_NAME = "emu8086web";
const REPO_URL = "https://github.com/nafiskabbo/emu_8086_web";
const RELEASES_URL = `${REPO_URL}/releases/latest`;

const DEV_URL = process.env.ELECTRON_START_URL || "";
const HEALTH_PATH = "/api/health";
const START_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 250;
const UPDATE_CHECK_DELAY_MS = 15000;
// Only the "Later" index is named, and it is the default *and* the cancel
// button. The other two positions are resolved by label in `updateActionFor`,
// because an index constant that did not match the button array once made the
// download fallback unreachable.
const UPDATE_BTN_LATER = 1;

let serverChild = null;
let mainWindow = null;
let updaterStarted = false;
/** Persisted renderer preferences; the source of truth for auto-update. */
let settings = {};
/**
 * The signature probe, as a promise.
 *
 * Held as a promise rather than only its result because the probe is fired
 * without being awaited, and the update handler can run before codesign has
 * answered. Treating "not known yet" as "not blocked" would offer the dead
 * Restart button in exactly the first seconds it must not.
 */
let appSignatureProbe = Promise.resolve(null);
/** True while a user-initiated check is in flight, so errors are shown. */
let manualCheckPending = false;
/** Handle for the deferred background check, so quitting can cancel it. */
let backgroundCheckTimer = null;
/** Set on quit: a background check firing on a dying process is pure waste. */
let quitting = false;

function isPackaged() {
  return app.isPackaged;
}

/**
 * Absolute path of the bundled Next standalone server.
 *
 * `.next/standalone` is unpacked from the asar (see `asarUnpack` in
 * package.json) so this is a real on-disk path: the server is launched with
 * `spawn(process.execPath, [serverFile])`, and a child process cannot read a
 * script out of an archive. Mirrors lib/electron/offline.ts
 * resolveStandaloneServerPath (duplicated here because main stays
 * dependency-free plain JS).
 */
function standaloneServerPath() {
  return path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    ".next",
    "standalone",
    "server.js",
  );
}

/**
 * Resolve a loopback port, preferring one the app has used before.
 *
 * The port is part of the renderer's origin, and localStorage is keyed by
 * origin, so an ephemeral port means every launch starts with empty settings
 * — the theme, the accent and the open files all silently revert. The pinned
 * candidates come first and the ephemeral port is the last resort; see
 * `port-candidates.js` for why, and for the tests.
 */
function pickPort() {
  const candidates = portCandidates(process.env.PORT);
  return new Promise((resolve, reject) => {
    const tryNext = () => {
      const want = candidates.shift();
      if (want === undefined) {
        reject(new Error("No free port available"));
        return;
      }
      const probe = net.createServer();
      // Swallow any late errors (e.g. from close() after a failed listen).
      probe.once("error", () => {
        try {
          probe.close();
        } catch {
          /* already closed */
        }
        tryNext();
      });
      probe.listen(want === 0 ? 0 : want, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(port));
      });
    };
    tryNext();
  });
}

/** Start the bundled Next server; resolves with its base URL. */
function startBundledServer() {
  const serverFile = standaloneServerPath();
  const fs = require("node:fs");
  if (!fs.existsSync(serverFile)) {
    throw new Error(
      `Bundled server not found at ${serverFile}. Run "bun run electron:build" first.`,
    );
  }
  return pickPort().then((port) => {
    // All four pinned ports busy means the OS handed out an ephemeral one,
    // and an ephemeral port is a new origin — which is the bug this whole
    // change exists to fix, reappearing with no signal. The scalar settings
    // still survive via the mirror, but the open files and tabs do not, so
    // it is worth saying out loud rather than failing silently.
    if (!isStablePort(port)) {
      console.warn(
        `[${APP_NAME}] all pinned ports are busy; fell back to ephemeral ` +
          `port ${port}. Storage is keyed by origin, so open files and tabs ` +
          `will not persist across restarts until a pinned port is free.`,
      );
    }
    return new Promise((resolve, reject) => {
      // ELECTRON_RUN_AS_NODE is load-bearing: a packaged Electron
      // binary ignores a script argument as an entry point and would
      // otherwise boot a SECOND COPY OF THIS APP (its own main.js),
      // which spawns another copy, recursively, until the machine
      // falls over. Node mode runs server.js as a plain script.
      // Mirrors lib/electron/offline.ts buildServerChildEnv.
      const env = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === "string") env[k] = v;
      }
      env.PORT = String(port);
      env.HOSTNAME = "127.0.0.1";
      env.ELECTRON_RUN_AS_NODE = "1";
      const child = spawn(process.execPath, [serverFile], {
        env,
        stdio: "ignore",
      });
      serverChild = child;
      child.once("error", (err) => reject(err));
      child.once("exit", (code) => {
        if (!mainWindow) {
          reject(new Error(`Bundled server exited early (code ${code})`));
        }
      });
      waitForHealth(port).then(
        () => resolve(`http://127.0.0.1:${port}`),
        (err) => reject(err),
      );
    });
  });
}

/** Poll /api/health until the server answers or the timeout elapses. */
function waitForHealth(port) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: HEALTH_PATH, timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else if (Date.now() > deadline) {
            reject(new Error("Bundled server did not become healthy in time"));
          } else {
            setTimeout(poll, POLL_INTERVAL_MS);
          }
        },
      );
      req.once("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("Bundled server did not become healthy in time"));
        } else {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      });
      req.once("timeout", () => {
        req.destroy();
        // A timed-out probe emits no response/error — keep polling.
        if (Date.now() > deadline) {
          reject(new Error("Bundled server did not become healthy in time"));
        } else {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      });
    };
    poll();
  });
}

function focusedWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

/** electron-updater is only meaningful in the packaged app. */
function getUpdater() {
  if (!app.isPackaged) return null;
  try {
    return require("electron-updater").autoUpdater;
  } catch {
    return null;
  }
}

/**
 * The app bundle's code signature, read once off the critical path.
 *
 * Only macOS has a question here, and only a packaged build has a signature
 * worth asking about. A failure is not fatal: the app falls back to trying the
 * install, which is the old behaviour and no worse.
 */
function probeAppSignature() {
  return new Promise((resolve) => {
    if (process.platform !== "darwin" || !isPackaged()) {
      resolve(null);
      return;
    }
    // `app.getPath("appPath")` is not a thing — it throws
    // "Failed to get 'appPath' path", which meant this probe always failed and
    // the signature feature never engaged. `bundlePathFrom` derives the bundle
    // from resourcesPath instead, and is unit-tested against a real .app.
    const bundle = bundlePathFrom(process.resourcesPath);
    if (!bundle) {
      resolve(null);
      return;
    }
    execFile(
      "/usr/bin/codesign",
      // The verbosity lives in the tested module, not here. It is load-bearing
      // and was wrong once: -dv is verbosity 0 and prints no Authority= line,
      // so every build looked ad-hoc and the whole feature was inverted.
      [...CODESIGN_ARGS, bundle],
      { timeout: 5000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve(null);
          return;
        }
        // `codesign -dv` writes its report to stderr, not stdout.
        const output = `${stdout || ""}\n${stderr || ""}`;
        resolve(parseSignature(output));
      },
    );
  });
}

/**
 * Background update check shortly after launch, plus a ready-to-install
 * prompt.
 *
 * Two things were wrong before v1.5.2 and both are fixed here:
 *
 * - The prompt said "Restart now" and led nowhere. On macOS the in-place
 *   install is applied by Squirrel's ShipIt, which refuses to install over a
 *   build signed differently from the update. The published builds are
 *   ad-hoc, so ShipIt launched and exited without installing. When the
 *   signature says that, the prompt offers the download instead of an install
 *   that cannot work.
 * - Nothing was remembered, and `autoInstallOnAppQuit` defaults to true, so
 *   "Later" installed anyway on the next quit and the prompt returned every
 *   launch. It is off now, and whether to check at all is the user's setting.
 */
function setupAutoUpdater() {
  const updater = getUpdater();
  if (!updater || updaterStarted) return;
  updaterStarted = true;
  updater.autoDownload = true;
  // "Later" has to mean later. With this on, the update is applied on the next
  // normal quit whether or not the user ever chose to install it.
  updater.autoInstallOnAppQuit = false;

  updater.on("update-downloaded", (info) => {
    const version = info && info.version ? String(info.version) : "new";
    // Wait for the signature before choosing the buttons. A null signature
    // means "not blocked", so deciding early would put a Restart button in
    // front of a user whose build cannot perform one.
    appSignatureProbe.then((signature) => {
      const blocked = installBlocked({
        isMac: process.platform === "darwin",
        isPackaged: isPackaged(),
        signature,
      });
      dialog
        .showMessageBox(focusedWindow(), {
          type: "info",
          buttons: updatePromptButtons(blocked),
          defaultId: UPDATE_BTN_LATER,
          cancelId: UPDATE_BTN_LATER,
          title: "Update ready",
          message: blocked
            ? `${APP_NAME} v${version} is ready, but this build is not signed with a Developer ID, so it cannot replace itself in place.`
            : `${APP_NAME} v${version} downloaded. Restart to install?`,
          detail: blocked
            ? "Download the release and replace the app in /Applications."
            : undefined,
        })
        .then(({ response }) => {
          // By label, not by index: an index constant that did not match the
          // button array made the download fallback a dead button, which is the
          // very defect this prompt was written to fix.
          const action = updateActionFor(blocked, response);
          if (action === "download") {
            void shell.openExternal(RELEASES_URL);
          } else if (action === "install") {
            updater.quitAndInstall();
          }
        });
    });
  });
  updater.on("error", (err) => {
    // Previously an empty handler, which is why a failed install looked like a
    // dead button. Only surfaced when the user asked for the check.
    reportManualCheckError(err);
    console.error("[updater]", err);
  });
  // A plain check, not checkForUpdatesAndNotify: that variant's notification
  // says the update "will be automatically installed on exit", which is now a
  // lie — autoInstallOnAppQuit is off precisely so "Later" means later. The
  // update-downloaded handler below is the only thing that should tell the
  // user, and it says something true.
  backgroundCheckTimer = setTimeout(() => {
    if (quitting) return;
    if (!shouldCheckInBackground(autoUpdateEnabled(settings), isPackaged())) {
      return;
    }
    updater.checkForUpdates().catch(() => {});
  }, UPDATE_CHECK_DELAY_MS);
}

/**
 * Show a failed manual check exactly once.
 *
 * `checkForUpdates` both emits `error` and rejects its promise, so handling
 * both showed the user the same dialog twice. The flag is consumed by whichever
 * arrives first, so the second one is quiet.
 */
function reportManualCheckError(err) {
  if (!manualCheckPending) return;
  manualCheckPending = false;
  showUpdateError(
    focusedWindow(),
    `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
  );
}

/** Menu-driven check with explicit up-to-date / failure dialogs. */
function manualCheckForUpdates() {
  const updater = getUpdater();
  if (!updater) {
    showUpdateError(
      focusedWindow(),
      app.isPackaged
        ? "Auto-update is unavailable in this build."
        : "Auto-update only runs in the packaged app, not in dev mode.",
    );
    return;
  }
  // Let the shared error handler report this one instead of a duplicate path.
  manualCheckPending = true;
  void updater.checkForUpdates().then(
    ({ updateInfo }) => {
      manualCheckPending = false;
      const latest =
        updateInfo && updateInfo.version ? String(updateInfo.version) : "";
      const current = app.getVersion();
      if (latest && latest !== current) {
        dialog.showMessageBox(focusedWindow(), {
          type: "info",
          title: "Update available",
          message: `${APP_NAME} v${latest} is downloading in the background. You will be asked to restart when it is ready.`,
        });
      } else {
        dialog.showMessageBox(focusedWindow(), {
          type: "info",
          title: "No updates",
          message: `You are on the latest version (v${current}).`,
        });
      }
    },
    (err) => {
      reportManualCheckError(err);
    },
  );
}

function createWindow(url) {
  try {
    appOrigin = new URL(url).origin;
  } catch {
    appOrigin = "";
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "emu8086web",
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The preload bridge (read/write/delete inside the opened folder) is attached
  // to the top frame regardless of origin, so navigation must stay pinned to
  // the bundled loopback server. Anything else opens in the system browser.
  const isAppOrigin = (target) => {
    try {
      const parsed = new URL(target);
      return (
        parsed.protocol === "http:" &&
        (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
        parsed.port === new URL(url).port
      );
    } catch {
      return false;
    }
  };

  // External links open in the system browser, never in the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isAppOrigin(target)) {
      void shell.openExternal(target);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Without these, any top-level navigation hands the destination page a live
  // window.electronAPI with folder read/write against the user's directory.
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isAppOrigin(target)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, target) => {
    if (!isAppOrigin(target)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );

  void mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showFatal(message) {
  dialog.showErrorBox("emu8086web failed to start", message);
}

/* ---- v1.4.0 folder workspace (scoped, root-confined file access) ----
 *
 * Trust model (review fix): the renderer NEVER supplies the root. The main
 * process remembers the user-picked directory (`allowedRoot`, persisted in
 * the app's userData dir which the renderer cannot write), and every
 * relPath is validated + resolved inside it.
 */
const {
  MAX_FOLDER_ENTRIES,
  MAX_FOLDER_FILE_BYTES,
  hasNoDotSegments,
  isSafeRelPath,
  isListableFile,
  isSourceFileRel,
} = require("./folder-guards");
const {
  resolveForWrite: resolveForWriteIn,
  resolveInside: resolveInsideIn,
  resolveSourceFile: resolveSourceFileIn,
  resolveWritableDir: resolveWritableDirIn,
  resolveWritableFile: resolveWritableFileIn,
} = require("./folder-resolve");

/** Main-side allowed root (set by the native folder picker only). */
let allowedRoot = null;
let allowedName = "";
/** Origin (scheme://host:port) of the app window, used to vet IPC senders. */
let appOrigin = "";

function folderStatePath() {
  return path.join(app.getPath("userData"), "emu8086web-folder.json");
}

function persistAllowedRoot() {
  try {
    const fsSync = require("node:fs");
    fsSync.mkdirSync(app.getPath("userData"), { recursive: true });
    fsSync.writeFileSync(
      folderStatePath(),
      JSON.stringify({ root: allowedRoot, name: allowedName }),
      "utf8",
    );
  } catch {
    /* best-effort */
  }
}

function restoreAllowedRoot() {
  try {
    const fsSync = require("node:fs");
    const raw = fsSync.readFileSync(folderStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.root === "string" &&
      fsSync.statSync(parsed.root).isDirectory()
    ) {
      allowedRoot = parsed.root;
      allowedName = typeof parsed.name === "string" ? parsed.name : "";
    }
  } catch {
    /* none stored or folder gone */
  }
}

function clearAllowedRoot() {
  allowedRoot = null;
  allowedName = "";
  try {
    require("node:fs").rmSync(folderStatePath(), { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Preferences that have to survive an origin change.
 *
 * The port is pinned now, so localStorage is stable in the normal case, but
 * it is not guaranteed: if every pinned port is taken the app falls back to an
 * ephemeral one and the origin changes again. These are mirrored to `userData`
 * for that case, and because the main process cannot read localStorage at all
 * — the auto-update preference has to come from somewhere it can reach.
 *
 * Deliberately not the whole of localStorage: open files, open tabs and the
 * watch list are large, and they are fixed by the pinned port rather than
 * duplicated here.
 */
const SETTINGS_KEYS = [
  "emu8086web:theme",
  "emu8086web:accent",
  "emu8086web:tabSize",
  "emu8086web:wordWrap",
  "emu8086web:fontScale",
  "autoUpdate",
];

function settingsStatePath() {
  return path.join(app.getPath("userData"), "emu8086web-settings.json");
}

/**
 * Write the settings file atomically.
 *
 * A plain `writeFileSync` is not atomic: a power cut or a kill mid-write leaves
 * truncated JSON, and the next launch fails to parse it, silently reverting
 * every setting — including the one documented as failing closed, where a user
 * who turned updates off would silently get them back. Writing a sibling
 * temporary file and renaming it over the target means the reader sees either
 * the old file or the new one, never half of either.
 */
function persistSettings() {
  try {
    const fsSync = require("node:fs");
    const target = settingsStatePath();
    const tmp = `${target}.tmp`;
    fsSync.mkdirSync(app.getPath("userData"), { recursive: true });
    fsSync.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
    fsSync.renameSync(tmp, target);
  } catch {
    /* best-effort: a preference is not worth failing the app over */
  }
}

function restoreSettings() {
  try {
    const parsed = JSON.parse(
      require("node:fs").readFileSync(settingsStatePath(), "utf8"),
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      settings = {};
      for (const key of SETTINGS_KEYS) {
        const value = parsed[key];
        if (value === undefined) continue;
        settings[key] = typeof value === "string" ? value : String(value);
      }
    }
  } catch {
    /* none stored */
  }
}

/** Merge a renderer patch into the stored settings and write them back. */
function mergeSettings(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  for (const key of SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];
    if (value === null || value === undefined) {
      delete settings[key];
    } else {
      settings[key] = typeof value === "string" ? value : String(value);
    }
  }
  persistSettings();
}

/**
 * Thin wrappers binding the allowed root. The confinement logic itself lives
 * in `electron/folder-resolve.js` so it can be unit-tested — see
 * `electron/folder-resolve.test.ts`.
 */
const resolveInside = (rel) => resolveInsideIn(allowedRoot, rel);
const resolveForWrite = (rel) => resolveForWriteIn(allowedRoot, rel);
const resolveSourceFile = (rel) => resolveSourceFileIn(allowedRoot, rel);
const resolveWritableFile = (rel) => resolveWritableFileIn(allowedRoot, rel);
const resolveWritableDir = (rel) => resolveWritableDirIn(allowedRoot, rel);

async function listFolderRecursive(root) {
  const absRoot = path.resolve(root);
  const out = [];
  const stack = [""];
  while (stack.length > 0 && out.length < MAX_FOLDER_ENTRIES) {
    const relDir = stack.pop();
    const absDir = relDir ? path.join(absRoot, relDir) : absRoot;
    let entries = [];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      // Never follow symlinks out of the workspace.
      if (e.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ relPath: rel, isDirectory: true });
        stack.push(rel);
      } else if (e.isFile() && isListableFile(e.name)) {
        out.push({ relPath: rel, isDirectory: false });
      }
      if (out.length >= MAX_FOLDER_ENTRIES) break;
    }
  }
  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
  return out;
}

let folderIpcRegistered = false;

/**
 * The folder bridge is privileged (read/write/delete under the opened root),
 * so only the app's own window may drive it. `will-navigate` already pins the
 * top frame, but a second window on the same loopback server shares the
 * preload, so vet the sender explicitly.
 */
function handleTrusted(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!appOrigin) throw new Error("Folder bridge unavailable");
    const frameUrl = event.senderFrame?.url ?? "";
    let origin = "";
    try {
      origin = new URL(frameUrl).origin;
    } catch {
      /* fall through to the rejection below */
    }
    if (origin !== appOrigin) throw new Error("Untrusted sender");
    return listener(event, ...args);
  });
}

function registerFolderIpc() {
  if (folderIpcRegistered) return;
  folderIpcRegistered = true;

  // Preference mirror. Read once at startup by the renderer so a lost
  // localStorage can be repopulated, and written on every change so the main
  // process can read the auto-update preference — which it cannot do from
  // localStorage, being a different process with no access to it.
  handleTrusted("emu8086web:get-settings", async () => ({ ...settings }));
  handleTrusted("emu8086web:set-settings", async (_e, patch) => {
    mergeSettings(patch);
    return { ...settings };
  });

  handleTrusted("emu8086web:open-folder", async () => {
    const res = await dialog.showOpenDialog(focusedWindow() ?? undefined, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    allowedRoot = res.filePaths[0];
    allowedName = path.basename(allowedRoot) || allowedRoot;
    persistAllowedRoot();
    return { root: allowedRoot, name: allowedName };
  });

  handleTrusted("emu8086web:get-folder", async () => {
    if (!allowedRoot) return null;
    return { root: allowedRoot, name: allowedName };
  });

  handleTrusted("emu8086web:close-folder", async () => {
    clearAllowedRoot();
  });

  handleTrusted("emu8086web:list-folder", async () => {
    if (!allowedRoot) throw new Error("No folder open");
    return listFolderRecursive(allowedRoot);
  });

  handleTrusted("emu8086web:read-folder-file", async (_e, rel) => {
    const abs = await resolveSourceFile(rel);
    const st = await fs.stat(abs);
    if (!st.isFile()) throw new Error("Not a file");
    if (st.size > MAX_FOLDER_FILE_BYTES)
      throw new Error("File too large (256 KiB cap)");
    return fs.readFile(abs, "utf8");
  });

  handleTrusted("emu8086web:write-folder-file", async (_e, rel, content) => {
    if (typeof content !== "string") throw new Error("Invalid content");
    if (Buffer.byteLength(content, "utf8") > MAX_FOLDER_FILE_BYTES) {
      throw new Error("File too large (256 KiB cap)");
    }
    const abs = await resolveWritableFile(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  });

  handleTrusted(
    "emu8086web:create-folder-entry",
    async (_e, rel, isDirectory) => {
      if (isDirectory !== true && isDirectory !== false) {
        throw new Error("Invalid isDirectory");
      }
      if (isDirectory) {
        const abs = await resolveWritableDir(rel);
        await fs.mkdir(abs, { recursive: true });
      } else {
        const abs = await resolveWritableFile(rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        try {
          const handle = await fs.open(abs, "wx");
          await handle.close();
        } catch (err) {
          if (err && err.code === "EEXIST") throw new Error("Already exists");
          throw err;
        }
      }
    },
  );

  handleTrusted(
    "emu8086web:rename-folder-entry",
    async (_e, oldRel, newRel) => {
      if (!isSafeRelPath(oldRel) || !isSafeRelPath(newRel)) {
        throw new Error("Invalid path");
      }
      if (!hasNoDotSegments(oldRel) || !hasNoDotSegments(newRel)) {
        throw new Error("Invalid path");
      }
      const newLeaf = newRel.split(/[\\/]/).pop() || "";
      if (newLeaf.includes(".") && !isListableFile(newLeaf)) {
        throw new Error("Only .asm/.txt/.inc files");
      }
      const from = await resolveInside(oldRel);
      const to = await resolveForWrite(newRel);
      try {
        await fs.access(to);
        throw new Error("Already exists");
      } catch (err) {
        if (err && err.message === "Already exists") throw err;
        // ENOENT → target free, proceed.
      }
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    },
  );

  handleTrusted("emu8086web:delete-folder-entry", async (_e, rel) => {
    if (!hasNoDotSegments(rel)) throw new Error("Invalid path");
    const abs = await resolveInside(rel);
    const st = await fs.lstat(abs);
    // Directories stay deletable; files must be mutable source files.
    if (!st.isDirectory() && !isSourceFileRel(rel)) {
      throw new Error("Only .asm/.txt/.inc files");
    }
    await fs.rm(abs, { recursive: true, force: true });
  });
}

// One instance only: a second launch (double-click storm, both the
// /Applications and dist copies opened together) focuses the running
// window instead of booting another app + bundled server.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  const win = focusedWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  app.setName(APP_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: "© Nafis Islam Kabbo (MIT)",
    website: REPO_URL,
  });

  const { Menu } = require("electron");
  Menu.setApplicationMenu(
    buildAppMenu({
      appName: APP_NAME,
      isDev: DEV_URL !== "",
      onCheckForUpdates: () => manualCheckForUpdates(),
    }),
  );
  restoreAllowedRoot();
  // Before the updater, which reads the auto-update preference out of it.
  restoreSettings();
  registerFolderIpc();
  // Off the critical path: the window should not wait on a codesign call.
  appSignatureProbe = probeAppSignature();
  setupAutoUpdater();

  const start = DEV_URL
    ? Promise.resolve(DEV_URL)
    : isPackaged()
      ? startBundledServer()
      : Promise.resolve("http://127.0.0.1:3000");
  start.then(
    (url) => createWindow(url),
    (err) => {
      showFatal(err instanceof Error ? err.message : String(err));
      app.quit();
    },
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const fallback = DEV_URL || "http://127.0.0.1:3000";
      createWindow(fallback);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // Cancel the deferred background check. Left alone it fires 15 s after
  // launch regardless, and a user who quits at t=10 s would still get a network
  // check and possibly a full download on a process that is on its way out.
  quitting = true;
  if (backgroundCheckTimer) {
    clearTimeout(backgroundCheckTimer);
    backgroundCheckTimer = null;
  }
  if (serverChild) {
    try {
      serverChild.kill();
    } catch {
      /* already gone */
    }
    serverChild = null;
  }
});
