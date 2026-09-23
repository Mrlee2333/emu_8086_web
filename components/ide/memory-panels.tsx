"use client";

import { useRef, useState } from "react";
import type { AssembledProgram } from "@/lib/emulator";
import type { Machine } from "@/lib/emulator/machine";
import { CollapsibleSection } from "@/components/ide/collapsible-section";
import { hex2, hex4 } from "@/lib/emulator";
import {
  countMatches,
  findNextMatch,
  parseSearchPattern,
} from "@/lib/ide/memory-search";

interface MemoryPanelsProps {
  assembled: AssembledProgram | null;
  machine: Machine | null;
  hexBase: number;
  onHexBaseChange: (base: number) => void;
}

export function DataSegmentPanel({ assembled, machine }: MemoryPanelsProps) {
  if (!assembled || Object.keys(assembled.dataVars).length === 0) {
    return (
      <CollapsibleSection title="Data segment" storageKey="data-segment">
        <p className="border-b border-line px-3.5 py-4 text-xs text-ink-dim">
          Assemble a program to see declared variables here.
        </p>
      </CollapsibleSection>
    );
  }

  const mem = machine?.mem ?? assembled.mem;

  return (
    <CollapsibleSection title="Data segment" storageKey="data-segment">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="sticky top-0 bg-panel text-[10.5px] tracking-wide text-ink-dim uppercase">
              <th className="px-2.5 py-1.5 text-left font-semibold">Name</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">Type</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">Addr</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">Value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(assembled.dataVars).map(([name, info]) => {
              const vals: (string | number)[] = [];
              for (let i = 0; i < info.count; i++) {
                const addr = info.addr + i * info.unitSize;
                const v =
                  info.unitSize === 2
                    ? mem[addr] | (mem[addr + 1] << 8)
                    : mem[addr];
                vals.push(
                  info.unitSize === 1 && v >= 32 && v < 127
                    ? `'${String.fromCharCode(v)}'`
                    : v,
                );
                if (vals.length >= 8) {
                  vals.push("…");
                  break;
                }
              }
              return (
                <tr key={name} className="border-b border-line/50 hover:bg-panel-2/40">
                  <td className="px-2.5 py-1.5 text-amber">{name}</td>
                  <td className="px-2.5 py-1.5">{info.unitSize === 2 ? "WORD" : "BYTE"}</td>
                  <td className="px-2.5 py-1.5">0x{info.addr.toString(16).padStart(4, "0")}</td>
                  <td className="px-2.5 py-1.5">{vals.join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

export function HexDumpPanel({
  machine,
  hexBase,
  onHexBaseChange,
}: MemoryPanelsProps) {
  const mem = machine?.mem;
  const rows = 8;
  const cols = 16;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const lastMatch = useRef(-1);

  const jumpTo = (addr: number) => {
    lastMatch.current = addr;
    onHexBaseChange(addr & 0xfff0);
  };

  const runSearch = (from: number, allowWrap: boolean) => {
    if (!mem) {
      setStatus("Assemble first");
      return;
    }
    const pattern = parseSearchPattern(query);
    if (!pattern) {
      setStatus("Enter hex bytes (48 65) or text");
      return;
    }
    let hit = findNextMatch(mem, pattern, from);
    let wrapped = false;
    if (hit < 0 && allowWrap && from > 0) {
      hit = findNextMatch(mem, pattern, 0);
      wrapped = hit >= 0;
    }
    if (hit < 0) {
      lastMatch.current = -1;
      setStatus("Not found");
      return;
    }
    jumpTo(hit);
    const total = countMatches(mem, pattern);
    setStatus(
      `0x${hit.toString(16).padStart(4, "0").toUpperCase()} · ${total} match${total === 1 ? "" : "es"}${wrapped ? " · wrapped" : ""}`,
    );
  };

  const gotoAddress = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (!t) return;
    // Reuse assembler number styles: 1A2Bh, 0x1A2B, binary, decimal.
    let v: number | null = null;
    if (/^0x[0-9a-f]+$/i.test(t)) v = parseInt(t, 16);
    else if (/^[0-9a-f]+h$/i.test(t)) v = parseInt(t.slice(0, -1), 16);
    else if (/^[01]+b$/i.test(t)) v = parseInt(t.slice(0, -1), 2);
    else if (/^[0-9]+$/i.test(t)) v = parseInt(t, 10);
    if (v === null || Number.isNaN(v)) {
      setStatus("Bad address — try 1A2Bh, 0x1A2B, or 6699");
      return;
    }
    lastMatch.current = -1;
    setStatus(null);
    onHexBaseChange(v & 0xffff & 0xfff0);
  };

  return (
    <CollapsibleSection
      title="Memory dump"
      storageKey="memory-dump"
      action={
        <label className="flex items-center gap-2 text-[10px] font-normal normal-case tracking-normal text-ink-dim">
          Goto
          <input
            type="text"
            defaultValue={`0x${hexBase.toString(16).padStart(4, "0")}`}
            key={`0x${hexBase.toString(16).padStart(4, "0")}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                gotoAddress((e.target as HTMLInputElement).value);
              }
            }}
            onBlur={(e) => gotoAddress(e.target.value)}
            aria-label="Goto memory address"
            title="Goto address — Enter 1A2Bh, 0x1A2B, or decimal"
            className="w-20 rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-ink"
          />
        </label>
      }
    >
      <div className="flex items-center gap-2 border-b border-line/40 bg-panel px-3.5 py-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch(hexBase, true);
            }
          }}
          placeholder="Find bytes — 48 65 · 0x48 · Hi"
          aria-label="Find bytes in memory"
          className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-amber"
        />
        <button
          type="button"
          className="btn !px-2.5 !py-1 !text-[11px]"
          onClick={() => runSearch(hexBase, true)}
          disabled={!mem}
          title="Find from current base (wraps)"
        >
          Find
        </button>
        <button
          type="button"
          className="btn !px-2.5 !py-1 !text-[11px]"
          onClick={() =>
            runSearch(lastMatch.current >= 0 ? lastMatch.current + 1 : hexBase + 1, true)
          }
          disabled={!mem}
          title="Find next match"
        >
          Next
        </button>
        {status ? (
          <span className="shrink-0 font-mono text-[10px] text-ink-dim">{status}</span>
        ) : null}
      </div>
      <div className="max-h-40 overflow-auto font-mono text-[11px]">
        {!mem ? (
          <p className="px-3.5 py-4 text-xs text-ink-dim">Assemble to view memory.</p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {Array.from({ length: rows }, (_, row) => {
                const addr = (hexBase + row * cols) & 0xffff;
                const bytes = Array.from({ length: cols }, (_, col) => {
                  const a = (addr + col) & 0xffff;
                  return mem[a];
                });
                const ascii = bytes
                  .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
                  .join("");
                return (
                  <tr key={row} className="border-b border-line/30 hover:bg-panel-2/30">
                    <td className="px-2 py-0.5 text-amber">{hex4(addr)}</td>
                    <td className="px-2 py-0.5 text-ink-dim">
                      {bytes.map(hex2).join(" ")}
                    </td>
                    <td className="px-2 py-0.5 text-ink-dim">{ascii}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </CollapsibleSection>
  );
}

export function StackPanels({ machine }: { machine: Machine | null }) {
  const dataStack = machine?.dataStack ?? [];
  const callStack = machine?.callStack ?? [];

  return (
    <>
      <CollapsibleSection title="Stack (PUSH values)" storageKey="stack-values">
      <div className="max-h-24 overflow-auto border-b border-line">
        {dataStack.length === 0 ? (
          <p className="px-3.5 py-3 text-xs text-ink-dim">Empty.</p>
        ) : (
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr className="text-[10px] text-ink-dim uppercase">
                <th className="px-2.5 py-1 text-left">Offset</th>
                <th className="px-2.5 py-1 text-left">Hex</th>
                <th className="px-2.5 py-1 text-left">Dec</th>
              </tr>
            </thead>
            <tbody>
              {[...dataStack].reverse().map((v, i) => (
                <tr key={i} className="border-b border-line/30">
                  <td className="px-2.5 py-1">SP+{i * 2}</td>
                  <td className="px-2.5 py-1">{hex4(v)}</td>
                  <td className="px-2.5 py-1">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </CollapsibleSection>
      <CollapsibleSection title="Call stack" storageKey="stack-calls">
      <div className="max-h-20 overflow-auto border-b border-line">
        {callStack.length === 0 ? (
          <p className="px-3.5 py-3 text-xs text-ink-dim">No active calls.</p>
        ) : (
          <ul className="px-3.5 py-2 font-mono text-xs text-ink">
            {[...callStack].reverse().map((ip, i) => (
              <li key={i} className="py-0.5">
                return → instr #{ip}
              </li>
            ))}
          </ul>
        )}
      </div>
      </CollapsibleSection>
    </>
  );
}
