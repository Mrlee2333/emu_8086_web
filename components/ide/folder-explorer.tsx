"use client";

import type { ReactNode } from "react";
import {
  IconChevronDownSm,
  IconChevronRight,
  IconDownload,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconPanelLeftClose,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconX,
} from "@/components/ide/editor-icons";
import type { VisibleRow } from "@/lib/ide/workspace-folders";

type CollapseProp = {
  /** Hide the whole Explorer (button sits top-left, after the heading). */
  onCollapse: () => void;
};

type DiskExplorerProps = {
  mode: "disk";
  rootName: string;
  rows: VisibleRow[];
  expanded: Set<string>;
  selectedPath: string | null;
  onToggleFolder: (relPath: string) => void;
  onOpenFile: (relPath: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onRefresh: () => void;
  onCloseFolder: () => void;
} & CollapseProp;

type VirtualExplorerProps = {
  mode: "virtual";
  files: { id: string; name: string; dirty: boolean }[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewFile: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onOpenFolder: () => void;
} & CollapseProp;

type EmptyExplorerProps = {
  /** Electron with no folder open: invite opening the real filesystem. */
  mode: "empty";
  onOpenFolder: () => void;
} & CollapseProp;

export type FolderExplorerProps =
  | DiskExplorerProps
  | VirtualExplorerProps
  | EmptyExplorerProps;

function IconBtn({
  title,
  onClick,
  danger,
  bubble = true,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  /**
   * Custom bubble tooltip. Disabled inside the scrolling tree, where the
   * overflow container would clip it — native `title` still applies there.
   */
  bubble?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded p-1 text-ink-dim hover:bg-panel-2 hover:text-amber ${
        danger ? "hover:!text-red" : ""
      }`}
      title={title}
      aria-label={title}
      data-tip={bubble ? title : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ExplorerHeader({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div className="flex items-center justify-between gap-1 pr-1.5 pl-3">
      <p className="py-2 font-mono text-[10px] tracking-[0.15em] text-ink-dim uppercase">
        Explorer
      </p>
      <button
        type="button"
        className="rounded p-1 text-ink-dim hover:bg-panel-2 hover:text-amber"
        title="Hide Explorer"
        aria-label="Hide Explorer"
        data-tip="Hide Explorer"
        onClick={onCollapse}
      >
        <IconPanelLeftClose />
      </button>
    </div>
  );
}

function DiskView(props: DiskExplorerProps) {
  const {
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
    onCollapse,
  } = props;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExplorerHeader onCollapse={onCollapse} />
      <div className="flex items-center justify-between gap-1 px-2 pb-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink"
          title={rootName}
        >
          {rootName}
        </span>
        <span className="flex shrink-0 items-center">
          <IconBtn title="New file" onClick={() => onNewFile("")}>
            <IconFilePlus />
          </IconBtn>
          <IconBtn title="New folder" onClick={() => onNewFolder("")}>
            <IconFolderPlus />
          </IconBtn>
          <IconBtn title="Refresh explorer" onClick={onRefresh}>
            <IconRefresh />
          </IconBtn>
          <IconBtn title="Close folder" onClick={onCloseFolder}>
            <IconX />
          </IconBtn>
        </span>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto pb-2"
        role="tree"
        aria-label="Folder contents"
      >
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
                className={`group flex items-center gap-0.5 pr-1 text-xs ${
                  selected
                    ? "bg-[var(--highlight)] text-amber"
                    : "text-ink hover:bg-panel-2"
                }`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 text-left"
                  onClick={() =>
                    isFolder
                      ? onToggleFolder(node.relPath)
                      : onOpenFile(node.relPath)
                  }
                  onDoubleClick={() => {
                    if (isFolder) onToggleFolder(node.relPath);
                  }}
                  title={node.relPath}
                >
                  <span className="flex w-4 shrink-0 items-center text-ink-dim">
                    {isFolder ? (
                      isOpen ? (
                        <IconChevronDownSm />
                      ) : (
                        <IconChevronRight />
                      )
                    ) : (
                      <IconFile className="h-3.5 w-3.5" />
                    )}
                  </span>
                  {isFolder ? (
                    isOpen ? (
                      <IconFolderOpen className="h-3.5 w-3.5 shrink-0 text-amber" />
                    ) : (
                      <IconFolder className="h-3.5 w-3.5 shrink-0 text-ink-dim" />
                    )
                  ) : null}
                  <span className="truncate font-mono">{node.name}</span>
                </button>
                <span className="hidden shrink-0 items-center group-hover:flex">
                  {isFolder ? (
                    <>
                      <IconBtn
                        title={`New file in ${node.name}`}
                        bubble={false}
                        onClick={() => onNewFile(node.relPath)}
                      >
                        <IconFilePlus />
                      </IconBtn>
                      <IconBtn
                        title={`New folder in ${node.name}`}
                        bubble={false}
                        onClick={() => onNewFolder(node.relPath)}
                      >
                        <IconFolderPlus />
                      </IconBtn>
                    </>
                  ) : null}
                  <IconBtn
                    title={`Rename ${node.name}`}
                    bubble={false}
                    onClick={() => onRename(node.relPath)}
                  >
                    <IconPencil />
                  </IconBtn>
                  <IconBtn
                    title={`Delete ${node.name}`}
                    danger
                    bubble={false}
                    onClick={() => onDelete(node.relPath)}
                  >
                    <IconTrash />
                  </IconBtn>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyView(props: EmptyExplorerProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExplorerHeader onCollapse={props.onCollapse} />
      <div className="flex items-center justify-between gap-1 px-2 pb-1">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink">
          No folder open
        </span>
      </div>
      <div className="flex flex-col items-start gap-2 px-3 py-2">
        <p className="text-xs text-ink-dim">
          Open a folder to browse and edit .asm files on disk.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={props.onOpenFolder}
        >
          Open folder…
        </button>
      </div>
    </div>
  );
}

function VirtualView(props: VirtualExplorerProps) {
  const {
    files,
    activeId,
    onSelect,
    onNewFile,
    onRename,
    onDelete,
    onExport,
    onOpenFolder,
    onCollapse,
  } = props;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExplorerHeader onCollapse={onCollapse} />
      <div className="flex items-center justify-between gap-1 px-2 pb-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink"
          title="Browser project — stored on this device"
        >
          Project
        </span>
        <span className="flex shrink-0 items-center">
          <IconBtn title="New file" onClick={onNewFile}>
            <IconFilePlus />
          </IconBtn>
          <IconBtn
            title="Export project as .zip"
            onClick={onExport}
          >
            <IconDownload />
          </IconBtn>
          <IconBtn
            title="Open folder (desktop app or Chrome/Edge)"
            onClick={onOpenFolder}
          >
            <IconFolderOpen />
          </IconBtn>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2" role="tree" aria-label="Project files">
        {files.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-3 py-2">
            <p className="text-xs text-ink-dim">
              No files yet — create one to start coding.
            </p>
            <button type="button" className="btn btn-primary" onClick={onNewFile}>
              New file
            </button>
          </div>
        ) : (
          files.map((f) => {
            const selected = f.id === activeId;
            return (
              <div
                key={f.id}
                role="treeitem"
                aria-selected={selected}
                className={`group flex items-center gap-0.5 py-0.5 pr-1 pl-3 text-xs ${
                  selected
                    ? "bg-[var(--highlight)] text-amber"
                    : "text-ink hover:bg-panel-2"
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-0.5 text-left"
                  onClick={() => onSelect(f.id)}
                  title={`${f.name} (double-click to rename)`}
                  onDoubleClick={() => onRename(f.id)}
                >
                  <IconFile className="h-3.5 w-3.5 shrink-0 text-ink-dim" />
                  <span className="truncate font-mono">
                    {f.dirty ? "• " : ""}
                    {f.name}
                  </span>
                </button>
                <span className="hidden shrink-0 items-center group-hover:flex">
                  <IconBtn
                    title={`Rename ${f.name}`}
                    bubble={false}
                    onClick={() => onRename(f.id)}
                  >
                    <IconPencil />
                  </IconBtn>
                  <IconBtn
                    title={`Delete ${f.name}`}
                    danger
                    bubble={false}
                    onClick={() => onDelete(f.id)}
                  >
                    <IconTrash />
                  </IconBtn>
                </span>
              </div>
            );
          })
        )}
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[10px] text-ink-dim">
        Browser project — files stay on this device.
      </p>
    </div>
  );
}

/**
 * VS Code-style Explorer (v1.4.0): disk-folder tree on desktop/Chromium,
 * Overleaf-like virtual project in plain browsers. All destructive and
 * name inputs go through in-app dialogs (prompt() throws in Electron).
 */
export function FolderExplorer(props: FolderExplorerProps) {
  if (props.mode === "disk") return <DiskView {...props} />;
  if (props.mode === "empty") return <EmptyView {...props} />;
  return <VirtualView {...props} />;
}
