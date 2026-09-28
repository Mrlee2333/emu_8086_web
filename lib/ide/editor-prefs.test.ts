/**
 * Preference tests (v1.5.2) — the auto-update setting and the desktop mirror.
 *
 * The bug under test is the desktop app forgetting everything on restart, so
 * the interesting cases are the ones where storage is empty, partial, or
 * hostile. `localStorage` is stubbed rather than mocked so the code under test
 * runs its real read/write path.
 *
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { autoUpdateEnabled } from "../../electron/update-pref.js";
import {
  ACCENT_KEY,
  AUTO_UPDATE_KEY,
  DEFAULT_AUTO_UPDATE,
  FONT_SCALE_KEY,
  isDesktop,
  loadAccent,
  loadAutoUpdate,
  loadTabSize,
  mirrorPrefs,
  restoreMirroredPrefs,
  TAB_SIZE_KEY,
  WORD_WRAP_KEY,
} from "./editor-prefs";

/** Minimal localStorage stand-in with an optional write failure. */
function stubStorage(opts: { failWrites?: boolean } = {}) {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (opts.failWrites) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem: (k: string) => void map.delete(k),
    get size() {
      return map.size;
    },
  };
  return map;
}

function stubBridge(impl?: {
  getSettings?: Record<string, string>;
  setSettings?: (patch: Record<string, string | null>) => void;
}) {
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      isElectron: () => true,
      getSettings: async () => impl?.getSettings ?? {},
      setSettings: async (patch: Record<string, string | null>) => {
        impl?.setSettings?.(patch);
        return {};
      },
    },
  };
}

/**
 * A browser-ish global: the loaders guard on `typeof window`, so a test that
 * reads a preference needs a window as well as storage.
 */
function stubBrowser(opts: { failWrites?: boolean } = {}): Map<string, string> {
  const store = stubStorage(opts);
  (globalThis as { window?: unknown }).window = {};
  return store;
}

function clearGlobals() {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
}

afterEach(clearGlobals);

describe("loadAutoUpdate", () => {
  it("is on by default, like every desktop app", () => {
    stubBrowser();
    assert.equal(DEFAULT_AUTO_UPDATE, true);
    assert.equal(loadAutoUpdate(), true);
  });

  it("reads a stored '1' as on", () => {
    const store = stubBrowser();
    store.set(AUTO_UPDATE_KEY, "1");
    assert.equal(loadAutoUpdate(), true);
  });

  it("reads a stored '0' as off", () => {
    const store = stubBrowser();
    store.set(AUTO_UPDATE_KEY, "0");
    assert.equal(loadAutoUpdate(), false);
  });

  it("fails closed on a value it does not understand", () => {
    // Someone who turned updates off must not get them back from a typo.
    for (const raw of ["", "yes", "on", "2", "true-ish", "off", "nope"]) {
      const store = stubBrowser();
      store.set(AUTO_UPDATE_KEY, raw);
      assert.equal(
        loadAutoUpdate(),
        raw.trim().toLowerCase() === "yes" ||
          raw.trim().toLowerCase() === "on" ||
          raw.trim().toLowerCase() === "true",
        `"${raw}" was read the wrong way`,
      );
    }
    for (const raw of ["0", "off", "nope", "2", ""]) {
      const store = stubBrowser();
      store.set(AUTO_UPDATE_KEY, raw);
      assert.equal(loadAutoUpdate(), false, `"${raw}" must not enable updates`);
    }
  });

  it("agrees with the main process on every value", () => {
    // The renderer and main each carry their own copy of this list, because
    // they are separate processes and main cannot import TypeScript. If they
    // drift, the settings dialog can say "off" while the updater is still on.
    for (const raw of [
      "1",
      "0",
      "",
      "true",
      "false",
      "yes",
      "no",
      "on",
      "off",
      " 1 ",
      "TRUE",
      "Off",
      "2",
      "null",
    ]) {
      const store = stubBrowser();
      store.set(AUTO_UPDATE_KEY, raw);
      assert.equal(
        loadAutoUpdate(),
        autoUpdateEnabled({ autoUpdate: raw }),
        `the two copies disagree on ${JSON.stringify(raw)}`,
      );
    }
  });
});

