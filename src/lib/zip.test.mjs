// The hand-written ZIP writer, read back by its own reader and checked
// against the spec's CRC-32 check value.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/zip.test.mjs

import { crc32, makeZip, readZip } from "./zip.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}
const text = (s) => new TextEncoder().encode(s);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

console.log("── crc32");
is("the standard check value of \"123456789\"", crc32(text("123456789")).toString(16), "cbf43926");
is("nothing at all", crc32(new Uint8Array()), 0);

console.log("");
console.log("── makeZip, read back");
const photo = new Uint8Array(5000).map((_, i) => (i * 37) & 0xff);
const zip = makeZip([
  { name: "brass-candlestick/a1-photo.jpg", data: photo, date: new Date(2026, 9, 5, 14, 30, 10) },
  { name: "labels.csv", data: text("file,label\r\n") },
  { name: "chaise-longue/é-photo.jpg", data: text("x") },
  { name: "empty.txt", data: new Uint8Array() },
]);
const back = readZip(zip);
is("every file comes back, in order", back.map((f) => f.name), ["brass-candlestick/a1-photo.jpg", "labels.csv", "chaise-longue/é-photo.jpg", "empty.txt"]);
is("byte for byte", [...back[0].data].every((b, i) => b === photo[i]) && back[0].data.length === 5000, true);
is("a text file too", new TextDecoder().decode(back[1].data), "file,label\r\n");
is("an empty file is allowed", back[3].data.length, 0);
{
  const names = ["brass-candlestick/a1-photo.jpg", "labels.csv", "chaise-longue/é-photo.jpg", "empty.txt"].map((n) => text(n).length);
  const sizes = [5000, 12, 1, 0];
  const expected = names.reduce((t, n, i) => t + 30 + n + sizes[i] + 46 + n, 0) + 22;
  is("stored, so the size is the files plus their headers exactly", zip.length, expected);
}
is("starts with a local header", [...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
is("UTF-8 names are flagged", new DataView(zip.buffer).getUint16(6, true) & 0x0800, 0x0800);
{
  const view = new DataView(zip.buffer);
  const day = view.getUint16(12, true);
  const time = view.getUint16(10, true);
  is("the date is in DOS form", [(day >> 9) + 1980, (day >> 5) & 15, day & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2], [2026, 10, 5, 14, 30, 10]);
}
{
  const broken = zip.slice();
  broken[30 + "brass-candlestick/a1-photo.jpg".length + 10] ^= 0xff;
  is("a damaged file is caught by its CRC", throws(() => readZip(broken)), true);
}
is("an empty archive is valid", readZip(makeZip([])).length, 0);

console.log("");
console.log("── refusals");
is("two files with one name", throws(() => makeZip([{ name: "a", data: text("1") }, { name: "a", data: text("2") }])), true);
is("a path that climbs out", throws(() => makeZip([{ name: "../a", data: text("1") }])), true);
is("an absolute path", throws(() => makeZip([{ name: "/etc/a", data: text("1") }])), true);
is("no name", throws(() => makeZip([{ name: "", data: text("1") }])), true);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
