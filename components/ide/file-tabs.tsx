"use client";

import { IconFilePlus } from "@/components/ide/editor-icons";

interface FileTabsProps {
  files: { id: string; name: string; dirty: boolean }[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
}

export function FileTabs({
  files,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
}: FileTabsProps) {
  return (
    <div className="flex min-h-9 items-stretch gap-0 overflow-x-auto border-b border-line bg-panel">
      {files.map((f) => {
        const active = f.id === activeId;
        return (
          <div
            key={f.id}
            className={`group flex max-w-[180px] shrink-0 items-center gap-1 border-r border-line px-2 py-1.5 text-xs ${
              active
                ? "bg-bg text-amber"
                : "bg-panel text-ink-dim hover:bg-panel-2 hover:text-ink"
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left font-mono"
              onClick={() => onSelect(f.id)}
              onDoubleClick={() => onRename(f.id)}
              title={`${f.name} (double-click to rename)`}
            >
              {f.dirty ? "• " : ""}
              {f.name}
            </button>
            <button
              type="button"
              className="rounded px-1 text-ink-dim opacity-60 hover:bg-line hover:text-red hover:opacity-100"
              title="Close file"
              onClick={(e) => {
                e.stopPropagation();
                onClose(f.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="flex shrink-0 items-center px-3 text-ink-dim hover:text-amber"
        title="New file"
        aria-label="New file"
        onClick={onNew}
      >
        <IconFilePlus />
      </button>
    </div>
  );
}
