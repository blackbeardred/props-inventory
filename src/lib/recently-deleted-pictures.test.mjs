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
  globalThis.__storage = { uploaded: [], removed: [], copied: [] };
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
globalThis.__storage = { uploaded: [], removed: [], copied: [] };
const old = await trashItem(client, "it7");
delete DB.deleted_records.find((r) => r.id === old.recordId).snapshot.references;
const oldRestore = await restoreRecord(client, old.recordId);
is("restores without them", oldRestore.ok, true);
is("…and adds nothing", DB.item_reference_photos.length, 0);

console.log("");
console.log("── Deleting a duplicate: its photos go to the twin");
withPictures();
// The tankard's own photo has a current fingerprint.
DB.item_photo_embeddings = [{ item_id: "it21", org_id: "org1", photo_url: "p21.jpg", model: "clip-vit-base-patch32", embedding: "[0.6,0.8]" }];
const dup = await trashItem(client, "it21", { twinId: "it7" });
is("the delete goes through", dup.ok, true);
is("its extra pictures now belong to the twin", DB.item_reference_photos.filter((r) => ["ref1", "ref2"].includes(r.id)).map((r) => r.item_id), ["it7", "it7"]);
const copied = DB.item_reference_photos.find((r) => r.source === "duplicate");
is("its own photo is copied in as one more", globalThis.__storage.copied.map(([from]) => from), ["p21.jpg"]);
is("…into the twin's folder", /^org1\/it7\/ref-[0-9a-f-]+\.jpg$/.test(copied?.photo_path ?? ""), true);
is("…as a picture of the twin, marked as from a duplicate", [copied?.item_id, copied?.source, copied?.similarity], ["it7", "duplicate", null]);
is("…with the fingerprint it already had", copied?.embedding, "[0.6,0.8]");
is("…and who did it", copied?.created_by, "u1");
is("the twin now has all its pictures: 1 before, 3 more", DB.item_reference_photos.filter((r) => r.item_id === "it7").length, 4);
const dupRecord = DB.deleted_records.find((r) => r.id === dup.recordId);
is("Recently Deleted says whose duplicate it was", dupRecord.detail.endsWith("· a duplicate of Chalice, pewter"), true);
is("…and the snapshot remembers the twin", dupRecord.snapshot.twin, { id: "it7", name: "Chalice, pewter" });

console.log("");
console.log("── Restoring the duplicate");
const back = await restoreRecord(client, dup.recordId);
is("it comes back", back.ok && DB.items.some((i) => i.id === "it21"), true);
is("its photos stay with the twin", DB.item_reference_photos.filter((r) => r.item_id === "it7").length, 4);
is("…and it says so", back.notes.some((n) => n.includes("Its photos stay with Chalice, pewter")), true);
is("it still has its own main photo", DB.items.find((i) => i.id === "it21").photo_url, "p21.jpg");

console.log("");
console.log("── Clearing the duplicate's snapshot keeps the twin's pictures");
withPictures();
const dup2 = await trashItem(client, "it21", { twinId: "it7" });
await deleteForever(client, dup2.recordId);
is("only the duplicate's own photo goes (the twin has its own copy)", removed(), ["p21.jpg"]);
is("the twin keeps every picture", DB.item_reference_photos.filter((r) => r.item_id === "it7").length, 4);

console.log("");
console.log("── A stale fingerprint isn't passed on");
withPictures();
DB.item_photo_embeddings = [{ item_id: "it21", org_id: "org1", photo_url: "old-photo.jpg", model: "clip-vit-base-patch32", embedding: "[1,0]" }];
await trashItem(client, "it21", { twinId: "it7" });
is("the copied photo waits to be fingerprinted", DB.item_reference_photos.find((r) => r.source === "duplicate").embedding, null);

console.log("");
console.log("── A duplicate with no photos at all");
withPictures();
DB.items.find((i) => i.id === "it4").photo_url = null;
const bare = await trashItem(client, "it4", { twinId: "it7" });
is("deletes as usual", bare.ok, true);
is("nothing is copied or added", [globalThis.__storage.copied.length, DB.item_reference_photos.length], [0, 3]);

console.log("");
console.log("── Refusals, with nothing deleted or moved");
withPictures();
const self = await trashItem(client, "it21", { twinId: "it21" });
is("an item can't be its own twin", self.ok, false);
const gone = await trashItem(client, "it21", { twinId: "no-such-item" });
is("a twin that isn't there", gone.ok, false);
is("…the item is still there", DB.items.some((i) => i.id === "it21"), true);
is("…its pictures are where they were", DB.item_reference_photos.filter((r) => r.item_id === "it21").length, 2);
is("…and nothing went into Recently Deleted", DB.deleted_records.length, 0);

console.log("");
console.log("── If the copy fails, everything is put back");
withPictures();
const failingClient = {
  ...client,
  storage: { from: () => ({ ...storageFrom(), copy: async () => ({ data: null, error: { message: "storage is down" } }) }) },
};
const failed = await trashItem(failingClient, "it21", { twinId: "it7" });
is("the delete is refused", failed.ok, false);
is("…saying why", failed.ok ? "" : failed.message.includes("storage is down"), true);
is("…the item is still there", DB.items.some((i) => i.id === "it21"), true);
is("…its pictures were moved back", DB.item_reference_photos.filter((r) => r.item_id === "it21").map((r) => r.id), ["ref1", "ref2"]);
is("…and no snapshot is left behind", DB.deleted_records.length, 0);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
