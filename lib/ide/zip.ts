/**
 * Minimal store-only ZIP writer (v1.4.0 project export).
 * No dependencies: DEFLATE would need a compressor, but classroom .asm
 * projects are kilobytes — stored entries keep this dependency-free and
 * unit testable. Filenames are UTF-8 (general-purpose bit 11).
 */

export type ZipEntryInput = {
  /** Posix path inside the archive (e.g. `project/main.asm`). */
  name: string;
  content: string | Uint8Array;
};

/** Largest total uncompressed payload accepted (10 MiB). */
export const MAX_ZIP_TOTAL_BYTES = 10 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed DOS timestamp so exports are byte-deterministic. */
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 23;
const DOS_TIME = (12 << 11);

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? new TextEncoder().encode(input) : input;
}

/** Sanitize an archive path (no traversal, drive letters, or backslashes). */
export function sanitizeZipPath(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== "." && p !== "..");
  if (parts.length > 0 && /^[a-zA-Z]:$/.test(parts[0])) parts.shift();
  return parts.join("/").slice(0, 256);
}

export function createZip(entries: ZipEntryInput[]): Uint8Array {
  const prepared = entries.map((e) => ({
    name: sanitizeZipPath(e.name),
    data: toBytes(e.content),
  }));
  const total = prepared.reduce((n, e) => n + e.data.length, 0);
  if (total > MAX_ZIP_TOTAL_BYTES) {
    throw new Error("Project too large to export (10 MiB cap)");
  }

  const encoder = new TextEncoder();
  const nameBytes = prepared.map((e) => encoder.encode(e.name || "untitled"));
  const localSize = prepared.reduce(
    (n, e, i) => n + 30 + nameBytes[i].length + e.data.length,
    0,
  );
  const centralSize = prepared.reduce(
    (n, _e, i) => n + 46 + nameBytes[i].length,
    0,
  );
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);

  let offset = 0;
  const centralOffsets: number[] = [];
  prepared.forEach((entry, i) => {
    const name = nameBytes[i];
    centralOffsets.push(offset);
    // Local file header.
    writeU32(view, offset, 0x04034b50);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 0x0800); // UTF-8 names
    writeU16(view, offset + 8, 0); // stored
    writeU16(view, offset + 10, DOS_TIME);
    writeU16(view, offset + 12, DOS_DATE);
    writeU32(view, offset + 14, crc32(entry.data));
    writeU32(view, offset + 18, entry.data.length);
    writeU32(view, offset + 22, entry.data.length);
    writeU16(view, offset + 26, name.length);
    writeU16(view, offset + 28, 0);
    out.set(name, offset + 30);
    out.set(entry.data, offset + 30 + name.length);
    offset += 30 + name.length + entry.data.length;
  });

  const centralStart = offset;
  prepared.forEach((entry, i) => {
    const name = nameBytes[i];
    writeU32(view, offset, 0x02014b50);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 20);
    writeU16(view, offset + 8, 0x0800);
    writeU16(view, offset + 10, 0);
    writeU16(view, offset + 12, DOS_TIME);
    writeU16(view, offset + 14, DOS_DATE);
    writeU32(view, offset + 16, crc32(entry.data));
    writeU32(view, offset + 20, entry.data.length);
    writeU32(view, offset + 24, entry.data.length);
    writeU16(view, offset + 28, name.length);
    writeU16(view, offset + 30, 0);
    writeU16(view, offset + 32, 0);
    writeU16(view, offset + 34, 0);
    writeU16(view, offset + 36, 0);
    writeU32(view, offset + 38, 0);
    writeU32(view, offset + 42, centralOffsets[i]);
    out.set(name, offset + 46);
    offset += 46 + name.length;
  });

  // End of central directory.
  writeU32(view, offset, 0x06054b50);
  writeU16(view, offset + 4, 0);
  writeU16(view, offset + 6, 0);
  writeU16(view, offset + 8, prepared.length);
  writeU16(view, offset + 10, prepared.length);
  writeU32(view, offset + 12, centralSize);
  writeU32(view, offset + 14, centralStart);
  writeU16(view, offset + 16, 0);

  return out;
}
