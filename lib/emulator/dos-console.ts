/**
 * DOS / emu8086 text console with independent CR and LF cursor motion.
 *
 * - 0Ah (LF): move down one row; column unchanged
 * - 0Dh (CR): move to column 0; row unchanged
 * - Printable: write at cursor, then advance column
 */

export class DosConsole {
  private lines: string[] = [""];
  private row = 0;
  private col = 0;

  /** Flat text for the CRT panel / clipboard (lines joined by `\n`). */
  get text(): string {
    return this.lines.join("\n");
  }

  get cursorRow(): number {
    return this.row;
  }

  get cursorCol(): number {
    return this.col;
  }

  clear(): void {
    this.lines = [""];
    this.row = 0;
    this.col = 0;
  }

  /** Apply a string that may contain `\r`, `\n`, `\b`, `\t`, or glyphs. */
  write(str: string): void {
    for (const ch of str) {
      if (ch === "\r") {
        this.col = 0;
        continue;
      }
      if (ch === "\n") {
        this.row += 1;
        this.ensureRow(this.row);
        continue;
      }
      if (ch === "\b") {
        this.backspace();
        continue;
      }
      if (ch === "\t") {
        const next = this.col + (8 - (this.col % 8));
        while (this.col < next) this.putChar(" ");
        continue;
      }
      this.putChar(ch);
    }
  }

  private ensureRow(r: number): void {
    while (this.lines.length <= r) this.lines.push("");
  }

  private putChar(ch: string): void {
    this.ensureRow(this.row);
    let line = this.lines[this.row]!;
    if (this.col > line.length) {
      line += " ".repeat(this.col - line.length);
    }
    if (this.col < line.length) {
      line = line.slice(0, this.col) + ch + line.slice(this.col + 1);
    } else {
      line += ch;
    }
    this.lines[this.row] = line;
    this.col += 1;
  }

  private backspace(): void {
    if (this.col <= 0) return;
    this.col -= 1;
    this.ensureRow(this.row);
    const line = this.lines[this.row]!;
    if (this.col >= line.length) return;
    if (this.col === line.length - 1) {
      this.lines[this.row] = line.slice(0, -1);
    } else {
      this.lines[this.row] =
        line.slice(0, this.col) + " " + line.slice(this.col + 1);
    }
  }
}
