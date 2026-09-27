/**
 * DOS / emu8086 text console with independent CR and LF cursor motion.
 *
 * - 0Ah (LF): move down one row; column unchanged
 * - 0Dh (CR): move to column 0; row unchanged
 * - Printable: write at cursor, then advance column
 */

export class DosConsole {
  /**
   * Oldest lines are dropped past this count so a runaway print loop
   * (up to the 2M instruction limit) cannot grow memory / freeze render.
   */
  static readonly MAX_LINES = 2000;

  private lines: string[] = [""];
  private row = 0;
  private col = 0;
  /**
   * Bumped on every mutation so `text` can memoize. The CRT panel reads it on
   * each React render (~60/s while running) and joining 2,000 lines is a
   * ~160 KB allocation each time, whether or not anything was printed.
   */
  private version = 0;
  private cachedVersion = -1;
  private cachedText = "";

  /** Flat text for the CRT panel / clipboard (lines joined by `\n`). */
  get text(): string {
    if (this.version !== this.cachedVersion) {
      this.cachedText = this.lines.join("\n");
      this.cachedVersion = this.version;
    }
    return this.cachedText;
  }

  get cursorRow(): number {
    return this.row;
  }

  get cursorCol(): number {
    return this.col;
  }

  /** Move the cursor, for INT 10h AH=02h. Clamped to the screen. */
  setCursor(row: number, col: number): void {
    this.row = Math.max(0, Math.min(row, 24));
    this.ensureRow(this.row);
    this.col = Math.max(0, col);
    this.version += 1;
  }

  /** Serializable console state for step-back / time-travel restore. */
  getState(): { lines: string[]; row: number; col: number } {
    return { lines: [...this.lines], row: this.row, col: this.col };
  }

  setState(state: { lines: string[]; row: number; col: number }): void {
    this.lines = [...state.lines];
    if (this.lines.length === 0) this.lines = [""];
    this.row = Math.min(Math.max(0, state.row), this.lines.length - 1);
    this.col = Math.max(0, state.col);
    this.version += 1;
  }

  clear(): void {
    this.lines = [""];
    this.row = 0;
    this.col = 0;
    this.version += 1;
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
    if (this.lines.length <= r) {
      while (this.lines.length <= r) this.lines.push("");
      this.version += 1;
    }
    // Trim oldest rows (a print loop can emit thousands of lines).
    if (this.lines.length > DosConsole.MAX_LINES) {
      const drop = this.lines.length - DosConsole.MAX_LINES;
      this.lines.splice(0, drop);
      this.row = Math.max(0, this.row - drop);
      this.version += 1;
    }
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
    this.version += 1;
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
    this.version += 1;
  }
}
