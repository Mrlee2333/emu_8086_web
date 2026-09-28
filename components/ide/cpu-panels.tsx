"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Machine } from "@/lib/emulator/machine";
import type { Registers } from "@/lib/emulator/types";
import { hex4 } from "@/lib/emulator";
import { flagsToWord } from "@/lib/emulator/flags";
import {
  describeRegisters,
  instructionNote,
  type RegView,
} from "@/lib/ide/reg-info";
import { CollapsibleSection } from "@/components/ide/collapsible-section";
import { DialogShell } from "@/components/ide/dialog-shell";
import { IconCopy } from "@/components/ide/editor-icons";

interface ConsolePanelProps {
  machine: Machine | null;
  waitingForInput: boolean;
  onInput: (char: string) => void;
  onCopy: () => void;
  theme?: "dark" | "light";
}

function sendConsoleKeys(
  e: KeyboardEvent,
  onInput: (chars: string) => void,
): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") {
    e.preventDefault();
    onInput("\r");
    return;
  }
  if (e.key === "Backspace") {
    e.preventDefault();
    onInput("\b");
    return;
  }
  if (e.key.length === 1) {
    e.preventDefault();
    onInput(e.key);
  }
}

export function ConsolePanel({
  machine,
  waitingForInput,
  onInput,
  onCopy,
  theme = "dark",
}: ConsolePanelProps) {
  const crtRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const output = machine?.output ?? "";

  useEffect(() => {
    if (crtRef.current) {
      crtRef.current.scrollTop = crtRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    if (waitingForInput) {
      inputRef.current?.focus();
    }
  }, [waitingForInput]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="paneltitle flex items-center justify-between">
        <span>Console output</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10px] text-ink-dim hover:text-amber"
          onClick={onCopy}
          title="Copy console output"
        >
          <IconCopy className="h-3 w-3" />
          Copy
        </button>
      </div>
      <div className="crt-shell relative mx-2 mt-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--console-border)] bg-[var(--console-bg)] sm:mx-3.5 sm:mt-3 sm:mb-3.5">
        <div
          ref={crtRef}
          className="crt h-full min-h-[100px] overflow-y-auto px-3 py-2.5 font-[family-name:var(--font-vt323)] text-[18px] leading-tight whitespace-pre-wrap text-[var(--console-fg)] sm:px-3.5 sm:py-3 sm:text-[19px]"
          style={{ textShadow: "var(--console-text-shadow)" }}
          tabIndex={waitingForInput ? 0 : -1}
          onKeyDown={(e) => {
            if (!waitingForInput) return;
            sendConsoleKeys(e, onInput);
          }}
        >
          {output || (
            <span className="text-[var(--console-fg)] opacity-40">Ready.</span>
          )}
          <span className="crt-cursor" />
        </div>
        {theme === "dark" ? (
          <div className="scanlines absolute inset-0 rounded-md" />
        ) : null}
      </div>
      {waitingForInput && (
        <div className="mx-2 mb-2 sm:mx-3.5 sm:mb-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-dim" htmlFor="dos-keyboard">
              Keyboard
            </label>
            <input
              id="dos-keyboard"
              ref={inputRef}
              type="text"
              autoComplete="off"
              className="flex-1 rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-amber"
              placeholder="Type digits, then Enter"
              autoFocus
              onKeyDown={(e) => {
                sendConsoleKeys(e, onInput);
                (e.target as HTMLInputElement).value = "";
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text");
                if (text) onInput(text);
              }}
            />
          </div>
          <p className="mt-1 text-[10px] text-ink-dim">
            Enter sends CR (0Dh) — your program prints its own newline.
          </p>
        </div>
      )}
    </div>
  );
}

interface RegisterPanelProps {
  machine: Machine | null;
}

const EMPTY_REGS: Registers = {
  ax: 0,
  bx: 0,
  cx: 0,
  dx: 0,
  si: 0,
  di: 0,
  bp: 0,
  sp: 0,
  ds: 0,
  es: 0,
  ss: 0,
  cs: 0,
};

/** What the strip under the grid is showing. */
type RegDetail = { name: string; show: "info" | "value" } | null;

/**
 * How a cell sizes its value. The general registers are the ones a program
 * reads most and are set larger; segments and IP are supporting detail.
 */
type RegTone = "gp" | "seg";

/**
 * One register cell: name, hex, an `i` that explains the register, and the
 * value itself, which opens its binary and decimal reading.
 *
 * The panel stays hex-only by default because that is what a program is written
 * in; the two buttons are the only way into the rest, so nothing is on screen
 * that a beginner does not need yet.
 */
