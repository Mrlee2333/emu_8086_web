"use client";

import { useMemo } from "react";
import type { Machine } from "@/lib/emulator/machine";
import { describeAlu } from "@/lib/ide/alu-info";

/**
 * ALU internal-operation view (v1.4.0) — mirrors the original Windows
 * emu8086 "ALU shows the internal work of the CPU" panel.
 * Pure description of the next instruction; no emulator changes.
 */
export function AluPanel({ machine }: { machine: Machine | null }) {
  const info = useMemo(() => {
    if (!machine) return null;
    return describeAlu({
      instrs: machine.a.instrs,
      ip: machine.ip,
      reg: machine.reg,
      flags: machine.flags,
    });
  }, [machine]);

  if (!machine || !info) {
    return (
      <section className="border-b border-line px-3 py-2" aria-label="ALU">
        <h3 className="paneltitle !border-0 !px-0 font-mono text-[11px] tracking-wide text-ink-dim uppercase">
          ALU
        </h3>
        <p className="text-xs text-ink-dim">Assemble to inspect the next operation.</p>
      </section>
    );
  }

  return (
    <section className="border-b border-line px-3 py-2" aria-label="ALU">
      <h3 className="paneltitle !border-0 !px-0 font-mono text-[11px] tracking-wide text-ink-dim uppercase">
        ALU {info.isAluOp ? "· active" : "· idle"}
      </h3>
      <p className="font-mono text-xs text-ink" title={info.summary}>
        {info.summary}
      </p>
      {info.affectedFlags.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {info.affectedFlags.map((f) => (
            <span
              key={f}
              className="rounded border border-line bg-panel-2 px-1 font-mono text-[10px] text-amber"
            >
              {f}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
