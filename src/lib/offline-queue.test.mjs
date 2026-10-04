// Checklist ticks made offline, waiting to be sent.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/offline-queue.test.mjs

import { dequeue, enqueue, parseQueue, pendingStates, plausibleTickTime } from "./offline-queue.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}
const t = (rowId, state, at = "2026-10-04T10:00:00.000Z") => ({ rowId, state, at });

console.log("── enqueue / dequeue");
is("adds a tick", enqueue([], t("a", "checked")), [t("a", "checked")]);
is("one entry per row: the last change wins",
  enqueue(enqueue(enqueue([], t("a", "checked", "2026-10-04T10:00:00.000Z")), t("a", "open", "2026-10-04T10:01:00.000Z")), t("a", "checked", "2026-10-04T10:02:00.000Z")),
  [t("a", "checked", "2026-10-04T10:02:00.000Z")]);
is("re-touching a row moves it to the end, keeping walk order",
  enqueue(enqueue(enqueue([], t("a", "checked")), t("b", "checked")), t("a", "cleared")).map((x) => x.rowId), ["b", "a"]);
is("dequeue removes only that row", dequeue([t("a", "checked"), t("b", "open")], "a"), [t("b", "open")]);
is("pending overlay", pendingStates([t("a", "checked"), t("b", "cleared")]), { a: "checked", b: "cleared" });

console.log("");
console.log("── parseQueue never trusts storage");
is("nothing stored", parseQueue(null), []);
is("not JSON", parseQueue("{oops"), []);
is("not a list", parseQueue('{"rowId":"a"}'), []);
is("bad entries dropped, good ones kept",
  parseQueue(JSON.stringify([t("a", "checked"), { rowId: "", state: "checked", at: "2026-10-04T10:00:00Z" }, { rowId: "b", state: "maybe", at: "2026-10-04T10:00:00Z" }, { rowId: "c", state: "open", at: "yesterday" }, null, 7, t("d", "cleared")])),
  [t("a", "checked"), t("d", "cleared")]);
is("duplicates in storage collapse to the last", parseQueue(JSON.stringify([t("a", "checked"), t("a", "open")])), [t("a", "open")]);

console.log("");
console.log("── plausibleTickTime");
const now = new Date("2026-10-04T12:00:00Z");
is("an hour ago is believed", plausibleTickTime("2026-10-04T11:00:00Z", now)?.toISOString(), "2026-10-04T11:00:00.000Z");
is("a little clock drift is allowed", plausibleTickTime("2026-10-04T12:03:00Z", now)?.toISOString(), "2026-10-04T12:03:00.000Z");
is("the future isn't", plausibleTickTime("2026-10-04T13:00:00Z", now), null);
is("over a week old isn't", plausibleTickTime("2026-09-20T12:00:00Z", now), null);
is("garbage isn't", plausibleTickTime("soon", now), null);
is("missing isn't", plausibleTickTime(undefined, now), null);

console.log("");
console.log(`════ ${pass} passed, ${fail} failed ════`);
if (fail > 0) process.exit(1);