function RegCell({
  view,
  active,
  onInfo,
  onValue,
  tone,
}: {
  view: RegView;
  active: RegDetail;
  onInfo: () => void;
  onValue: () => void;
  tone: RegTone;
}) {
  const isInfo = active?.name === view.name && active.show === "info";
  const isValue = active?.name === view.name && active.show === "value";
  return (
    <div className="bg-panel px-2.5 py-2">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] tracking-wider text-ink-dim uppercase">
          {view.name}
        </span>
        <button
          type="button"
          onClick={onInfo}
          aria-pressed={isInfo}
          title={`What ${view.name} is for`}
          aria-label={`What ${view.name} is for`}
          className={`font-mono text-[11px] leading-none hover:text-amber ${
            isInfo ? "text-amber" : "text-ink-dim/60"
          }`}
        >
          i
        </button>
      </div>
      <button
        type="button"
        onClick={onValue}
        title={`${view.name} in binary and decimal`}
        className={`mt-0.5 block w-full text-left font-mono font-semibold hover:text-amber ${
          tone === "gp" ? "text-base text-green" : "text-sm text-ink"
        } ${isValue ? "text-amber" : ""}`}
      >
        {view.hex}
      </button>
    </div>
  );
}

/** The one row under the grid: a register's purpose, or its other readings. */
function RegStrip({
  view,
  show,
  onClose,
}: {
  view: RegView;
  show: "info" | "value";
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-line bg-panel-2/50 px-3 py-2">
      <div className="min-w-0 flex-1 text-[11px] leading-snug">
        <b className="font-mono text-ink">{view.name}</b>
        {show === "info" ? (
          <span className="text-ink-dim"> — {view.purpose}</span>
        ) : (
          <span className="text-ink-dim">
            {" "}
            · {view.dec}
            {view.signed < 0 ? ` (${view.signed} signed)` : ""} · {view.binary}
          </span>
        )}
        {show === "value" && view.high && view.low ? (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-ink-dim">
            <span>
              {view.high.name} 0x{view.high.hex} ({view.high.dec}
              {view.high.signed < 0 ? `/${view.high.signed}` : ""}
              {view.high.printable ? ` ${view.high.printable}` : ""}){" "}
              {view.high.binary}
            </span>
            <span>
              {view.low.name} 0x{view.low.hex} ({view.low.dec}
              {view.low.signed < 0 ? `/${view.low.signed}` : ""}
              {view.low.printable ? ` ${view.low.printable}` : ""}){" "}
              {view.low.binary}
            </span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${view.name} details`}
        title="Close"
        className="shrink-0 font-mono text-sm leading-none text-ink-dim hover:text-amber"
      >
        ×
      </button>
    </div>
  );
}

/**
 * The Details dialog of the CPU registers panel (v1.5.1).
 *
 * The table is the original emu8086 register view: a row per register, the
 * high byte and low byte in their own columns, and a dash where a register has
 * neither. It answers "what is in this register" at a glance, which is why the
 * per-register descriptions live behind the `i` buttons in the panel instead.
 */
function RegisterDetails({ machine }: RegisterPanelProps) {
  const views = describeRegisters(machine?.reg ?? EMPTY_REGS, machine?.ip ?? 0);
  const curInstr =
    machine && !machine.halted && machine.a.instrs[machine.ip]
      ? machine.a.instrs[machine.ip]
      : null;
  const note = curInstr ? instructionNote(curInstr.op) : null;

  return (
    <div>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,2fr)] gap-x-3 border-b border-line pb-1.5 text-[10px] tracking-wider text-ink-dim uppercase">
        <span>Reg</span>
        <span>H</span>
        <span>L</span>
        <span className="text-right">Value</span>
      </div>
      {views.map((v) => (
        <div
          key={v.name}
          className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,2fr)] items-baseline gap-x-3 border-b border-line/50 py-1 last:border-b-0"
        >
          <span className="font-mono text-sm font-semibold text-ink">
            {v.name}
          </span>
          <span className="font-mono text-sm text-green">
            {v.high ? v.high.hex : "—"}
          </span>
          <span className="font-mono text-sm text-green">
            {v.low ? v.low.hex : "—"}
          </span>
          <span className="text-right font-mono text-xs text-ink-dim">
            {v.hex} · {v.dec}
          </span>
        </div>
      ))}
      {curInstr ? (
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-snug text-ink-dim">
          <b className="text-amber">
            Next: {curInstr.op.toUpperCase()}
            {curInstr.args.length
              ? ` ${curInstr.args.join(", ").toUpperCase()}`
              : ""}
          </b>
          {note ? ` — ${note}.` : " — its operands name everything it touches."}
        </p>
      ) : null}
    </div>
  );
}

export function RegisterPanel({ machine }: RegisterPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detail, setDetail] = useState<RegDetail>(null);
  const views = describeRegisters(machine?.reg ?? EMPTY_REGS, machine?.ip ?? 0);
  // A miss here means a name below has drifted from `describeRegisters`, which
  // is a bug in this file rather than a runtime state. Saying so beats a `!`
  // that throws somewhere further down with no useful context.
  const byName = (n: string) => {
    const v = views.find((x) => x.name === n);
    if (!v) throw new Error(`reg-info: no register named "${n}"`);
    return v;
  };
  const gp = ["AX", "BX", "CX", "DX", "SI", "DI", "BP", "SP"] as const;
  const seg = ["DS", "ES", "SS", "CS", "IP"] as const;

  const toggle = (name: string, show: "info" | "value") =>
    setDetail((d) =>
      d?.name === name && d.show === show ? null : { name, show },
    );

  return (
    <>
      <CollapsibleSection
        title="CPU registers"
        storageKey="cpu-registers"
        action={
          <button
            type="button"
            className="text-[10px] text-ink-dim hover:text-amber"
            onClick={() => setDetailsOpen(true)}
            title="Every register with its high and low byte"
          >
            Details
          </button>
        }
      >
        <div className="grid grid-cols-4 gap-px bg-line">
          {gp.map((name) => (
            <RegCell
              key={name}
              view={byName(name)}
              tone="gp"
              active={detail}
              onInfo={() => toggle(name, "info")}
              onValue={() => toggle(name, "value")}
            />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-px border-b border-line bg-line">
          {seg.map((name) => (
            <RegCell
              key={name}
              view={byName(name)}
              tone="seg"
              active={detail}
              onInfo={() => toggle(name, "info")}
              onValue={() => toggle(name, "value")}
            />
          ))}
        </div>
        {detail ? (
          <RegStrip
            view={byName(detail.name)}
            show={detail.show}
            onClose={() => setDetail(null)}
          />
        ) : null}
      </CollapsibleSection>

      {detailsOpen && (
        <DialogShell
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="CPU registers"
          subtitle="Every register with the high and low byte it is made of."
          panelClassName="max-w-md"
        >
          <RegisterDetails machine={machine} />
        </DialogShell>
      )}
    </>
  );
}

const FLAG_MEANINGS: Record<
  "CF" | "PF" | "AF" | "ZF" | "SF" | "TF" | "IF" | "DF" | "OF",
  string
> = {
  CF: "Carry",
  PF: "Parity",
  AF: "Auxiliary carry",
  ZF: "Zero",
  SF: "Sign",
  TF: "Trap",
  IF: "Interrupt enable",
  DF: "Direction",
  OF: "Overflow",
};

export function FlagsPanel({ machine }: RegisterPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const f = machine?.flags ?? {
    CF: 0,
    PF: 0,
    AF: 0,
    ZF: 0,
    SF: 0,
    TF: 0,
    IF: 1,
    DF: 0,
    OF: 0,
  };
  const names = ["CF", "PF", "AF", "ZF", "SF", "TF", "IF", "DF", "OF"] as const;
  const word = flagsToWord(f);

  return (
    <>
      <CollapsibleSection
        title="Flags register"
        storageKey="cpu-flags"
        action={
          <button
            type="button"
            className="text-[10px] text-ink-dim hover:text-amber"
            onClick={() => setDetailsOpen(true)}
            title="Flag meanings and FLAGS word"
          >
            Details
          </button>
        }
      >
        <div className="flex flex-wrap gap-2.5 border-b border-line bg-panel px-3.5 py-2.5">
          {names.map((n) => (
            <div
              key={n}
              className={`flex items-center gap-1.5 text-[11.5px] ${f[n] ? "text-ink" : "text-ink-dim"}`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full border"
                style={{
                  background: f[n] ? "var(--led-on)" : "var(--led-off)",
                  borderColor: f[n] ? "var(--led-on)" : "var(--line)",
                  boxShadow: f[n] ? "0 0 6px var(--led-on)" : "none",
                }}
              />
              {n}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {detailsOpen && (
        <DialogShell
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="Flags register"
          panelClassName="max-w-md"
        >
          <p className="font-mono text-xs text-ink-dim">
            FLAGS = {hex4(word)} ·{" "}
            {word
              .toString(2)
              .padStart(16, "0")
              .replace(/(.{4})/g, "$1 ")
              .trim()}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {names.map((n) => (
              <div
                key={n}
                className={`flex items-center justify-between gap-2 rounded border px-3 py-2 ${
                  f[n]
                    ? "border-[var(--led-on)]/50 bg-[var(--led-on)]/10"
                    : "border-line bg-panel-2/40"
                }`}
              >
                <div>
                  <div className="font-mono text-sm font-semibold text-ink">
                    {n}
                  </div>
                  <div className="text-[11px] text-ink-dim">
                    {FLAG_MEANINGS[n]}
                  </div>
                </div>
                <span
                  className={`font-mono text-lg font-bold ${
                    f[n] ? "text-green" : "text-ink-dim"
                  }`}
                >
                  {f[n]}
                </span>
              </div>
            ))}
          </div>
        </DialogShell>
      )}
    </>
  );
}

export function StatusLine({ machine }: RegisterPanelProps) {
  const curInstr =
    machine && !machine.halted && machine.a.instrs[machine.ip]
      ? machine.a.instrs[machine.ip]
      : null;

  return (
    <CollapsibleSection title="Status" storageKey="cpu-status">
      <div className="flex gap-4 border-b border-line bg-panel px-3.5 py-2 text-xs text-ink-dim">
        <span>
          Current line →{" "}
          <b className="text-amber">
            {curInstr
              ? `line ${curInstr.ln} — ${curInstr.op.toUpperCase()}`
              : "halted"}
          </b>
        </span>
        <span>
          Instructions executed:{" "}
          <b className="text-amber">{machine?.steps ?? 0}</b>
        </span>
      </div>
    </CollapsibleSection>
  );
}
