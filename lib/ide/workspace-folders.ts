import { sanitizeFileName } from "@/lib/ide/workspace-files";

/** Branded id so folder-tree ids can't be mixed with other strings. */
export type NodeId = string & { readonly __brand: "ExplorerNodeId" };

/** Single file entry in the explorer tree (structure only; content loads on open). */
export type ExplorerFile = {
  kind: "file";
  id: NodeId;
  name: string;
  relPath: string;
};

/** Folder entry holding sorted children. */
export type ExplorerFolder = {
  kind: "folder";
  id: NodeId;
  name: string;
  relPath: string;
  children: ExplorerNode[];
};

/** Discriminated union — switch on `kind`, never optional-field bags. */
export type ExplorerNode = ExplorerFile | ExplorerFolder;

/** Root folder of an opened directory (relPath is always ""). */
export type ExplorerRoot = ExplorerFolder;

/** Safety bound so a huge directory can't freeze rendering. */
export const MAX_TREE_NODES = 2000;

/** Storage key for the sidebar collapsed state. */
export const SIDEBAR_COLLAPSED_KEY = "emu8086web:sidebarCollapsed";

/** Storage key for the expanded-folder set (array of relPaths). */
export const SIDEBAR_EXPANDED_KEY = "emu8086web:sidebarExpanded";

