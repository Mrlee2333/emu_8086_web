/**
 * Store-only ZIP writer tests (v1.4.0 project export).
 * Run: bun test lib
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, createZip, sanitizeZipPath } from "./zip";

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

describe("zip", () => {
  it("sanitizes archive paths", () => {
    assert.equal(sanitizeZipPath("../../evil.asm"), "evil.asm");
    assert.equal(sanitizeZipPath("C:\\proj\\main.asm"), "proj/main.asm");
    assert.equal(sanitizeZipPath("a//b/./main.asm"), "a/b/main.asm");
  });

  it("writes local headers, central directory, and EOCD", () => {
    const bytes = createZip([
      { name: "project/main.asm", content: "mov ax, 1\n" },
      { name: "project/sort.asm", content: "; sort\n" },
    ]);
    const view = new DataView(bytes.buffer);
    // First local file header magic.
    assert.equal(u32(view, 0), 0x04034b50);
    // Filenames embedded.
    const text = new TextDecoder().decode(bytes);
    assert.ok(text.includes("project/main.asm"));
    assert.ok(text.includes("project/sort.asm"));
    assert.ok(text.includes("mov ax, 1"));
    // EOCD magic at the tail with 2 entries.
    const eocd = bytes.length - 22;
    assert.equal(u32(view, eocd), 0x06054b50);
    assert.equal(view.getUint16(eocd + 8, true), 2);
    assert.equal(view.getUint16(eocd + 10, true), 2);
  });

  it("round-trips data with valid CRCs", () => {
    const files = [
      { name: "a.asm", content: "hello 8086" },
      { name: "b.asm", content: "second file\nline two\n" },
    ];
    const bytes = createZip(files);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    for (const f of files) {
      assert.equal(u32(view, offset), 0x04034b50);
      const nameLen = view.getUint16(offset + 26, true);
      const size = view.getUint32(offset + 18, true);
      const storedCrc = view.getUint32(offset + 14, true);
      const data = bytes.slice(offset + 30 + nameLen, offset + 30 + nameLen + size);
      assert.equal(new TextDecoder().decode(data), f.content);
      assert.equal(crc32(data), storedCrc);
      offset += 30 + nameLen + size;
    }
  });

  it("rejects payloads over the cap", () => {
    assert.throws(() =>
      createZip([
        { name: "big.asm", content: new Uint8Array(10 * 1024 * 1024 + 1) },
      ]),
    );
  });
});
