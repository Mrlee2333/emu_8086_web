"use client";

import { useState } from "react";
import { describeValue, type ValueByte } from "@/lib/ide/value-view";
import type { RegView } from "@/lib/ide/reg-info";
import { DialogShell } from "@/components/ide/dialog-shell";

/**
 * The Extended Value Viewer (v1.5.3) — the original emu8086 window.
 *
 * The register details show a value as hex and as decimal. This goes wider,
 * because a beginner has nowhere else to see that the byte in AH and the word
 * in AX are the same kind of number read at two widths: the same value in hex,
 * binary and octal, then each byte on its own as unsigned, signed and a
 * character, then the whole word as unsigned and signed.
 *
 * The picker is the "Watch" dropdown of the original. It is why this is a
 * dialog and not a strip — one window that can be pointed at any register,
 * rather than thirteen copies of the same table.
 */
export function ValueViewer({
  views,
  initial,
  onClose,
}: {
  /** Every register, in the 8086's own order. */
  views: RegView[];
  /** Which register to open on. */
  initial: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  // A miss here means a name has drifted from `describeRegisters`, which is a
  // bug in the caller rather than a runtime state, and saying so beats a
  // dialog that opened empty with no explanation.
  const current = views.find((v) => v.name === name);
  if (!current) throw new Error(`value-viewer: no register named "${name}"`);
  const value = describeValue(current);
  const high = value.high;
  const low = value.low;
  const halves = high !== null && low !== null;
  // Two columns without halves — the reading and the word — three with them.
  // Every colSpan below is measured against this, so a register with no halves
  // gets a table that still adds up.
  const cols = halves ? 3 : 2;

  return (
    <DialogShell
      open
      onClose={onClose}
      title="Extended value viewer"
      subtitle="One value in every base, and the two bytes it is made of."
      panelClassName="max-w-md"
    >
      <div className="flex items-center gap-2">
        <label
          htmlFor="value-viewer-watch"
          className="shrink-0 text-[10px] tracking-wider text-ink-dim uppercase"
        >
          Watch
        </label>
        <select
          id="value-viewer-watch"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-amber"
        >
          {views.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
        <span className="shrink-0 font-mono text-sm font-semibold text-green">
          {value.hex}
        </span>
      </div>

      <table className="mt-3 w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="border-b border-line text-[10px] tracking-wider text-ink-dim uppercase">
            <th scope="col" className="w-24 pb-1 font-normal">
              <span className="sr-only">Reading</span>
            </th>
            {halves ? (
              <>
                <th scope="col" className="pb-1 font-normal">
                  H — {high.name}
                </th>
                <th scope="col" className="pb-1 font-normal">
                  L — {low.name}
                </th>
              </>
            ) : (
              <th scope="col" className="pb-1 font-normal">
                {value.name}
              </th>
            )}
          </tr>
        </thead>

        {/*
          Only where the register has two halves. Six rows of dashes for SI is
          a screen of nothing, and the note under the table already says why
          the byte rows are missing.
        */}
        {high && low ? (
          <>
            <ByteGroup
              high={high}
              low={low}
              rows={[
                { label: "HEX", read: (b) => b.hex, tone: "hex" },
                { label: "BIN", read: (b) => b.binary, tone: "plain" },
                { label: "OCT", read: (b) => b.octal, tone: "plain" },
              ]}
            />
            <ByteGroup
              caption="Decimal 8 bit"
              high={high}
              low={low}
              rows={[
                {
                  label: "Unsigned",
                  read: (b) => String(b.unsigned),
                  tone: "plain",
                },
                { label: "Signed", read: (b) => String(b.signed), tone: "plain" },
                { label: "Char", read: (b) => b.char, tone: "char" },
              ]}
            />
          </>
        ) : null}

        <tbody>
          <Caption cols={cols}>Decimal 16 bit</Caption>
          <WordRow
            label="Unsigned"
            text={String(value.unsigned)}
            span={cols - 1}
          />
          <WordRow label="Signed" text={String(value.signed)} span={cols - 1} />
        </tbody>
      </table>

      <p className="mt-3 border-t border-line pt-2 text-[10px] leading-snug text-ink-dim">
        <span className="font-mono text-ink-dim/80">{value.binary}</span>
        <br />
        {halves
          ? "Char is the CP437 glyph DOS would draw, not ASCII — a byte above 7Fh is not ASCII."
          : `${value.name} is 16-bit only, so it has no high and low byte.`}
      </p>
    </DialogShell>
  );
}

type Tone = "hex" | "plain" | "char";
type ByteRow = { label: string; read: (b: ValueByte) => string; tone: Tone };

function Caption({ cols, children }: { cols: number; children: string }) {
  return (
    <tr>
      <th
        colSpan={cols}
        scope="colgroup"
        className="border-t border-line pt-2 pb-1 text-left text-[10px] font-normal tracking-wider text-ink-dim uppercase"
      >
        {children}
      </th>
    </tr>
  );
}

/**
 * One set of readings applied to both halves.
 *
 * The caption is optional because the original viewer groups only the decimal
 * ones; the three base columns sit directly under the H and L headings.
 */
function ByteGroup({
  caption,
  high,
  low,
  rows,
}: {
  caption?: string;
  high: ValueByte;
  low: ValueByte;
  rows: ByteRow[];
}) {
  return (
    <tbody>
      {caption ? <Caption cols={3}>{caption}</Caption> : null}
      {rows.map((row) => (
        <tr key={row.label} className="border-b border-line/40">
          <th
            scope="row"
            className="py-1 pr-2 text-left text-[11px] font-normal text-ink-dim"
          >
            {row.label}
          </th>
          <Cell tone={row.tone} text={row.read(high)} />
          <Cell tone={row.tone} text={row.read(low)} />
        </tr>
      ))}
    </tbody>
  );
}

function Cell({ tone, text }: { tone: Tone; text: string }) {
  const colour =
    tone === "char" ? "text-amber" : tone === "hex" ? "text-green" : "text-ink";
  return <td className={`py-1 pr-2 ${colour}`}>{text}</td>;
}

function WordRow({
  label,
  text,
  span,
}: {
  label: string;
  text: string;
  span: number;
}) {
  return (
    <tr className="border-b border-line/40">
      <th
        scope="row"
        className="py-1 pr-2 text-left text-[11px] font-normal text-ink-dim"
      >
        {label}
      </th>
      <td colSpan={span} className="py-1 font-semibold text-ink">
        {text}
      </td>
    </tr>
  );
}
