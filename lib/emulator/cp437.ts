/**
 * IBM PC Code Page 437 (OEM-US) — glyphs + control-char metadata.
 * Matches classic DOS / emu8086 character map (00h–FFh).
 */

/** Unicode glyphs for bytes 0–255 (CP437). */
export const CP437_CHARS: readonly string[] = Object.freeze([
  "\u0000",
  "☺",
  "☻",
  "♥",
  "♦",
  "♣",
  "♠",
  "•",
  "◘",
  "○",
  "◙",
  "♂",
  "♀",
  "♪",
  "♫",
  "☼",
  "►",
  "◄",
  "↕",
  "‼",
  "¶",
  "§",
  "▬",
  "↨",
  "↑",
  "↓",
  "→",
  "←",
  "∟",
  "↔",
  "▲",
  "▼",
  " ",
  "!",
  '"',
  "#",
  "$",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "[",
  "\\",
  "]",
  "^",
  "_",
  "`",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "{",
  "|",
  "}",
  "~",
  "⌂",
  "Ç",
  "ü",
  "é",
  "â",
  "ä",
  "à",
  "å",
  "ç",
  "ê",
  "ë",
  "è",
  "ï",
  "î",
  "ì",
  "Ä",
  "Å",
  "É",
  "æ",
  "Æ",
  "ô",
  "ö",
  "ò",
  "û",
  "ù",
  "ÿ",
  "Ö",
  "Ü",
  "¢",
  "£",
  "¥",
  "₧",
  "ƒ",
  "á",
  "í",
  "ó",
  "ú",
  "ñ",
  "Ñ",
  "ª",
  "º",
  "¿",
  "⌐",
  "¬",
  "½",
  "¼",
  "¡",
  "«",
  "»",
  "░",
  "▒",
  "▓",
  "│",
  "┤",
  "╡",
  "╢",
  "╖",
  "╕",
  "╣",
  "║",
  "╗",
  "╝",
  "╜",
  "╛",
  "┐",
  "└",
  "┴",
  "┬",
  "├",
  "─",
  "┼",
  "╞",
  "╟",
  "╚",
  "╔",
  "╩",
  "╦",
  "╠",
  "═",
  "╬",
  "╧",
  "╨",
  "╤",
  "╥",
  "╙",
  "╘",
  "╒",
  "╓",
  "╫",
  "╪",
  "┘",
  "┌",
  "█",
  "▄",
  "▌",
  "▐",
  "▀",
  "α",
  "ß",
  "Γ",
  "π",
  "Σ",
  "σ",
  "µ",
  "τ",
  "Φ",
  "Θ",
  "Ω",
  "δ",
  "∞",
  "φ",
  "ε",
  "∩",
  "≡",
  "±",
  "≥",
  "≤",
  "⌠",
  "⌡",
  "÷",
  "≈",
  "°",
  "∙",
  "·",
  "√",
  "ⁿ",
  "²",
  "■",
  "\u00A0",
]);

export type Cp437Entry = {
  code: number;
  /** Classic DOS glyph (CP437). */
  char: string;
  /** Short abbrev used in tooltips (NUL, SOH, …) or the printable char. */
  meaning: string;
  /** Expanded name when it exists (e.g. "Start of Heading"). */
  fullForm?: string;
  /**
   * Cell label in the ASCII map UI when it differs from the glyph
   * (emu8086-style: null, beep, newl, cret, spa, res…).
   */
  tableLabel?: string;
};

const CONTROL_META: Record<
  number,
  { meaning: string; fullForm: string; tableLabel?: string }
