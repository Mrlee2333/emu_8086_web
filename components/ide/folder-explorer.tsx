"use client";

import type { VisibleRow } from "@/lib/ide/workspace-folders";

interface FolderExplorerProps {
  rootName: string;
  rows: VisibleRow[];
  expanded: Set<string>;
  selectedPath: string | null;
  onToggleFolder: (relPath: string) => void;
  onOpenFile: (relPath: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (relPath: string, newName: string) => void;
  onDelete: (relPath: string) => void;
  onRefresh: () => void;
  onCloseFolder: () => void;
  onOpenFolder: () => void;
}

function fileIcon(name: string): string {
  const low = name.toLowerCase();
  if (low.endsWith(".asm")) return "◈";
  if (low.endsWith(".inc")) return "◇";
  return "≡";
}

export function FolderExplorer({
  rootName,
  rows,
  expanded,
  selectedPath,
  onToggleFolder,
  onOpenFile,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onRefresh,
  onCloseFolder,
  onOpenFolder,
}: FolderExplorerProps) {
  if (!rootName) {
    return (
      <div className="flex h-full flex-col items-start gap-2 p-3 text-xs text-ink-dim">
        <p className="font-mono text-[11px] tracking-wide text-ink-dim uppercase">
          Explorer
        </p>
        <p>No folder open. Open a directory to browse .asm files like VS Code.</p>
        <button type="button" className="btn btn-primary" onClick={onOpenFolder}>
          Open folder…
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1 border-b border-line px-2 py-1.5">
        <span className="truncate font-mono text-[11px] tracking-wide text-ink-dim uppercase">
          {rootName}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="btn btn-icon !px-1.5 !py-1"
            title="New file in folder root"
            aria-label="New file"
            onClick={() => onNewFile("")}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-icon !px-1.5 !py-1"
            title="New subfolder"
            aria-label="New folder"
            onClick={() => onNewFolder("")}
          >
            ⧉
          </button>
          <button
            type="button"
            className="btn btn-icon !px-1.5 !py-1"
            title="Refresh folder"
            aria-label="Refresh folder"
            onClick={onRefresh}
          >
            ↻
          </button>
          <button
            type="button"
            className="btn btn-icon !px-1.5 !py-1"
            title="Close folder"
            aria-label="Close folder"
            onClick={onCloseFolder}
          >
            ×
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label="Folder contents">
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-ink-dim">
            Empty folder — create a .asm file to start.
          </p>
        ) : (
          rows.map(({ node, depth }) => {
            const isFolder = node.kind === "folder";
            const isOpen = isFolder && expanded.has(node.relPath);
            const selected = node.relPath === selectedPath;
            return (
              <div
                key={node.relPath}
                role="treeitem"
                aria-expanded={isFolder ? isOpen : undefined}
                aria-selected={selected}
                className={`group flex items-center gap-1 pr-1 text-xs ${
                  selected ? "bg-[var(--highlight)] text-amber" : "text-ink hover:bg-panel-2"
                }`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 text-left"
                  onClick={() =>
                    isFolder ? onToggleFolder(node.relPath) : onOpenFile(node.relPath)
                  }
                  onDoubleClick={() => {
                    if (!isFolder) return;
                    const next = window.prompt("Rename folder", node.name);
                    if (next && next !== node.name) onRename(node.relPath, next);
                  }}
                  title={node.relPath}
                >
                  <span className="w-3 shrink-0 text-[10px] text-ink-dim">
                    {isFolder ? (isOpen ? "▾" : "▸") : fileIcon(node.name)}
                  </span>
                  <span className="truncate font-mono">{node.name}</span>
                </button>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  {isFolder ? (
                    <>
                      <button
                        type="button"
                        className="rounded px-1 text-ink-dim hover:text-amber"
                        title={`New file in ${node.name}`}
                        onClick={() => onNewFile(node.relPath)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="rounded px-1 text-ink-dim hover:text-amber"
                        title={`New subfolder in ${node.name}`}
                        onClick={() => onNewFolder(node.relPath)}
                      >
                        ⧉
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="rounded px-1 text-ink-dim hover:text-amber"
                    title="Rename"
                    onClick={() => {
                      const next = window.prompt(
                        `Rename ${node.name}`,
                        node.name,
                      );
                      if (next && next !== node.name)
                        onRename(node.relPath, next);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="rounded px-1 text-ink-dim hover:text-red"
                    title="Delete"
                    onClick={() => onDelete(node.relPath)}
                  >
                    ⌫
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
