// An item's extra pictures (migration 008) through Recently Deleted: kept in
// the snapshot, put back on restore, and their files removed only when the
// snapshot is cleared and nothing uses them any more. Runs the real
// src/lib/recently-deleted.ts against the in-memory theatre the browser tests
// use (e2e/fixtures/db.ts), which does what the real foreign keys do on delete.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/recently-deleted-pictures.test.mjs

import { DB, query, resetFixtures, rpc, storageFrom } from "../../e2e/fixtures/db.ts";
import { deleteForever, purgeExpired, restoreRecord, trashItem } from "./recently-deleted.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

const client = {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: (table) => query(table),
  rpc,
  storage: { from: () => storageFrom() },
};
const removed = () => globalThis.__storage?.removed ?? [];

function withPictures() {
  resetFixtures();
  globalThis.__storage = { uploaded: [], removed: [] };
  // The tankard (it21) has its own photo and two confirmed extra pictures.
  DB.item_reference_photos = [
    { id: "ref1", item_id: "it21", org_id: "org1", photo_path: "org1/it21/ref-1.jpg", source: "find_by_photo", similarity: 0.84, model: "clip-vit-base-patch32", embedding: "[1,0]", created_by: "u1", created_at: "2026-10-01T10:00:00Z" },
    { id: "ref2", item_id: "it21", org_id: "org1", photo_path: "org1/it21/ref-2.jpg", source: "prop_table", similarity: null, model: "clip-vit-base-patch32", embedding: null, created_by: "u1", created_at: "2026-10-02T10:00:00Z" },
    { id: "ref3", item_id: "it7", org_id: "org1", photo_path: "org1/it7/ref-3.jpg", source: "prop_table", similarity: 0.9, model: "clip-vit-base-patch32", embedding: "[0,1]", created_by: "u1", created_at: "2026-10-02T10:00:00Z" },
  ];
}

console.log("── Deleting an item with extra pictures");
withPictures();
const trashed = await trashItem(client, "it21");
is("the delete goes through", trashed.ok, true);
is("its pictures go with it, as the foreign key does", DB.item_reference_photos.map((r) => r.id), ["ref3"]);
const record = DB.deleted_records.find((r) => r.id === trashed.recordId);
is("the snapshot holds both pictures", record.snapshot.references.map((r) => r.id), ["ref1", "ref2"]);
is("and their files are held until it's cleared", record.photo_paths, ["p21.jpg", "org1/it21/ref-1.jpg", "org1/it21/ref-2.jpg"]);
is("nothing is removed from storage at delete time", removed(), []);

console.log("");
console.log("── Restoring it");
const restored = await restoreRecord(client, trashed.recordId);
is("the restore goes through", restored.ok, true);
is("both pictures are back, with their ids", DB.item_reference_photos.map((r) => r.id).sort(), ["ref1", "ref2", "ref3"]);
is("…on the right item", DB.item_reference_photos.filter((r) => r.item_id === "it21").length, 2);
is("…fingerprint and all", DB.item_reference_photos.find((r) => r.id === "ref1").embedding, "[1,0]");
is("…and the snapshot is gone", DB.deleted_records.some((r) => r.id === trashed.recordId), false);

console.log("");
console.log("── Deleting forever");
withPictures();
const again = await trashItem(client, "it21");
await deleteForever(client, again.recordId);
is("the item's photo and both pictures' files are removed", removed().sort(), ["org1/it21/ref-1.jpg", "org1/it21/ref-2.jpg", "p21.jpg"]);
is("another item's picture is untouched", DB.item_reference_photos.map((r) => r.id), ["ref3"]);

console.log("");
console.log("── A file still in use is kept");
withPictures();
const shared = await trashItem(client, "it21");
// Something else uses one of those files now (a re-import that reused it).
DB.item_reference_photos.push({ ...DB.item_reference_photos[0], id: "ref9", item_id: "it7", photo_path: "org1/it21/ref-1.jpg" });
DB.deleted_records.find((r) => r.id === shared.recordId).deleted_at = "2026-08-01T00:00:00Z";
await purgeExpired(client, new Date("2026-10-05T00:00:00Z"));
is("the purge clears the snapshot", DB.deleted_records.some((r) => r.id === shared.recordId), false);
is("…and removes only the files nothing uses", removed().sort(), ["org1/it21/ref-2.jpg", "p21.jpg"]);

console.log("");
console.log("── A snapshot from before migration 008");
resetFixtures();
globalThis.__storage = { uploaded: [], removed: [] };
const old = await trashItem(client, "it7");
delete DB.deleted_records.find((r) => r.id === old.recordId).snapshot.references;
const oldRestore = await restoreRecord(client, old.recordId);
is("restores without them", oldRestore.ok, true);
is("…and adds nothing", DB.item_reference_photos.length, 0);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
