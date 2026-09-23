"use client";

import type { Machine } from "@/lib/emulator/machine";
import { describeAlu } from "@/lib/ide/alu-info";
import { CollapsibleSection } from "@/components/ide/collapsible-section";

/**
 * ALU internal-operation view (v1.4.0) — mirrors the original Windows
 * emu8086 "ALU shows the internal work of the CPU" panel.
 * Pure description of the next instruction; no emulator changes.
 * Computed inline every render: Machine mutates in place on step(), so a
 * memo on the (stable) object identity would go stale while stepping.
 */
export function AluPanel({ machine }: { machine: Machine | null }) {
  const info = machine
    ? describeAlu({
        instrs: machine.a.instrs,
        ip: machine.ip,
        reg: machine.reg,
        flags: machine.flags,
      })
    : null;

  return (
    <CollapsibleSection
      title={info?.isAluOp ? "ALU · active" : "ALU · idle"}
      storageKey="alu"
    >
      <div className="border-b border-line bg-panel px-3.5 py-2.5">
        {!machine || !info ? (
          <p className="text-xs text-ink-dim">
            Assemble to inspect the next operation.
          </p>
        ) : (
          <>
            <p className="font-mono text-xs text-ink" title={info.summary}>
              {info.summary}
            </p>
            {info.affectedFlags.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
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
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
