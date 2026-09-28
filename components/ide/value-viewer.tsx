"use client";

import { useState } from "react";
import { describeValue, type ValueByte } from "@/lib/ide/value-view";
import type { RegView } from "@/lib/ide/reg-info";
import { DialogShell } from "@/components/ide/dialog-shell";

/**
 * The Extended Value Viewer (v1.5.3) — the original emu8086 window.
 *
 * The register details show a value as hex and as decimal. This goes wider, and
 * it splits by width rather than by base: the two bytes are in hex, binary and
 * octal, each read on its own as unsigned, signed and a character, and the word
 * is in hex and binary, read as unsigned and signed. Octal stops at the byte,
 * as it does in the original — that is the width it is any use at, and a
 * six-digit octal word is a number nobody computes by hand.
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
  /** Which register to open on. Read once, when the dialog mounts. */
  initial: string;
  onClose: () => void;
}) {
  // Read once, deliberately. The panel mounts this dialog only while it is open,
  // so every open is a fresh mount and the picker starts on the register that
  // was asked about. If a second entry point is ever added that can reach this
  // dialog while it is open — a keyboard shortcut, say — `initial` would change
  // under a mounted component and the picker would silently keep the old
  // register, so that path needs a `key` on this element rather than a second
  // piece of state.
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
      subtitle="The two bytes of one register, and the register itself."
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
          title="Which register to read"
          aria-label="Which register to read"
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
              cols={cols}
              high={high}
              low={low}
              rows={[
                { label: "HEX", read: (b) => b.hex, tone: "hex" },
                { label: "BIN", read: (b) => b.binary, tone: "plain" },
                { label: "OCT", read: (b) => b.octal, tone: "plain" },
              ]}
            />
            <ByteGroup
              cols={cols}
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
                { label: "Char", read: (b) => b.char, tone: "plain" },
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

/**
 * Green is the app's colour for a hex value — the compact register panel and
 * the Details table both use it — so the HEX row keeps it and nothing else
 * needs a colour of its own. An earlier cut also coloured the Char row amber;
 * that is the accent this app uses for something you can act on, and a
 * character is data, not an action. It was also the lowest-contrast cell in the
 * table (4.25:1 in the light theme, against 4.35:1 for green and 4.97:1 for
 * ink-dim), so the two mistakes were the same mistake.
 */
type Tone = "hex" | "plain";
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
 * ones; the three base columns sit directly under the H and L headings. `cols`
 * is passed in rather than assumed, so a group can never be laid out against a
 * column count the rest of the table does not have.
 */
function ByteGroup({
  cols,
  caption,
  high,
  low,
  rows,
}: {
  cols: number;
  caption?: string;
  high: ValueByte;
  low: ValueByte;
  rows: ByteRow[];
}) {
  return (
    <tbody>
      {caption ? <Caption cols={cols}>{caption}</Caption> : null}
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
  return (
    <td className={`py-1 pr-2 ${tone === "hex" ? "text-green" : "text-ink"}`}>
      {text}
    </td>
  );
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
