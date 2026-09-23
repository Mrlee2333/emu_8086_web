"use client";

import { useEffect, useRef, useState } from "react";
import type { RunState, SampleKey } from "@/lib/emulator";
import { SAMPLE_OPTIONS } from "@/lib/emulator";
import { BrandMark, BrandWordmark } from "@/components/brand/brand-mark";
import { HelpMenu } from "@/components/ide/help-menu";
import {
  IconChevronDown,
  IconCompile,
  IconFolderOpen,
  IconMoon,
  IconPause,
  IconPlay,
  IconReset,
  IconSave,
  IconSaveAs,
  IconShare,
  IconStepBack,
  IconStepOver,
  IconSun,
} from "@/components/ide/editor-icons";
import { APP_VERSION } from "@/lib/version";

interface ToolbarProps {
  runState: RunState;
  canRun: boolean;
  isRunning: boolean;
  canStepBack: boolean;
  runSpeed: number;
  theme: "dark" | "light";
  fileName: string;
  onAssemble: () => void;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onStepBack: () => void;
  onReset: () => void;
  onSample: (key: SampleKey) => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onShare: () => void;
  onToggleTheme: () => void;
  onSpeedChange: (ms: number) => void;
  onOpenSettings: () => void;
}

const BADGE: Record<RunState, string> = {
  idle: "idle",
  ready: "ready",
  running: "running",
  halted: "halted",
  error: "error",
};

function FileMenu({
  onOpen,
  onSave,
  onSaveAs,
  onShare,
}: Pick<ToolbarProps, "onOpen" | "onSave" | "onSaveAs" | "onShare">) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-ink hover:bg-panel-2 hover:text-amber";

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="btn inline-flex shrink-0 items-center gap-1.5"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="File menu"
        title="File — open, save, share"
      >
        <IconFolderOpen />
        <span className="hidden lg:inline">File</span>
        <span className="hidden lg:inline-flex">
          <IconChevronDown />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="File"
          className="absolute top-full left-0 z-40 mt-1 min-w-[220px] border border-line bg-panel py-1 shadow-xl"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={run(onOpen)}>
            <IconFolderOpen />
            <span className="flex-1">Open…</span>
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={run(onSave)}>
            <IconSave />
            <span className="flex-1">Save</span>
            <kbd className="shrink-0 rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
              Ctrl+S
            </kbd>
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={run(onSaveAs)}>
            <IconSaveAs />
            <span className="flex-1">Save as…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} border-t border-line`}
            onClick={run(onShare)}
          >
            <IconShare />
            <span className="flex-1">Share…</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Toolbar({
  runState,
  canRun,
  isRunning,
  canStepBack,
  runSpeed,
  theme,
  fileName,
  onAssemble,
  onRun,
  onPause,
  onStep,
  onStepBack,
  onReset,
  onSample,
  onOpen,
  onSave,
  onSaveAs,
  onShare,
  onToggleTheme,
  onSpeedChange,
  onOpenSettings,
}: ToolbarProps) {
  return (
    <header className="flex items-center gap-2 border-b border-line bg-linear-to-b from-[var(--panel)] to-[var(--bg)] px-2 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
      <div className="min-w-0 shrink-0">
        <span className="sm:hidden" aria-hidden={false} title="emu8086web">
          <BrandMark size={26} />
        </span>
        <span className="hidden sm:block">
          <BrandWordmark />
        </span>
        <p className="mt-0.5 hidden text-[10px] uppercase tracking-[0.14em] text-ink-dim sm:block">
          v{APP_VERSION} · {fileName || "no file"}
        </p>
      </div>

      <select
        className="w-[86px] shrink-0 truncate rounded border border-line bg-panel-2 px-2 py-2 font-mono text-xs text-ink sm:w-auto sm:max-w-[140px]"
        defaultValue=""
        aria-label="Load sample program"
        title="Load sample program"
        onChange={(e) => {
          const v = e.target.value as SampleKey;
          if (v) onSample(v);
          e.target.value = "";
        }}
      >
        <option value="">Sample…</option>
        {SAMPLE_OPTIONS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>

      <FileMenu onOpen={onOpen} onSave={onSave} onSaveAs={onSaveAs} onShare={onShare} />
      <div className="hidden h-6 w-px shrink-0 bg-line sm:block" />
      {/* Single line on small screens: icon-only buttons in a scroll strip. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 sm:gap-2">
        <button
          type="button"
          className="btn btn-primary inline-flex shrink-0 items-center gap-1.5"
          onClick={onAssemble}
          aria-label="Compile"
          title="Compile (F5)"
        >
          <IconCompile />
          <span className="hidden lg:inline">Compile</span>
        </button>
        {isRunning ? (
          <button
            type="button"
            className="btn inline-flex shrink-0 items-center gap-1.5"
            onClick={onPause}
            aria-label="Pause"
            title="Pause (Esc)"
          >
            <IconPause />
            <span className="hidden lg:inline">Pause</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn inline-flex shrink-0 items-center gap-1.5"
            disabled={!canRun}
            onClick={onRun}
            aria-label="Run"
            title="Run"
          >
            <IconPlay />
            <span className="hidden lg:inline">Run</span>
          </button>
        )}
        <button
          type="button"
          className="btn inline-flex shrink-0 items-center gap-1.5"
          disabled={!canRun || isRunning}
          onClick={onStep}
          aria-label="Single Step"
          title="Single Step (F8)"
        >
          <IconStepOver />
          <span className="hidden lg:inline">Single Step</span>
        </button>
        <button
          type="button"
          className="btn inline-flex shrink-0 items-center gap-1.5"
          disabled={!canStepBack || isRunning}
          onClick={onStepBack}
          aria-label="Step Back"
          title="Step Back (Shift+F8)"
        >
          <IconStepBack />
          <span className="hidden lg:inline">Step Back</span>
        </button>
        <button
          type="button"
          className="btn btn-danger inline-flex shrink-0 items-center gap-1.5"
          onClick={onReset}
          aria-label="Reset"
          title="Reset"
        >
          <IconReset />
          <span className="hidden lg:inline">Reset</span>
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div className="hidden h-6 w-px bg-line lg:block" />
        <label className="hidden items-center gap-2 text-[10px] uppercase tracking-wider text-ink-dim xl:flex">
          Speed
          <input
            type="range"
            min={1}
            max={100}
            value={101 - runSpeed}
            onChange={(e) => onSpeedChange(101 - Number(e.target.value))}
            className="w-20 accent-amber"
          />
        </label>
        <HelpMenu onOpenSettings={onOpenSettings} />
        <button
          type="button"
          className="btn btn-icon"
          onClick={onToggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <span
          className={`badge hidden sm:inline ${runState === "running" ? "badge-live" : ""} ${runState === "halted" ? "badge-halt" : ""} ${runState === "error" ? "badge-error" : ""}`}
        >
          {BADGE[runState]}
        </span>
      </div>
    </header>
  );
}
