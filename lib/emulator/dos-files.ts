/**
 * In-memory DOS file system for the file services of INT 21h.
 *
 * Classroom programs that call AH=3Ch and friends need somewhere for the bytes
 * to go, and somewhere for them to come back from. The files live for the life
 * of the machine, exactly as a real file lives for the life of a session, and
 * nothing reaches the host: the emulator has no filesystem of its own.
 */

/** The DOS error codes these services return. */
export const DOS_ERROR = {
  fileNotFound: 2,
  pathNotFound: 3,
  tooManyOpenFiles: 4,
  accessDenied: 5,
  invalidHandle: 6,
} as const;

interface DosFile {
  /** Upper-cased 8.3 name, which is how DOS compares two names. */
  name: string;
  data: Uint8Array;
  /** How many handles are open on it, which is what blocks a delete. */
  openCount: number;
}

interface OpenFile {
  readonly entry: DosFile;
  readonly handle: number;
  /** Read/write cursor, moved by AH=42h. */
  pos: number;
  /** What the program said it wanted when it opened the file. */
  mode: DosFileMode;
}

/** The three access modes of AH=3Bh and AH=3Dh. */
export type DosFileMode = "read" | "write" | "readwrite";

export type DosResult<T> = { ok: true; value: T } | { ok: false; code: number };

export class DosFiles {
  /** Handles 0 to 2 are the standard devices; files start at 5. */
  private static readonly FIRST_HANDLE = 5;
  private static readonly MAX_HANDLES = 32;

  private byName = new Map<string, DosFile>();
  private byHandle = new Map<number, OpenFile>();
  private nextHandle = DosFiles.FIRST_HANDLE;

  create(name: string): DosResult<number> {
    const key = DosFiles.normalise(name);
    if (key === null) return { ok: false, code: DOS_ERROR.pathNotFound };
    const existing = this.byName.get(key);
    // Create truncates, and refuses a file that is already open.
    if (existing && existing.openCount > 0) {
      return { ok: false, code: DOS_ERROR.accessDenied };
    }
    if (!existing && this.byName.size >= DosFiles.MAX_HANDLES) {
      return { ok: false, code: DOS_ERROR.tooManyOpenFiles };
    }
    const entry: DosFile = existing ?? { name: key, data: new Uint8Array(0), openCount: 0 };
    entry.data = new Uint8Array(0);
    if (!existing) this.byName.set(key, entry);
    return this.attach(entry, "readwrite");
  }

  open(name: string, mode: DosFileMode = "readwrite"): DosResult<number> {
    const key = DosFiles.normalise(name);
    if (key === null) return { ok: false, code: DOS_ERROR.pathNotFound };
    const entry = this.byName.get(key);
    if (!entry) return { ok: false, code: DOS_ERROR.fileNotFound };
    return this.attach(entry, mode);
  }

  /** Every open gets a handle of its own, with a cursor of its own. */
  private attach(entry: DosFile, mode: DosFileMode): DosResult<number> {
    if (this.byHandle.size >= DosFiles.MAX_HANDLES) {
      return { ok: false, code: DOS_ERROR.tooManyOpenFiles };
    }
    const handle = this.nextHandle++;
    this.byHandle.set(handle, { entry, handle, pos: 0, mode });
    entry.openCount += 1;
    return { ok: true, value: handle };
  }

  close(handle: number): DosResult<true> {
    const open = this.byHandle.get(handle);
    if (!open) return { ok: false, code: DOS_ERROR.invalidHandle };
    open.entry.openCount -= 1;
    this.byHandle.delete(handle);
    return { ok: true, value: true };
  }

  remove(name: string): DosResult<true> {
    const key = DosFiles.normalise(name);
    if (key === null) return { ok: false, code: DOS_ERROR.pathNotFound };
    const entry = this.byName.get(key);
    if (!entry) return { ok: false, code: DOS_ERROR.fileNotFound };
    if (entry.openCount > 0) return { ok: false, code: DOS_ERROR.accessDenied };
    this.byName.delete(key);
    return { ok: true, value: true };
  }

  /** `method`: 0 from the start, 1 from the current position, 2 from the end. */
  seek(handle: number, method: 0 | 1 | 2, offset: number): number | null {
    const open = this.byHandle.get(handle);
    if (!open) return null;
    const size = open.entry.data.length;
    const base = method === 2 ? size : method === 1 ? open.pos : 0;
    open.pos = Math.max(0, base + offset);
    return open.pos;
  }

  tell(handle: number): number | null {
    const open = this.byHandle.get(handle);
    return open ? open.pos : null;
  }

  write(handle: number, bytes: Uint8Array): DosResult<number> {
    const open = this.byHandle.get(handle);
    if (!open) return { ok: false, code: DOS_ERROR.invalidHandle };
    // A file opened for reading refuses to be written, as DOS does.
    if (open.mode === "read") return { ok: false, code: DOS_ERROR.accessDenied };
    const data = open.entry.data;
    const end = open.pos + bytes.length;
    if (end > data.length) {
      const grown = new Uint8Array(end);
      grown.set(data);
      open.entry.data = grown;
    }
    open.entry.data.set(bytes, open.pos);
    open.pos = end;
    return { ok: true, value: bytes.length };
  }

  read(handle: number, out: Uint8Array, count: number): DosResult<number> {
    const open = this.byHandle.get(handle);
    if (!open) return { ok: false, code: DOS_ERROR.invalidHandle };
    if (open.mode === "write") return { ok: false, code: DOS_ERROR.accessDenied };
    const data = open.entry.data;
    const n = Math.max(0, Math.min(count, data.length - open.pos));
    out.set(data.subarray(open.pos, open.pos + n), 0);
    open.pos += n;
    return { ok: true, value: n };
  }

  /** Size in bytes, for programs that ask before they read. */
  size(handle: number): number | null {
    const open = this.byHandle.get(handle);
    return open ? open.entry.data.length : null;
  }

  exists(name: string): boolean {
    const key = DosFiles.normalise(name);
    return key !== null && this.byName.has(key);
  }

  /**
   * A DOS name: at most eight characters, a dot, at most three more, with no
   * path. Anything else is a path this emulator does not have.
   */
  private static normalise(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.includes("\\") || trimmed.includes("/")) return null;
    const dot = trimmed.indexOf(".");
    const base = dot === -1 ? trimmed : trimmed.slice(0, dot);
    const ext = dot === -1 ? "" : trimmed.slice(dot + 1);
    if (base.length === 0 || base.length > 8 || ext.length > 3) return null;
    const legal = /^[A-Za-z0-9_~!@#$%^&(){}[\]-]+$/;
    if (!legal.test(base)) return null;
    if (ext !== "" && !legal.test(ext)) return null;
    return `${base.toUpperCase()}.${ext.toUpperCase()}`;
  }
}

/**
 * Read an 8.3 name out of memory. DOS programs end it with a null byte, and
 * some with a dollar sign, so both stop the scan.
 */
export function readDosName(mem: Uint8Array, addr: number): string {
  let name = "";
  for (let i = 0; i < 64; i++) {
    const byte = mem[(addr + i) & 0xffff]!;
    if (byte === 0 || byte === 36) break;
    name += String.fromCharCode(byte);
  }
  return name;
}
