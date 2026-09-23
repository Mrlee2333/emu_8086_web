"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  IconChevronDownSm,
  IconChevronRight,
} from "@/components/ide/editor-icons";

interface CollapsibleSectionProps {
  title: string;
  /** Extra header controls (e.g. Details button, Goto input). */
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Persisted per panel so the CPU column keeps its shape. */
  storageKey?: string;
}

/**
 * VS Code-style collapsible panel (v1.4.0): chevron + title toggle in the
 * paneltitle header, matching the existing CPU-column look exactly.
 */
export function CollapsibleSection({
  title,
  action,
  children,
  defaultOpen = true,
  storageKey,
}: CollapsibleSectionProps) {
  // Start from defaultOpen so server HTML matches first client paint;
  // the stored value loads in an effect (no hydration mismatch).
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey) return;
    // Deferred (not sync setState) so mount stays cascade-free.
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(`emu8086web:panel:${storageKey}`);
        if (raw !== null) setOpen(raw === "1");
      } catch {
        /* best-effort */
      }
    });
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`emu8086web:panel:${storageKey}`, open ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }, [open, storageKey]);

  return (
    <section aria-label={title}>
      <div className="paneltitle flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-amber"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={open ? `Collapse ${title}` : `Expand ${title}`}
          data-tip={open ? `Collapse ${title}` : `Expand ${title}`}
        >
          <span className="shrink-0">
            {open ? <IconChevronDownSm /> : <IconChevronRight />}
          </span>
          <span className="truncate">{title}</span>
        </button>
        {action ? <span className="flex shrink-0 items-center gap-1">{action}</span> : null}
      </div>
      {open ? children : null}
    </section>
  );
}