export function createNodeId(): NodeId {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` as NodeId;
}

/**
 * Validate a single path segment (file or folder name).
 * Reuses the workspace filename rules: no separators, traversal, or controls.
 */
export function isValidSegment(name: string): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return false;
  if (/[\\/]/.test(trimmed)) return false;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;
  if (trimmed.length > 64) return false;
  return sanitizeFileName(trimmed) !== "untitled" || trimmed === "untitled";
}

/** Join parent relPath with a child name using posix separators. */
export function joinRelPath(parent: string, name: string): string {
  const clean = name.trim().replace(/[\\/]+/g, "");
  if (!parent) return clean;
  return `${parent.replace(/\/+$/, "")}/${clean}`;
}

type NamedInput = {
  name: string;
  parentPath?: string;
};

export function createFileNode({ name, parentPath = "" }: NamedInput): ExplorerFile {
  const clean = sanitizeFileName(name);
  if (!clean || clean === "untitled" || !isValidSegment(name.trim())) {
    throw new Error(`Invalid file name: ${name}`);
  }
  return {
    kind: "file",
    id: createNodeId(),
    name: clean,
    relPath: joinRelPath(parentPath, clean),
  };
}

export function createFolderNode({ name, parentPath = "" }: NamedInput): ExplorerFolder {
  const trimmed = name.trim().replace(/[\\/]+/g, "");
  const clean = sanitizeFileName(trimmed).replace(/\.(asm|txt|inc)$/i, "");
  if (!trimmed || !isValidSegment(trimmed)) {
    throw new Error(`Invalid folder name: ${name}`);
  }
  return {
    kind: "folder",
    id: createNodeId(),
    name: clean,
    relPath: joinRelPath(parentPath, clean),
    children: [],
  };
}

/** Empty root for an opened folder (display name kept separately by the UI). */
export function createExplorerRoot(name = ""): ExplorerRoot {
  return { kind: "folder", id: createNodeId(), name, relPath: "", children: [] };
}

/** Folders first, then alphabetical (case-insensitive). Pure sort helper. */
export function sortNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function findNode({
  root,
  relPath,
}: {
  root: ExplorerRoot;
  relPath: string;
}): ExplorerNode | null {
  if (!relPath) return root;
  const parts = relPath.split("/").filter(Boolean);
  let current: ExplorerNode = root;
  for (const part of parts) {
    if (current.kind !== "folder") return null;
    const folder: ExplorerFolder = current;
    const next: ExplorerNode | undefined = folder.children.find(
      (c) => c.name.toLowerCase() === part.toLowerCase(),
    );
    if (!next) return null;
    current = next;
  }
  return current;
}

function cloneFolder(folder: ExplorerFolder): ExplorerFolder {
  return { ...folder, children: [...folder.children] };
}

function insertRecursive(
  current: ExplorerFolder,
  parts: string[],
  node: ExplorerNode,
): ExplorerFolder {
  const next = cloneFolder(current);
  if (parts.length === 0) {
    if (next.children.some((c) => c.name.toLowerCase() === node.name.toLowerCase())) {
      throw new Error(`A file or folder named "${node.name}" already exists`);
    }
    next.children = sortNodes([...next.children, node]);
    return next;
  }
  const [head, ...rest] = parts;
  const idx = next.children.findIndex(
    (c) => c.kind === "folder" && c.name.toLowerCase() === head.toLowerCase(),
  );
  if (idx === -1) throw new Error(`Folder not found: ${head}`);
  const child = next.children[idx] as ExplorerFolder;
  next.children[idx] = insertRecursive(child, rest, node);
  return next;
}

export function addNode({
  root,
  parentPath = "",
  node,
}: {
  root: ExplorerRoot;
  parentPath?: string;
  node: ExplorerNode;
}): ExplorerRoot {
  const parts = parentPath ? parentPath.split("/").filter(Boolean) : [];
  // Keep relPath consistent with the actual parent.
  const fixed: ExplorerNode =
    node.kind === "file"
      ? { ...node, relPath: joinRelPath(parentPath, node.name) }
      : {
          ...node,
          relPath: joinRelPath(parentPath, node.name),
          children: node.children,
        };
  return insertRecursive(root, parts, fixed);
}

function renameRecursive(
  current: ExplorerFolder,
  parts: string[],
  newName: string,
  parentPath: string,
): ExplorerFolder {
  const next = cloneFolder(current);
  const [head, ...rest] = parts;
  const idx = next.children.findIndex(
    (c) => c.name.toLowerCase() === head.toLowerCase(),
  );
  if (idx === -1) throw new Error(`Path not found: ${parts.join("/")}`);
  if (rest.length === 0) {
    const target = next.children[idx];
    if (
      next.children.some(
        (c, i) => i !== idx && c.name.toLowerCase() === newName.toLowerCase(),
      )
    ) {
      throw new Error(`A file or folder named "${newName}" already exists`);
    }
    const newRel = joinRelPath(parentPath, newName);
    if (target.kind === "file") {
      next.children[idx] = { ...target, name: newName, relPath: newRel };
    } else {
      next.children[idx] = rebaseFolder(target, newName, newRel);
    }
    next.children = sortNodes(next.children);
    return next;
  }
  const child = next.children[idx];
  if (child.kind !== "folder") throw new Error(`Not a folder: ${head}`);
  next.children[idx] = renameRecursive(
    child,
    rest,
    newName,
    parentPath ? `${parentPath}/${head}` : head,
  );
  return next;
}

function rebaseFolder(folder: ExplorerFolder, name: string, relPath: string): ExplorerFolder {
  const rebasedChildren = folder.children.map((c) =>
    c.kind === "file"
      ? { ...c, relPath: joinRelPath(relPath, c.name) }
      : rebaseFolder(c, c.name, joinRelPath(relPath, c.name)),
  );
  return { ...folder, name, relPath, children: rebasedChildren };
}

export function renameNode({
  root,
  relPath,
  newName,
}: {
  root: ExplorerRoot;
  relPath: string;
  newName: string;
}): ExplorerRoot {
  const trimmed = newName.trim();
  if (!isValidSegment(trimmed)) throw new Error(`Invalid name: ${newName}`);
  // Preserve .asm-style extensions for files via sanitize; folders keep raw.
  const existing = findNode({ root, relPath });
  if (!existing || existing.kind === undefined) throw new Error(`Path not found: ${relPath}`);
  const clean = existing.kind === "file" ? sanitizeFileName(trimmed) : trimmed;
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("Cannot rename the workspace root");
  return renameRecursive(root, parts, clean, "");
}

function removeRecursive(current: ExplorerFolder, parts: string[]): ExplorerFolder {
  const next = cloneFolder(current);
  const [head, ...rest] = parts;
  const idx = next.children.findIndex(
    (c) => c.name.toLowerCase() === head.toLowerCase(),
  );
  if (idx === -1) throw new Error(`Path not found: ${parts.join("/")}`);
  if (rest.length === 0) {
    next.children = next.children.filter((_, i) => i !== idx);
    return next;
  }
  const child = next.children[idx];
  if (child.kind !== "folder") throw new Error(`Not a folder: ${head}`);
  next.children[idx] = removeRecursive(child, rest);
  return next;
}

export function removeNode({
  root,
  relPath,
}: {
  root: ExplorerRoot;
  relPath: string;
}): ExplorerRoot {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("Cannot remove the workspace root");
  return removeRecursive(root, parts);
}

/** Depth-first flatten of every file (for counts, search, open-by-path). */
export function listFiles({ root }: { root: ExplorerRoot }): ExplorerFile[] {
  const out: ExplorerFile[] = [];
  const walk = (folder: ExplorerFolder) => {
    for (const child of folder.children) {
      if (child.kind === "file") out.push(child);
      else walk(child);
    }
  };
  walk(root);
  return out;
}

/** Count every node (files + folders) — enforce MAX_TREE_NODES at the boundary. */
export function countNodes({ root }: { root: ExplorerRoot }): number {
  let n = 0;
  const walk = (folder: ExplorerFolder) => {
    for (const child of folder.children) {
      n += 1;
      if (child.kind === "folder") walk(child);
    }
  };
  walk(root);
  return n;
}

export type VisibleRow = {
  node: ExplorerNode;
  depth: number;
};

/** Flatten for rendering: children appear only when their folder is expanded. */
export function flattenVisible({
  root,
  expanded,
}: {
  root: ExplorerRoot;
  expanded: Set<string> | string[];
}): VisibleRow[] {
  const set = Array.isArray(expanded) ? new Set(expanded) : expanded;
  const rows: VisibleRow[] = [];
  const walk = (folder: ExplorerFolder, depth: number) => {
    for (const child of folder.children) {
      rows.push({ node: child, depth });
      if (child.kind === "folder" && set.has(child.relPath)) {
        walk(child, depth + 1);
      }
    }
  };
  walk(root, 0);
  return rows.slice(0, MAX_TREE_NODES);
}

/**
 * Flat directory entry (e.g. Electron readdir / File System Access walk).
 * `isDirectory` is authoritative — string inputs fall back to the extension
 * heuristic for backward compatibility.
 */
export type TreeEntry = {
  relPath: string;
  isDirectory: boolean;
};

/** Build a tree from flat posix relPaths (empty folders stay folders). */
export function buildTreeFromPaths(paths: (string | TreeEntry)[]): ExplorerRoot {
  const root = createExplorerRoot();
  let result = root;
  for (const entry of paths) {
    const raw = typeof entry === "string" ? entry : entry.relPath;
    const forcedDir = typeof entry !== "string" && entry.isDirectory;
    const parts = raw.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let parentPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      // Explicit directory flags win; otherwise the last segment with a
      // dot/extension is a file and everything else is a folder.
      const isFolder =
        !isLast || forcedDir || !/\.[a-z0-9]{1,5}$/i.test(part);
      const existing = findNode({ root: result, relPath: joinRelPath(parentPath, part) });
      if (!existing) {
        const toAdd = isFolder
          ? createFolderNode({ name: part, parentPath })
          : createFileNode({ name: part, parentPath });
        result = addNode({ root: result, parentPath, node: toAdd });
      }
      parentPath = joinRelPath(parentPath, part);
    }
    if (countNodes({ root: result }) > MAX_TREE_NODES) break;
  }
  return result;
}