> = {
  0: { meaning: "NUL", fullForm: "Null", tableLabel: "null" },
  1: { meaning: "SOH", fullForm: "Start of Heading" },
  2: { meaning: "STX", fullForm: "Start of Text" },
  3: { meaning: "ETX", fullForm: "End of Text" },
  4: { meaning: "EOT", fullForm: "End of Transmission" },
  5: { meaning: "ENQ", fullForm: "Enquiry" },
  6: { meaning: "ACK", fullForm: "Acknowledge" },
  7: { meaning: "BEL", fullForm: "Bell", tableLabel: "beep" },
  8: { meaning: "BS", fullForm: "Backspace", tableLabel: "back" },
  9: { meaning: "HT", fullForm: "Horizontal Tab", tableLabel: "tab" },
  10: { meaning: "LF", fullForm: "Line Feed", tableLabel: "newl" },
  11: { meaning: "VT", fullForm: "Vertical Tab" },
  12: { meaning: "FF", fullForm: "Form Feed" },
  13: { meaning: "CR", fullForm: "Carriage Return", tableLabel: "cret" },
  14: { meaning: "SO", fullForm: "Shift Out" },
  15: { meaning: "SI", fullForm: "Shift In" },
  16: { meaning: "DLE", fullForm: "Data Link Escape" },
  17: { meaning: "DC1", fullForm: "Device Control 1" },
  18: { meaning: "DC2", fullForm: "Device Control 2" },
  19: { meaning: "DC3", fullForm: "Device Control 3" },
  20: { meaning: "DC4", fullForm: "Device Control 4" },
  21: { meaning: "NAK", fullForm: "Negative Acknowledge" },
  22: { meaning: "SYN", fullForm: "Synchronous Idle" },
  23: { meaning: "ETB", fullForm: "End of Transmission Block" },
  24: { meaning: "CAN", fullForm: "Cancel" },
  25: { meaning: "EM", fullForm: "End of Medium" },
  26: { meaning: "SUB", fullForm: "Substitute" },
  27: { meaning: "ESC", fullForm: "Escape" },
  28: { meaning: "FS", fullForm: "File Separator" },
  29: { meaning: "GS", fullForm: "Group Separator" },
  30: { meaning: "RS", fullForm: "Record Separator" },
  31: { meaning: "US", fullForm: "Unit Separator" },
  32: { meaning: "SPACE", fullForm: "Space", tableLabel: "spa" },
  127: { meaning: "DEL", fullForm: "Delete" },
  255: { meaning: "NBSP", fullForm: "Non-breaking space / reserved", tableLabel: "res" },
};

export function cp437Char(code: number): string {
  const c = code & 0xff;
  return CP437_CHARS[c] ?? "·";
}

export function getCp437Entry(code: number): Cp437Entry {
  const c = code & 0xff;
  const char = cp437Char(c);
  const meta = CONTROL_META[c];
  if (meta) {
    return {
      code: c,
      char: c === 0 ? "NUL" : char,
      meaning: meta.meaning,
      fullForm: meta.fullForm,
      tableLabel: meta.tableLabel,
    };
  }
  return { code: c, char, meaning: char };
}

/** All 256 entries for the ASCII codes UI. */
export function getAllCp437Entries(): Cp437Entry[] {
  return Array.from({ length: 256 }, (_, i) => getCp437Entry(i));
}

/**
 * What the ASCII map cell shows (emu8086 labels for specials, else glyph).
 */
export function cp437TableDisplay(entry: Cp437Entry): string {
  if (entry.tableLabel) return entry.tableLabel;
  if (entry.code === 0) return "NUL";
  return entry.char;
}

/**
 * Map a DOS console byte to a string for the output buffer.
 * Control actions (BEL/BS/TAB/LF/CR) stay as control chars; others → CP437 glyph.
 */
export function dosByteToPrintable(byte: number): string {
  const b = byte & 0xff;
  switch (b) {
    case 0x00:
      return "";
    case 0x07:
      return ""; // BEL — no glyph
    case 0x08:
      return "\b";
    case 0x09:
      return "\t";
    case 0x0a:
      return "\n";
    case 0x0d:
      return "\r";
    default:
      return cp437Char(b);
  }
}

export function dosBytesToPrintable(bytes: Iterable<number>): string {
  let s = "";
  for (const b of bytes) s += dosByteToPrintable(b);
  return s;
}
