"use client";

import { useEffect, useState } from "react";
import type { Machine } from "@/lib/emulator/machine";
import { CollapsibleSection } from "@/components/ide/collapsible-section";
import {
  evaluateWatch,
  loadWatches,
  MAX_WATCH_CHARS,
  MAX_WATCHES,
  saveWatches,
} from "@/lib/ide/watch";

export function WatchPanel({ machine }: { machine: Machine | null }) {
  const [watches, setWatches] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    queueMicrotask(() => setWatches(loadWatches()));
  }, []);

  const persist = (next: string[]) => {
    setWatches(next);
    saveWatches(next);
  };

  const add = () => {
    const expr = draft.trim();
    if (!expr || watches.includes(expr)) return;
    if (watches.length >= MAX_WATCHES) return;
    persist([...watches, expr.slice(0, MAX_WATCH_CHARS)]);
    setDraft("");
  };

  return (
    <CollapsibleSection
      title="Watch"
      storageKey="watch"
      action={
        <span className="text-[10px] normal-case tracking-normal text-ink-dim">
          {watches.length}/{MAX_WATCHES}
        </span>
      }
    >
      <div className="border-b border-line bg-panel px-3.5 py-2.5">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="ax · count · [si] · byte ptr [bx]"
            maxLength={MAX_WATCH_CHARS}
            aria-label="Add watch expression"
            className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-amber"
          />
          <button
            type="button"
            className="btn !px-3 !py-1.5"
            onClick={add}
            disabled={!draft.trim()}
            title="Add watch"
          >
            Add
          </button>
        </div>
        {watches.length === 0 ? (
          <p className="mt-2 text-xs text-ink-dim">
            Watch registers, variables, or memory while stepping — e.g.{" "}
            <span className="font-mono text-amber">ax</span>,{" "}
            <span className="font-mono text-amber">count</span>,{" "}
            <span className="font-mono text-amber">[si]</span>.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {watches.map((w) => {
              const r = evaluateWatch(w, machine);
              return (
                <li
                  key={w}
                  className="flex items-center gap-2 rounded border border-line/60 bg-panel-2/40 px-2 py-1.5 font-mono text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-amber">{w}</span>
                  {r.ok ? (
                    <span className="shrink-0 text-ink" title={`dec ${r.dec} · signed ${r.signed}${r.ascii ? ` · ${r.ascii}` : ""}`}>
                      {r.hex} <span className="text-ink-dim">({r.dec})</span>
                    </span>
                  ) : (
                    <span className="shrink-0 truncate text-[11px] text-red" title={r.error}>
                      {r.error}
                    </span>
                  )}
                  <button
                    type="button"
                    className="shrink-0 px-1 text-ink-dim hover:text-red"
                    onClick={() => persist(watches.filter((x) => x !== w))}
                    aria-label={`Remove watch ${w}`}
                    title="Remove"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </CollapsibleSection>
  );
}