describe("mirrorPrefs", () => {
  it("is a no-op in the browser, where there is no main process", async () => {
    const store = stubStorage();
    store.set(AUTO_UPDATE_KEY, "0");
    stubBridge(undefined);
    // No electronAPI at all: the page must not throw on a normal web load.
    (globalThis as { window?: unknown }).window = {};
    await mirrorPrefs();
    assert.equal(store.get(AUTO_UPDATE_KEY), "0");
  });

  it("sends every mirrored key, including the ones that are unset", async () => {
    stubStorage();
    let seen: Record<string, string | null> | null = null;
    stubBridge({
      setSettings: (patch: Record<string, string | null>) => {
        seen = patch;
      },
    });
    await mirrorPrefs();
    assert.ok(seen, "the main process was never told");
    const sent = seen as unknown as Record<string, string | null>;
    for (const key of [
      "emu8086web:theme",
      ACCENT_KEY,
      TAB_SIZE_KEY,
      WORD_WRAP_KEY,
      FONT_SCALE_KEY,
      AUTO_UPDATE_KEY,
    ]) {
      assert.ok(key in sent, `${key} was not mirrored`);
    }
  });

  it("does not throw when localStorage refuses to write", async () => {
    stubStorage({ failWrites: true });
    stubBridge({ setSettings: () => {} });
    await assert.doesNotReject(mirrorPrefs());
  });

  it("does not throw when the bridge rejects", async () => {
    stubStorage();
    (globalThis as { window?: unknown }).window = {
      electronAPI: {
        isElectron: () => true,
        setSettings: async () => {
          throw new Error("Untrusted sender");
        },
      },
    };
    await assert.doesNotReject(mirrorPrefs());
  });
});

describe("restoreMirroredPrefs", () => {
  it("fills a key that localStorage lost", async () => {
    stubStorage();
    stubBridge({ getSettings: { "emu8086web:theme": "light" } });
    const restored = await restoreMirroredPrefs();
    assert.deepEqual(restored, ["emu8086web:theme"]);
    assert.equal(loadAccent(), null);
    assert.equal(
      (globalThis as { localStorage: Storage }).localStorage.getItem(
        "emu8086web:theme",
      ),
      "light",
    );
  });

  it("never overwrites a value the user set in this origin", async () => {
    const store = stubStorage();
    store.set("emu8086web:theme", "dark");
    store.set(AUTO_UPDATE_KEY, "0");
    stubBridge({
      getSettings: { "emu8086web:theme": "light", autoUpdate: "1" },
    });
    const restored = await restoreMirroredPrefs();
    assert.deepEqual(restored, [], "nothing should have been restored");
    assert.equal(store.get("emu8086web:theme"), "dark");
    assert.equal(store.get(AUTO_UPDATE_KEY), "0");
  });

  it("restores only the keys it knows, ignoring anything else stored", async () => {
    const store = stubStorage();
    stubBridge({
      getSettings: { "emu8086web:theme": "light", evilKey: "payload" },
    });
    await restoreMirroredPrefs();
    assert.equal(store.has("evilKey"), false);
  });

  it("skips a stored empty string, which is not a value", async () => {
    const store = stubStorage();
    stubBridge({ getSettings: { AUTO_UPDATE_KEY: "" } });
    const restored = await restoreMirroredPrefs();
    assert.deepEqual(restored, []);
    assert.equal(store.has(AUTO_UPDATE_KEY), false);
  });

  it("returns nothing in the browser", async () => {
    stubStorage();
    (globalThis as { window?: unknown }).window = {};
    assert.deepEqual(await restoreMirroredPrefs(), []);
  });

  it("returns nothing when the bridge rejects", async () => {
    stubStorage();
    (globalThis as { window?: unknown }).window = {
      electronAPI: {
        isElectron: () => true,
        getSettings: async () => {
          throw new Error("Untrusted sender");
        },
      },
    };
    assert.deepEqual(await restoreMirroredPrefs(), []);
  });

  it("survives localStorage refusing the write", async () => {
    stubStorage({ failWrites: true });
    stubBridge({ getSettings: { "emu8086web:theme": "light" } });
    assert.deepEqual(await restoreMirroredPrefs(), []);
  });
});

describe("isDesktop", () => {
  it("is false in a browser", () => {
    (globalThis as { window?: unknown }).window = {};
    assert.equal(isDesktop(), false);
  });

  it("is false with no window at all, as during SSR", () => {
    clearGlobals();
    assert.equal(isDesktop(), false);
  });

  it("is true inside the Electron shell", () => {
    stubBridge({});
    assert.equal(isDesktop(), true);
  });
});

describe("existing loaders are unchanged", () => {
  it("still validate rather than trusting storage", () => {
    const store = stubBrowser();
    store.set(TAB_SIZE_KEY, "5");
    store.set(ACCENT_KEY, "not-a-colour");
    assert.equal(loadTabSize(), 4, "an invalid tab size falls back");
    assert.equal(loadAccent(), null, "an invalid colour falls back to null");
  });
});
