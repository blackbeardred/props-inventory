// Costumes (migration 019) through Recently Deleted: a costume deleted with
// or without its pieces, a pull list or production deleted with costumes on
// it, and a single piece whose costume has gone since. Runs the real
// src/lib/recently-deleted.ts against the in-memory theatre the browser tests
// use (e2e/fixtures/db.ts), which does what the real foreign keys do on delete.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/recently-deleted-costumes.test.mjs

import { DB, query, resetFixtures, rpc, storageFrom } from "../../e2e/fixtures/db.ts";
import {
  restoreRecord,
  trashProduction,
  trashPullList,
  trashPullListGroup,
  trashPullListItem,
} from "./recently-deleted.ts";

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

/** Noises Off!'s list (pl1) with a Margaret costume: the net and the candlestick in it. */
function withCostume() {
  resetFixtures();
  DB.pull_list_groups = [{ id: "g1", pull_list_id: "pl1", name: "Margaret costume", position: 0, created_at: "2026-11-09T00:00:00Z" }];
  for (const line of DB.pull_list_items) line.group_id = line.id === "pli3" ? null : "g1";
}
const piecesOf = (group) => DB.pull_list_items.filter((l) => l.group_id === group).map((l) => l.id).sort();

console.log("── Deleting a costume, keeping its pieces");
withCostume();
let trashed = await trashPullListGroup(client, "g1", { withPieces: false });
is("goes through", trashed.ok, true);
is("the costume is gone", DB.pull_list_groups.length, 0);
is("its pieces stay on the list, loose", DB.pull_list_items.map((l) => [l.id, l.group_id ?? null]), [["pli1", null], ["pli2", null], ["pli3", null]]);
let record = DB.deleted_records.find((r) => r.id === trashed.recordId);
is("kept as a costume", [record.kind, record.label], ["pull_list_group", "Margaret costume"]);
is("says the pieces were left", record.detail, "from Noises Off! · pieces left on the list");
let restored = await restoreRecord(client, trashed.recordId);
is("restores", restored.ok, true);
is("the costume is back", DB.pull_list_groups.map((g) => g.id), ["g1"]);
is("and its pieces are gathered back into it", piecesOf("g1"), ["pli1", "pli2"]);
is("it opens on the production, at the costume", restored.href, "/productions/prod1?open=g1#costume-g1");

console.log("── …unless a piece was moved since");
withCostume();
trashed = await trashPullListGroup(client, "g1", { withPieces: false });
DB.pull_list_groups.push({ id: "g2", pull_list_id: "pl1", name: "Harry costume", position: 1, created_at: "2026-11-09T01:00:00Z" });
DB.pull_list_items.find((l) => l.id === "pli2").group_id = "g2";
DB.pull_list_items = DB.pull_list_items.filter((l) => l.id !== "pli1");
await restoreRecord(client, trashed.recordId);
is("a piece put in another costume stays there; one taken off the list stays off", [piecesOf("g1"), piecesOf("g2")], [[], ["pli2"]]);

console.log("── Deleting a costume with its pieces");
withCostume();
trashed = await trashPullListGroup(client, "g1", { withPieces: true });
is("goes through", trashed.ok, true);
is("the costume and its pieces are gone; the rest of the list stays", DB.pull_list_items.map((l) => l.id), ["pli3"]);
record = DB.deleted_records.find((r) => r.id === trashed.recordId);
is("says how many pieces went", record.detail, "from Noises Off! · 2 pieces");
restored = await restoreRecord(client, trashed.recordId);
is("restores", restored.ok, true);
is("the pieces come back inside it", piecesOf("g1"), ["pli1", "pli2"]);

console.log("── A whole pull list with a costume on it");
withCostume();
trashed = await trashPullList(client, "pl1");
record = DB.deleted_records.find((r) => r.id === trashed.recordId);
is("the snapshot holds the costume", record.snapshot.groups.map((g) => g.name), ["Margaret costume"]);
is("everything went with the list", [DB.pull_list_groups.length, DB.pull_list_items.length], [0, 0]);
restored = await restoreRecord(client, trashed.recordId);
is("restores", restored.ok, true);
is("costume back, before its pieces, which are in it again", [DB.pull_list_groups.map((g) => g.id), piecesOf("g1")], [["g1"], ["pli1", "pli2"]]);

console.log("── A whole production");
withCostume();
trashed = await trashProduction(client, "prod1");
record = DB.deleted_records.find((r) => r.id === trashed.recordId);
is("the snapshot holds the costume", record.snapshot.groups.map((g) => g.id), ["g1"]);
restored = await restoreRecord(client, trashed.recordId);
is("restores with the costume and its pieces", [restored.ok, piecesOf("g1")], [true, ["pli1", "pli2"]]);

console.log("── An old snapshot, from before costumes");
withCostume();
trashed = await trashPullList(client, "pl1");
record = DB.deleted_records.find((r) => r.id === trashed.recordId);
delete record.snapshot.groups;
for (const line of record.snapshot.lines) delete line.group_id;
restored = await restoreRecord(client, trashed.recordId);
is("still restores, lines loose", [restored.ok, DB.pull_list_items.length, piecesOf("g1")], [true, 3, []]);

console.log("── One piece, whose costume has gone since");
withCostume();
trashed = await trashPullListItem(client, "pli1");
DB.pull_list_groups = [];
restored = await restoreRecord(client, trashed.recordId);
is("comes back loose rather than failing", [restored.ok, DB.pull_list_items.find((l) => l.id === "pli1")?.group_id ?? null], [true, null]);
is("and says so", restored.notes, ["Its costume has been deleted since, so it’s back on the list on its own."]);
withCostume();
trashed = await trashPullListItem(client, "pli1");
restored = await restoreRecord(client, trashed.recordId);
is("with its costume still there, it goes back into it, quietly", [DB.pull_list_items.find((l) => l.id === "pli1")?.group_id, restored.notes], ["g1", []]);

console.log("── A costume whose list has gone");
withCostume();
trashed = await trashPullListGroup(client, "g1", { withPieces: true });
DB.pull_lists = [];
restored = await restoreRecord(client, trashed.recordId);
is("is refused with what to restore first", restored.message, "Noises Off!’s Pull List has been deleted. Restore that first, then this costume.");

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
