/**
 * Web File System Access helpers (v1.4.0 folder workspace).
 * Thin wrappers around `showDirectoryPicker` — SSR-safe, feature-detected.
 * Electron uses the preload bridge instead; this module is web-only.
 */

export type WebDirHandle = {
  name: string;
  values: () => AsyncIterable<WebEntryHandle>;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<WebFileHandle>;
  getDirectoryHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<WebDirHandle>;
  removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
};

export type WebEntryHandle = {
  kind: "file" | "directory";
  name: string;
};

export type WebFileHandle = WebEntryHandle & {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{
    write: (content: string | Blob | File) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type PickerWindow = Window & {
  showDirectoryPicker?: () => Promise<WebDirHandle>;
};

/** True when the browser supports opening real directories (Chromium). */
export function supportsFolderPicker(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as PickerWindow).showDirectoryPicker === "function";
}

export async function pickWebFolder(): Promise<WebDirHandle | null> {
  const w = window as PickerWindow;
  if (!w.showDirectoryPicker) return null;
  try {
    return await w.showDirectoryPicker();
  } catch {
    // AbortError when the user cancels the picker.
    return null;
  }
}

const LISTABLE = /\.(asm|txt|inc)$/i;
const MAX_ENTRIES = 2000;

/** Depth-first list of source files + folders as posix relPaths. */
export async function listWebFolder(
  dir: WebDirHandle,
): Promise<{ relPath: string; isDirectory: boolean }[]> {
  const out: { relPath: string; isDirectory: boolean }[] = [];
  const walk = async (handle: WebDirHandle, prefix: string) => {
    for await (const entry of handle.values()) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        out.push({ relPath: rel, isDirectory: true });
        const sub = await handle.getDirectoryHandle(entry.name);
        if (out.length < MAX_ENTRIES) await walk(sub, rel);
      } else if (LISTABLE.test(entry.name)) {
        out.push({ relPath: rel, isDirectory: false });
      }
      if (out.length >= MAX_ENTRIES) break;
    }
  };
  await walk(dir, "");
  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
  return out;
}

async function traverseTo(
  root: WebDirHandle,
  relPath: string,
): Promise<{ parent: WebDirHandle; name: string }> {
  const parts = relPath.split("/").filter(Boolean);
  const name = parts.pop() ?? "";
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part);
  }
  return { parent: current, name };
}

export async function readWebFile(
  root: WebDirHandle,
  relPath: string,
): Promise<string> {
  const { parent, name } = await traverseTo(root, relPath);
  const handle = await parent.getFileHandle(name);
  const file = await handle.getFile();
  if (file.size > 256 * 1024) throw new Error("File too large (256 KiB cap)");
  return file.text();
}

export async function writeWebFile(
  root: WebDirHandle,
  relPath: string,
  content: string,
): Promise<void> {
  if (new Blob([content]).size > 256 * 1024) {
    throw new Error("File too large (256 KiB cap)");
  }
  const { parent, name } = await traverseTo(root, relPath);
  const handle = await parent.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function createWebEntry(
  root: WebDirHandle,
  relPath: string,
  isDirectory: boolean,
): Promise<void> {
  const parts = relPath.split("/").filter(Boolean);
  const name = parts.pop() ?? "";
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  if (isDirectory) {
    await current.getDirectoryHandle(name, { create: true });
  } else {
    await current.getFileHandle(name, { create: true });
  }
}

/**
 * Recursively copy a directory tree (FS Access has no rename/move, and a
 * rename must not drop children — previous versions deleted them).
 */
export async function copyWebTree(
  src: WebDirHandle,
  destParent: WebDirHandle,
  newName: string,
): Promise<void> {
  const dest = await destParent.getDirectoryHandle(newName, { create: true });
  for await (const entry of src.values()) {
    if (entry.kind === "file") {
      const srcFile = await (await src.getFileHandle(entry.name)).getFile();
      const destFile = await dest.getFileHandle(entry.name, { create: true });
      const writable = await destFile.createWritable();
      await writable.write(srcFile);
      await writable.close();
    } else {
      const sub = await src.getDirectoryHandle(entry.name);
      await copyWebTree(sub, dest, entry.name);
    }
  }
}
