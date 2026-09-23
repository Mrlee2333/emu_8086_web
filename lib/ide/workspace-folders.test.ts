/**
 * Folder workspace tree tests (v1.4.0).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addNode,
  buildTreeFromPaths,
  countNodes,
  createExplorerRoot,
  createFileNode,
  createFolderNode,
  findNode,
  flattenVisible,
  isValidSegment,
  joinRelPath,
  listFiles,
  removeNode,
  renameNode,
} from "./workspace-folders";

describe("workspace-folders segments", () => {
  it("validates names like the file workspace", () => {
    assert.equal(isValidSegment("main.asm"), true);
    assert.equal(isValidSegment("examples"), true);
    assert.equal(isValidSegment("../evil"), false);
    assert.equal(isValidSegment("a/b"), false);
    assert.equal(isValidSegment(""), false);
    assert.equal(isValidSegment(".."), false);
  });

  it("joins rel paths with posix separators", () => {
    assert.equal(joinRelPath("", "main.asm"), "main.asm");
    assert.equal(joinRelPath("examples", "sort.asm"), "examples/sort.asm");
  });
});

describe("workspace-folders tree", () => {
  it("adds, finds, renames, and removes nodes", () => {
    let root = createExplorerRoot("demo");
    root = addNode({
      root,
      node: createFolderNode({ name: "examples" }),
    });
    root = addNode({
      root,
      parentPath: "examples",
      node: createFileNode({ name: "sort.asm" }),
    });

    const found = findNode({ root, relPath: "examples/sort.asm" });
    assert.ok(found && found.kind === "file");
    assert.equal(found.relPath, "examples/sort.asm");

    root = renameNode({
      root,
      relPath: "examples/sort.asm",
      newName: "bubble.asm",
    });
    assert.equal(
      findNode({ root, relPath: "examples/bubble.asm" })?.kind,
      "file",
    );

    root = removeNode({ root, relPath: "examples/bubble.asm" });
    assert.equal(findNode({ root, relPath: "examples/bubble.asm" }), null);
    assert.equal(listFiles({ root }).length, 0);
  });

  it("rejects duplicates in the same folder", () => {
    let root = createExplorerRoot();
    root = addNode({ root, node: createFileNode({ name: "main.asm" }) });
    assert.throws(() =>
      addNode({ root, node: createFileNode({ name: "main.asm" }) }),
    );
  });

  it("flattens only expanded folders for rendering", () => {
    let root = createExplorerRoot();
    root = addNode({ root, node: createFolderNode({ name: "a" }) });
    root = addNode({
      root,
      parentPath: "a",
      node: createFileNode({ name: "x.asm" }),
    });
    assert.equal(flattenVisible({ root, expanded: [] }).length, 1);
    const rows = flattenVisible({ root, expanded: ["a"] });
    assert.equal(rows.length, 2);
    assert.equal(rows[1].depth, 1);
  });

  it("builds a tree from flat Electron paths", () => {
    const root = buildTreeFromPaths([
      "main.asm",
      "examples/sort.asm",
      "examples/notes.txt",
    ]);
    assert.equal(countNodes({ root }), 4);
    assert.equal(listFiles({ root }).length, 3);
  });

  it("skips over-long segments instead of aborting the tree", () => {
    const long = `${"a".repeat(80)}.asm`;
    const root = buildTreeFromPaths(["main.asm", `examples/${long}`]);
    assert.equal(findNode({ root, relPath: "main.asm" })?.kind, "file");
    assert.ok(listFiles({ root }).length >= 1);
  });

  it("keeps empty folders as folders (not files)", () => {
    const root = buildTreeFromPaths([
      { relPath: "examples", isDirectory: true },
      { relPath: "main.asm", isDirectory: false },
    ]);
    const node = findNode({ root, relPath: "examples" });
    assert.ok(node && node.kind === "folder");
    // Empty folders expand to zero rows but stay toggleable.
    assert.equal(
      flattenVisible({ root, expanded: ["examples"] }).length,
      2,
    );
  });
});
