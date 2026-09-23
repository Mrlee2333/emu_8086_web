/**
 * Web folder-tree copy tests (v1.4.0) — in-memory File System Access
 * mocks covering the nested-rename path (copy into same parent, then
 * remove the old entry). Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  copyWebTree,
  webEntryExists,
  type WebDirHandle,
  type WebEntryHandle,
  type WebFileHandle,
} from "./fs-access";

class MockWritable {
  constructor(
    private files: Map<string, Uint8Array>,
    private name: string,
  ) {}
  async write(content: string | Blob | File): Promise<void> {
    const bytes =
      typeof content === "string"
        ? new TextEncoder().encode(content)
        : new Uint8Array(await content.arrayBuffer());
    this.files.set(this.name, bytes);
  }
  async close(): Promise<void> {}
}

type MockDirApi = {
  files: Map<string, Uint8Array>;
  dirs: Map<string, MockDirApi>;
  values: () => AsyncIterable<WebEntryHandle>;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<WebFileHandle>;
  getDirectoryHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<WebDirHandle>;
  removeEntry: (
    name: string,
    opts?: { recursive?: boolean },
  ) => Promise<void>;
  readText: (path: string) => Promise<string>;
};

function createMockDir(): MockDirApi {
  const files = new Map<string, Uint8Array>();
  const dirs = new Map<string, MockDirApi>();
  const api: MockDirApi = {
    files,
    dirs,
    async *values(): AsyncIterable<WebEntryHandle> {
      for (const name of files.keys()) yield { kind: "file", name };
      for (const name of dirs.keys()) yield { kind: "directory", name };
    },
    async getFileHandle(name, opts) {
      if (!files.has(name)) {
        if (!opts?.create) throw new Error("not found");
        files.set(name, new Uint8Array());
      }
      return {
        kind: "file",
        name,
        getFile: async () =>
          new File([new Uint8Array(files.get(name)!)], name),
        createWritable: async () => new MockWritable(files, name),
      } as unknown as WebFileHandle;
    },
    async getDirectoryHandle(name, opts) {
      let sub = dirs.get(name);
      if (!sub) {
        if (!opts?.create) throw new Error("not found");
        sub = createMockDir();
        dirs.set(name, sub);
      }
      return sub as unknown as WebDirHandle;
    },
    async removeEntry(name, opts) {
      const sub = dirs.get(name);
      if (sub) {
        if ((sub.files.size > 0 || sub.dirs.size > 0) && !opts?.recursive) {
          throw new Error("not empty");
        }
        dirs.delete(name);
        return;
      }
      if (!files.delete(name)) throw new Error("not found");
    },
    async readText(path) {
      const parts = path.split("/").filter(Boolean);
      const leaf = parts.pop() ?? "";
      let current: MockDirApi = api;
      for (const part of parts) {
        current = current.dirs.get(part)!;
      }
      return new TextDecoder().decode(current.files.get(leaf));
    },
  };
  return api;
}

function asDir(mock: MockDirApi): WebDirHandle {
  return mock as unknown as WebDirHandle;
}

describe("copyWebTree", () => {
  it("copies a nested folder into the same parent (rename flow)", async () => {
    const root = createMockDir();
    const examples = (await root.getDirectoryHandle("examples", {
      create: true,
    })) as unknown as MockDirApi;
    const nested = (await examples.getDirectoryHandle("nested", {
      create: true,
    })) as unknown as MockDirApi;
    nested.files.set("deep.asm", new TextEncoder().encode("deep!"));
    examples.files.set("sort.asm", new TextEncoder().encode("sort!"));

    // Mirrors renameInFolder: src = examples/nested, dest parent = examples.
    const srcHandle = await (
      await root.getDirectoryHandle("examples")
    ).getDirectoryHandle("nested");
    const parentHandle = await root.getDirectoryHandle("examples");
    await copyWebTree(srcHandle, parentHandle, "renamed");
    await parentHandle.removeEntry("nested", { recursive: true });

    assert.equal(await root.readText("examples/renamed/deep.asm"), "deep!");
    assert.equal(await root.readText("examples/sort.asm"), "sort!");
    assert.equal(
      (parentHandle as unknown as MockDirApi).dirs.has("nested"),
      false,
    );
  });

  it("detects existing files and folders for rename guards", async () => {
    const root = createMockDir();
    const src = (await root.getDirectoryHandle("src", {
      create: true,
    })) as unknown as MockDirApi;
    src.files.set("a.asm", new TextEncoder().encode("a"));
    assert.equal(await webEntryExists(asDir(root), "src/a.asm"), true);
    assert.equal(await webEntryExists(asDir(root), "src"), true);
    assert.equal(await webEntryExists(asDir(root), "missing.asm"), false);
    assert.equal(await webEntryExists(asDir(root), "src/nope"), false);
  });

  it("copies files at the top level", async () => {
    const root = createMockDir();
    const src = (await root.getDirectoryHandle("src", {
      create: true,
    })) as unknown as MockDirApi;
    src.files.set("a.asm", new TextEncoder().encode("a"));
    await copyWebTree(asDir(src), asDir(root), "dst");
    assert.equal(await root.readText("dst/a.asm"), "a");
  });
});
