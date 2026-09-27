/**
 * Folder-workspace path resolution tests (v1.4.2).
 *
 * These exercise `electron/folder-resolve.js`, the same module `main.js`
 * calls, so the shipped confinement logic is the tested logic. The pure string
 * rules in `folder-guards.js` are covered by `folder-guards.test.ts`.
 *
 * Run: bun test lib electron
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isInside,
  resolveInside,
  resolveForWrite,
  resolveSourceFile,
  resolveWritableFile,
  resolveWritableDir,
} = require("./folder-resolve.js");

let base: string;
let root: string;
let outside: string;

before(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "emu-resolve-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  await fs.mkdir(path.join(root, "sub"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, "main.asm"), "mov ax, 1\n", "utf8");
  await fs.writeFile(path.join(root, "sub", "inc.asm"), "incbin 1\n", "utf8");
});

after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const rejects = async (p: Promise<unknown>) => {
  await assert.rejects(p, (err: Error) => {
    assert.match(err.message, /escapes|Invalid|Symbolic links|Only \.asm|No folder open/);
    return true;
  });
};

describe("isInside", () => {
  it("accepts the root and descendants", () => {
    assert.equal(isInside("/a", "/a"), true);
    assert.equal(isInside("/a", "/a/b/c.asm"), true);
  });

  it("rejects siblings, parents and absolute escapes", () => {
    assert.equal(isInside("/a", "/b"), false);
    assert.equal(isInside("/a", "/"), false);
    assert.equal(isInside("/a", "/a/../b"), false);
  });

  it("is not fooled by a shared name prefix", () => {
    // String startsWith("/a") would wrongly accept this.
    assert.equal(isInside("/a", "/ab/c.asm"), false);
  });
});

describe("resolveInside (read)", () => {
  it("resolves a normal file inside the root", async () => {
    const abs = await resolveInside(root, "main.asm");
    assert.equal(path.basename(abs), "main.asm");
    assert.ok(isInside(await fs.realpath(root), abs));
  });

  it("resolves a nested file", async () => {
    assert.ok((await resolveInside(root, "sub/inc.asm")).endsWith("inc.asm"));
  });

  it("rejects traversal, absolute paths and bad types", async () => {
    await rejects(resolveInside(root, "../outside/pwn.asm"));
    await rejects(resolveInside(root, "/etc/passwd"));
    await rejects(resolveInside(root, ".."));
    await rejects(resolveInside(root, ""));
    await rejects(resolveInside(root, 42 as unknown as string));
  });

  it("rejects when no folder is open", async () => {
    await rejects(resolveInside(null, "main.asm"));
  });

  it("follows a symlink that stays inside the root", async () => {
    // Reads are allowed to follow links that do not leave the workspace.
    await fs.symlink(path.join(root, "main.asm"), path.join(root, "alias.asm"));
    try {
      const abs = await resolveInside(root, "alias.asm");
      assert.ok(isInside(await fs.realpath(root), abs));
    } finally {
      await fs.rm(path.join(root, "alias.asm"), { force: true });
    }
  });
});

describe("resolveForWrite (mutation)", () => {
  it("allows an existing regular file", async () => {
    assert.ok((await resolveForWrite(root, "main.asm")).endsWith("main.asm"));
  });

  it("allows a new file in an existing directory", async () => {
    assert.ok((await resolveForWrite(root, "sub/fresh.asm")).endsWith("fresh.asm"));
  });

  it("allows a new file in a directory that does not exist yet", async () => {
    // mkdir -p creates it afterwards, so the parent falls back to its
    // unresolved (and in-root) path.
    const abs = await resolveForWrite(root, "brand/new/deep.asm");
    assert.ok(abs.endsWith(path.join("brand", "new", "deep.asm")));
  });

  it("rejects a dangling symlink leaf (the v1.4.1 escape)", async () => {
    // evil.asm -> <outside>/pwn.asm where pwn.asm does not exist, so realpath
    // throws ENOENT and the read guard alone would let the write through.
    await fs.symlink(path.join(outside, "pwn.asm"), path.join(root, "evil.asm"));
    try {
      await rejects(resolveForWrite(root, "evil.asm"));
      // And the escape really is closed: nothing was created outside.
      await assert.rejects(fs.stat(path.join(outside, "pwn.asm")));
    } finally {
      await fs.rm(path.join(root, "evil.asm"), { force: true });
    }
  });

  it("rejects a symlinked leaf even when its target exists", async () => {
    await fs.writeFile(path.join(outside, "real.asm"), "x", "utf8");
    await fs.symlink(path.join(outside, "real.asm"), path.join(root, "link.asm"));
    try {
      await rejects(resolveForWrite(root, "link.asm"));
    } finally {
      await fs.rm(path.join(root, "link.asm"), { force: true });
    }
  });

  it("rejects a symlinked parent directory (the escape resolveInside misses)", async () => {
    // resolveInside cannot see this: the leaf does not exist, so realpath
    // fails and the unresolved path is used — which looks in-root.
    await fs.symlink(outside, path.join(root, "linkedir"));
    try {
      await rejects(resolveForWrite(root, "linkedir/pwn.asm"));
    } finally {
      await fs.rm(path.join(root, "linkedir"), { force: true });
    }
  });

  it("still rejects traversal", async () => {
    await rejects(resolveForWrite(root, "../outside/pwn.asm"));
  });
});

describe("extension and dotfile policy", () => {
  it("resolveSourceFile allows .asm/.txt/.inc and rejects others", async () => {
    assert.ok((await resolveSourceFile(root, "main.asm")).endsWith("main.asm"));
    await rejects(resolveSourceFile(root, "evil.exe"));
    await rejects(resolveSourceFile(root, "evil"));
    await rejects(resolveSourceFile(root, ".hidden.asm"));
    await rejects(resolveSourceFile(root, "sub/.secret.asm"));
  });

  it("resolveWritableFile applies the same policy", async () => {
    assert.ok((await resolveWritableFile(root, "main.asm")).endsWith("main.asm"));
    await rejects(resolveWritableFile(root, "evil.exe"));
  });

  it("resolveWritableDir rejects dot segments and traversal", async () => {
    assert.ok((await resolveWritableDir(root, "sub")).endsWith("sub"));
    await rejects(resolveWritableDir(root, ".git"));
    await rejects(resolveWritableDir(root, ".."));
  });
});
