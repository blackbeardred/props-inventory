// A small ZIP writer (and reader, for checking), with no dependency.
//
// For the training-set export: a few hundred photos into one download. The
// files are stored, not compressed. They're JPEGs, which deflate can't
// shrink, and leaving compression out keeps this small enough to check line
// by line. Same reasoning as the hand-written QR and .xlsx code: no library
// for something this size.
//
// Format: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local header), 4.3.12
// (central directory) and 4.3.16 (end of central directory). Names are UTF-8
// (general purpose bit 11). No ZIP64, so the whole archive must stay under
// 4 GiB and 65,535 files; makeZip refuses anything bigger rather than
// writing a broken file.

export type ZipEntry = { name: string; data: Uint8Array; date?: Date };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as ZIP uses it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what ZIP headers carry. */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const LIMIT = 0xffffffff;

/** Builds a ZIP archive of the entries, in order. Names must be unique. */
export function makeZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new Error("Too many files for one ZIP.");
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith("/") || entry.name.split("/").includes("..")) {
      throw new Error(`Not a safe name for a file in a ZIP: ${entry.name}`);
    }
    if (seen.has(entry.name)) throw new Error(`Two files called ${entry.name}.`);
    seen.add(entry.name);

    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const { time, day } = dosDateTime(entry.date ?? new Date());
    if (offset + 30 + name.length + size > LIMIT) throw new Error("Too big for one ZIP.");

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // local file header signature
    l.setUint16(4, 20, true); // version needed: 2.0
    l.setUint16(6, 0x0800, true); // flags: names are UTF-8
    l.setUint16(8, 0, true); // method: stored
    l.setUint16(10, time, true);
    l.setUint16(12, day, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true); // compressed size
    l.setUint32(22, size, true); // uncompressed size
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true); // extra field length
    local.set(name, 30);

    const record = new Uint8Array(46 + name.length);
    const c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); // central directory header signature
    c.setUint16(4, 20, true); // version made by
    c.setUint16(6, 20, true); // version needed
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, day, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    // 30 extra, 32 comment, 34 disk, 36 internal attributes: all zero.
    c.setUint32(38, 0, true); // external attributes
    c.setUint32(42, offset, true); // where its local header starts
    record.set(name, 46);

    parts.push(local, entry.data);
    central.push(record);
    offset += local.length + size;
  }

  const centralSize = central.reduce((total, record) => total + record.length, 0);
  if (offset + centralSize + 22 > LIMIT) throw new Error("Too big for one ZIP.");
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); // end of central directory signature
  e.setUint16(8, entries.length, true); // entries on this disk
  e.setUint16(10, entries.length, true); // entries in total
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true); // where the central directory starts

  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Reads back a stored (uncompressed) ZIP, checking every CRC. For tests, and
 * for any archive makeZip wrote; it doesn't do deflate.
 */
export function readZip(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let endAt = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new Error("Not a ZIP: no end of central directory.");
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const decoder = new TextDecoder();
  const out: { name: string; data: Uint8Array }[] = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Broken central directory.");
    if (view.getUint16(at + 10, true) !== 0) throw new Error("Only stored files can be read here.");
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`Broken local header for ${name}.`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}.`);
    out.push({ name, data });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}
