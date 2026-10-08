// The sample theatre the end-to-end tests run against.
//
// Only ever loaded in a fixture build (E2E_FIXTURES=1, see next.config.ts),
// where "@/lib/supabase/server" and "@/lib/supabase/client" are pointed at the
// stubs beside this file. It answers the handful of query shapes the pages
// actually use — select/eq/in/is/order/limit, single rows, the embeds they
// ask for, inserts, updates and deletes — from memory.
//
// The data lives on globalThis, so every server bundle in the process (pages,
// server actions, route handlers, the proxy) sees the same theatre, and
// POST /api/e2e/reset puts it back the way it started between tests. The
// browser gets its own copy, fresh on every page load.
const svg = (c: string, label = "") =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${c}"/><text x="100" y="110" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`)}`;

type Row = Record<string, unknown>;
const now = "2026-09-28T12:00:00Z";
const names = ["Antique Brass Broom", "Antique Brass Crossbow", "Bar Stool", "Basket", "Bells", "Brass candlestick", "Brass candlestick", "Chalice, pewter", "Fishing Net", "Gas Lamp Replica", "Oil Lantern", "Rug (Persian Style)", "Silver Tray", "Tea Set", "Wooden chair", "Yorick's skull", "Velvet cloak", "Crown (Prop)", "Map (Aged)", "Fan (Folding)", "Ladderback chair, carved oak", "Pewter tankard"];
const locs = ["shelfA", "shelfB", "shelfB2", "shake", "roomA", "costume", "loft", null];
const colours = ["#8a6d3b", "#5c8c70", "#9b3a22", "#3e8c9a", "#7e5410", "#6b5f4c"];

function seed(): Record<string, Row[]> {
  const DB: Record<string, Row[]> = {
    organizations: [{ id: "org1", name: "SPARC", invite_code: "163ECD01" }],
    profiles: [{ id: "u1", full_name: "testname", avatar_url: null, active_org_id: "org1" }],
    memberships: [{ user_id: "u1", org_id: "org1", role: "owner", created_at: "2026-09-24T00:00:00Z" }],
    locations: [
      { id: "roomA", org_id: "org1", name: "Props Room A", parent_location_id: null, description: null, created_at: now },
      { id: "roomB", org_id: "org1", name: "Props Room B", parent_location_id: null, description: null, created_at: now },
      { id: "costume", org_id: "org1", name: "Costume Storage", parent_location_id: null, description: null, created_at: now },
      { id: "shelfA", org_id: "org1", name: "A", parent_location_id: "roomA", description: null, created_at: now },
      { id: "shelfB", org_id: "org1", name: "B", parent_location_id: "roomA", description: null, created_at: now },
      { id: "shelfB2", org_id: "org1", name: "B", parent_location_id: "roomB", description: null, created_at: now },
      { id: "shake", org_id: "org1", name: "Shakespeare Box", parent_location_id: "shelfA", description: null, created_at: now },
      { id: "loft", org_id: "org1", name: "Loft", parent_location_id: null, description: null, created_at: now },
    ],
    items: [],
    productions: [{ id: "prod1", org_id: "org1", name: "Noises Off!", status: "planning", start_date: "2026-11-01", end_date: "2026-12-02", created_at: now }],
    pull_lists: [{ id: "pl1", production_id: "prod1", name: "Pull List", created_at: now }],
    pull_list_items: [],
    deleted_records: [],
    item_photo_embeddings: [],
    item_reference_photos: [],
    item_twins: [],
  };
  names.forEach((name, i) => {
    DB.items.push({
      id: `it${i}`, org_id: "org1", name, category: name.includes("cloak") ? "costume" : "prop",
      description: name === "Tea Set" ? "Brass-handled teapot and four cups." : name === "Rug (Persian Style)" ? null : i % 3 === 0 ? "Backup unit available." : null,
      photo_url: i % 5 === 4 ? null : `p${i}.jpg`, quantity: i % 4 === 1 ? 2 : 1, condition: ["good", "fair", "new", null][i % 4],
      location_id: locs[i % locs.length], created_at: `2026-09-${String(10 + (i % 18)).padStart(2, "0")}T10:00:00Z`,
      auto_tags: name === "Silver Tray" ? ["brass", "metal"] : [], import_data: name === "Map (Aged)" ? { "Inventory No.": "P-014", Donor: "Brass family" } : {},
    });
  });
  DB.pull_list_items.push(
    { id: "pli1", pull_list_id: "pl1", item_id: "it8", quantity_needed: 1, status: "pulled", check_state: "open", checked_at: null, checked_by: null, created_at: now },
    { id: "pli2", pull_list_id: "pl1", item_id: "it5", quantity_needed: 2, status: "pending", check_state: "open", checked_at: null, checked_by: null, created_at: now },
    { id: "pli3", pull_list_id: "pl1", item_id: "it15", quantity_needed: 1, status: "pulled", check_state: "checked", checked_at: now, checked_by: "u1", created_at: now },
  );
  return DB;
}

const store = globalThis as unknown as { __fixtureDB?: Record<string, Row[]> };
store.__fixtureDB ??= seed();
/** The live tables. Replaced, never reassigned, so imports stay valid. */
export const DB: Record<string, Row[]> = new Proxy({} as Record<string, Row[]>, {
  get: (_t, key: string) => store.__fixtureDB![key],
  set: (_t, key: string, value: Row[]) => {
    store.__fixtureDB![key] = value;
    return true;
  },
  ownKeys: () => Reflect.ownKeys(store.__fixtureDB!),
  getOwnPropertyDescriptor: (_t, key) => ({ ...Object.getOwnPropertyDescriptor(store.__fixtureDB!, key), configurable: true }),
});

/**
 * Back to the seeded theatre: called by POST /api/e2e/reset. Options:
 *   role=member   the signed-in person is a member, not the owner
 *   deleted=old   Recently Deleted already holds two things: one deleted
 *                 10 days ago, one 40 days ago (past its 30, due a purge)
 *   pictures=1    the second brass candlestick (it6) has two extra pictures
 *   twins=1       the two brass candlesticks (it5, it6) are twins
 *   copies=1      five more Silver Trays (it12 is in Props Room A): one
 *                 more loose in Props Room A, two in the Loft (one out on
 *                 Noises Off!), one in the Shakespeare Box, one on shelf B
 */
export function resetFixtures(options?: URLSearchParams): void {
  const db = seed();
  if (options?.get("role") === "member") db.memberships[0].role = "member";
  if (options?.get("deleted") === "old") {
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    db.deleted_records.push(
      { id: "dr-recent", org_id: "org1", kind: "item", label: "Spare lantern", detail: "Loft", photo_paths: [], deleted_by: "u1", deleted_at: daysAgo(10),
        snapshot: { kind: "item", item: { id: "it-spare", org_id: "org1", name: "Spare lantern", category: "prop", description: null, photo_url: null, quantity: 1, condition: null, location_id: "loft", created_at: now, auto_tags: [], import_data: {} }, lines: [], embedding: null } },
      { id: "dr-expired", org_id: "org1", kind: "item", label: "Broken umbrella", detail: "Unassigned", photo_paths: ["org1/umbrella.jpg"], deleted_by: "u1", deleted_at: daysAgo(40),
        snapshot: { kind: "item", item: { id: "it-umbrella", org_id: "org1", name: "Broken umbrella" }, lines: [], embedding: null } }
    );
  }
  if (options?.get("pictures") === "1") {
    // The second brass candlestick (it6) has two extra pictures, kept from
    // confirmed photo matches (migration 008).
    for (const n of [1, 2]) {
      db.item_reference_photos.push({ id: `ref-it6-${n}`, item_id: "it6", org_id: "org1", photo_path: `org1/it6/ref-${n}.jpg`, source: "find_by_photo", similarity: 0.8, model: "clip-vit-base-patch32", embedding: null, created_by: "u1", created_at: now });
    }
  }
  if (options?.get("twins") === "1") {
    // The two brass candlesticks (it5, it6) are a pair: twins.
    db.item_twins.push(
      { item_id: "it5", org_id: "org1", twin_set: "set-candles", created_at: now },
      { item_id: "it6", org_id: "org1", twin_set: "set-candles", created_at: now }
    );
  }
  if (options?.get("copies") === "1") {
    // Identical items: two in the Loft (a room with nothing inside, so they
    // show as "Silver Tray (2)"); the rest apart, or loose in a room that
    // has boxes, so they don't (src/lib/item-copies.ts).
    const tray = (id: string, name: string, location_id: string, condition: string | null, day: string) => ({
      id, org_id: "org1", name, category: "prop", description: id === "it-tray4" ? "Dented on one corner." : null,
      photo_url: null, quantity: 1, condition, location_id, created_at: `2026-09-${day}T10:00:00Z`, auto_tags: [], import_data: {},
    });
    db.items.push(
      tray("it-tray2", "Silver Tray", "roomA", "good", "20"),
      tray("it-tray3", "Silver Tray", "loft", "good", "21"),
      tray("it-tray4", "silver  tray", "loft", "fair", "22"),
      tray("it-tray5", "Silver Tray", "shake", null, "23"),
      tray("it-tray6", "Silver Tray", "shelfB", null, "24"),
    );
    db.pull_list_items.push(
      { id: "pli-tray", pull_list_id: "pl1", item_id: "it-tray3", quantity_needed: 1, status: "pulled", check_state: "open", checked_at: null, checked_by: null, created_at: now },
    );
  }
  store.__fixtureDB = db;
}

export function photoFor(path: string) {
  const i = Number(path.replace(/\D/g, "")) || 0;
  if (i === 3) return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect width="200" height="800" fill="#8a6d3b"/></svg>')}`;
  return svg(colours[i % colours.length], String(i));
}

// Embed resolution for the handful of shapes the pages ask for.
function embed(table: string, row: Row, select: string): Row {
  const out: Row = { ...row };
  if (table === "items" && select.includes("locations(")) {
    const l = DB.locations.find((x) => x.id === row.location_id);
    out.locations = l ? { name: l.name } : null;
  }
  if (table === "pull_list_items") {
    if (select.includes("items(")) out.items = DB.items.find((x) => x.id === row.item_id) ?? null;
    if (select.includes("pull_lists(")) {
      const pl = DB.pull_lists.find((x) => x.id === row.pull_list_id);
      const prod = pl && DB.productions.find((x) => x.id === pl.production_id);
      out.pull_lists = pl ? { name: pl.name, production_id: pl.production_id, productions: prod ?? null } : null;
    }
  }
  if (table === "pull_lists" && select.includes("productions(")) {
    out.productions = DB.productions.find((x) => x.id === row.production_id) ?? null;
  }
  if (table === "deleted_records" && select.includes("profiles(")) {
    out.profiles = DB.profiles.find((x) => x.id === row.deleted_by) ?? null;
  }
  if (table === "productions" && select.includes("pull_lists(")) {
    out.pull_lists = DB.pull_lists.filter((x) => x.production_id === row.id);
  }
  if (table === "memberships" && select.includes("organizations(")) {
    out.organizations = DB.organizations.find((x) => x.id === row.org_id) ?? null;
  }
  if (table === "item_reference_photos" && select.includes("items(")) {
    const item = DB.items.find((x) => x.id === row.item_id);
    out.items = item ? { name: item.name } : null;
  }
  if (table === "memberships" && select.includes("profiles(")) {
    out.profiles = DB.profiles.find((x) => x.id === row.user_id) ?? null;
  }
  return out;
}

/** What the real foreign keys do on delete (schema.sql): cascade or set null. */
function cascade(table: string, gone: string[]) {
  if (!gone.length) return;
  const drop = (t: string, col: string, ids: string[]) => {
    const removed = (DB[t] ?? []).filter((r) => ids.includes(r[col] as string));
    DB[t] = (DB[t] ?? []).filter((r) => !removed.includes(r));
    return removed.map((r) => r.id as string);
  };
  if (table === "productions") cascade("pull_lists", drop("pull_lists", "production_id", gone));
  if (table === "pull_lists") drop("pull_list_items", "pull_list_id", gone);
  if (table === "items") {
    drop("pull_list_items", "item_id", gone);
    drop("item_photo_embeddings", "item_id", gone);
    drop("item_reference_photos", "item_id", gone);
    drop("item_twins", "item_id", gone);
  }
  if (table === "locations") {
    for (const l of DB.locations) if (gone.includes(l.parent_location_id as string)) l.parent_location_id = null;
    for (const i of DB.items) if (gone.includes(i.location_id as string)) i.location_id = null;
  }
}

export function query(table: string) {
  let rows = [...(DB[table] ?? [])];
  let select = "*";
  let single = false;
  let head = false;
  let countMode = false;
  const b: Record<string, unknown> = {};
  b.select = (s = "*", opts?: { count?: string; head?: boolean }) => { select = s; head = !!opts?.head; countMode = !!opts?.count; return b; };
  b.eq = (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return b; };
  b.neq = (col: string, v: unknown) => { rows = rows.filter((r) => r[col] !== v); return b; };
  b.in = (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return b; };
  b.not = (col: string, op: string, v: unknown) => { if (op === "is" && v === null) rows = rows.filter((r) => r[col] !== null && r[col] !== undefined); return b; };
  b.is = (col: string, v: unknown) => { rows = rows.filter((r) => (r[col] ?? null) === v); return b; };
  b.order = (col: string, opts?: { ascending?: boolean }) => { const asc = opts?.ascending !== false; rows.sort((x, y) => String(x[col] ?? "").localeCompare(String(y[col] ?? "")) * (asc ? 1 : -1)); return b; };
  b.limit = (n: number) => { rows = rows.slice(0, n); return b; };
  const compare = (col: string, test: (a: string, b: string) => boolean) => (v: unknown) => {
    rows = rows.filter((r) => r[col] !== null && r[col] !== undefined && test(String(r[col]), String(v)));
    return b;
  };
  b.lt = (col: string, v: unknown) => compare(col, (a, z) => a < z)(v);
  b.lte = (col: string, v: unknown) => compare(col, (a, z) => a <= z)(v);
  b.gt = (col: string, v: unknown) => compare(col, (a, z) => a > z)(v);
  b.gte = (col: string, v: unknown) => compare(col, (a, z) => a >= z)(v);
  b.range = () => b;
  b.maybeSingle = () => { single = true; return b; };
  b.single = () => { single = true; return b; };
  let op: { kind: "insert" | "update" | "delete" | "upsert"; v?: Row | Row[]; ignoreDuplicates?: boolean; onConflict?: string } | null = null;
  b.update = (v: Row) => { op = { kind: "update", v }; return b; };
  b.insert = (v: Row | Row[]) => { op = { kind: "insert", v }; return b; };
  b.upsert = (v: Row | Row[], opts?: { ignoreDuplicates?: boolean; onConflict?: string }) => { op = { kind: "upsert", v, ignoreDuplicates: !!opts?.ignoreDuplicates, onConflict: opts?.onConflict }; return b; };
  b.delete = () => { op = { kind: "delete" }; return b; };
  b.then = (resolve: (v: unknown) => void) => {
    if (op?.kind === "insert") {
      const defaults: Row =
        table === "pull_list_items"
          ? { status: "pending", check_state: "open", quantity_needed: 1, checked_at: null, checked_by: null }
          : table === "items"
            ? { auto_tags: [], import_data: {}, quantity: 1, category: "prop", condition: null, description: null, photo_url: null, location_id: null }
            : table === "deleted_records"
            ? { deleted_at: new Date().toISOString(), photo_paths: [], detail: null }
            : {};
      const made = (Array.isArray(op.v) ? op.v : [op.v!]).map((r) => ({ id: `${table}-${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString(), ...defaults, ...r }));
      DB[table] = [...(DB[table] ?? []), ...made];
      rows = made;
    } else if (op?.kind === "upsert") {
      // By id (or the onConflict column), as the restores use it: new rows
      // go in as given, rows already there are left alone (ignoreDuplicates)
      // or updated.
      const table_ = DB[table] ?? [];
      const touched: Row[] = [];
      const key = op.onConflict ?? "id";
      const incoming = Array.isArray(op.v) ? op.v : [op.v!];
      // Like Postgres: conflicts can only be resolved on a column the rows
      // have (item_photo_embeddings has no id, for one).
      if (incoming.some((r) => r[key] === undefined)) {
        resolve({ data: null, error: { message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" }, count: null });
        return;
      }
      for (const r of incoming) {
        const found = table_.find((x) => x[key] !== undefined && x[key] === r[key]);
        if (!found) { table_.push({ ...r }); touched.push(r); }
        else if (!op.ignoreDuplicates) { Object.assign(found, r); touched.push(found); }
      }
      DB[table] = table_;
      rows = touched;
    } else if (op?.kind === "update") {
      for (const r of rows) Object.assign(r, op.v);
    } else if (op?.kind === "delete") {
      DB[table] = (DB[table] ?? []).filter((r) => !rows.includes(r));
      cascade(table, rows.map((r) => r.id as string));
    }
    const data = rows.map((r) => embed(table, r, select));
    resolve({ data: head ? null : single ? (data[0] ?? null) : data, error: null, count: countMode ? rows.length : null });
  };
  return b;
}

export function rpc(name: string, args: Record<string, unknown>) {
  if (name === "location_descendants") {
    const out = new Set<string>(args.p_ids as string[]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of DB.locations) if (l.parent_location_id && out.has(l.parent_location_id as string) && !out.has(l.id as string)) { out.add(l.id as string); grew = true; }
    }
    return Promise.resolve({ data: [...out].map((id) => ({ location_descendants: id })), error: null });
  }
  if (name === "search_items_prefix") {
    const terms = String(args.search_query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    let scope: Set<string> | null = null;
    if (Array.isArray(args.location_ids) && args.location_ids.length) {
      scope = new Set(args.location_ids as string[]);
      let grew = true;
      while (grew) { grew = false; for (const l of DB.locations) if (l.parent_location_id && scope.has(l.parent_location_id as string) && !scope.has(l.id as string)) { scope.add(l.id as string); grew = true; } }
    }
    const data = DB.items.filter((it) => {
      if (scope && !scope.has(it.location_id as string)) return false;
      const hay = `${it.name} ${it.description ?? ""} ${(it.auto_tags as string[]).join(" ")} ${Object.values(it.import_data as object).join(" ")}`.toLowerCase();
      // Like the real search: words split on punctuation, so "rust" finds
      // "orange/rust" (migration 011), plus a de-punctuated copy of each, so
      // "P-014" can be typed back in (migration 004).
      const words = hay.split(/[^a-z0-9]+/);
      const squashed = hay.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, ""));
      return terms.every((t) => {
        const plain = t.replace(/[^a-z0-9]/g, "");
        return words.some((w) => w.startsWith(t)) || squashed.some((w) => plain && w.startsWith(plain));
      });
    });
    return Promise.resolve({ data, error: null });
  }
  if (name === "match_items") {
    // Opt-in, so every other page keeps "nothing fingerprinted yet": a test
    // sets window.__matchItems = [{ item_id, similarity }, ...] in the page.
    const wanted = (globalThis as unknown as { __matchItems?: Row[] }).__matchItems ?? [];
    return Promise.resolve({ data: wanted.slice(0, Number(args.match_count) || 5), error: null });
  }
  return Promise.resolve({ data: [], error: null });
}

function storageLog() {
  const g = globalThis as unknown as { __storage?: { uploaded: string[]; removed: string[]; copied: string[][] } };
  g.__storage ??= { uploaded: [], removed: [], copied: [] };
  g.__storage.copied ??= [];
  return g.__storage;
}

export function storageFrom() {
  return {
    createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: photoFor(path), error: null })), error: null }),
    createSignedUrl: async (path: string) => ({ data: { signedUrl: photoFor(path) }, error: null }),
    // Fails unless a test sets window.__downloads = true, so the fingerprint
    // catch-up stays quiet everywhere else. A path with "missing" in it
    // always fails.
    download: async (path: string) =>
      (globalThis as unknown as { __downloads?: boolean }).__downloads && !path.includes("missing")
        ? { data: new Blob([`picture of ${path}`], { type: "image/jpeg" }), error: null }
        : { data: null, error: { message: "stub" } },
    // Uploads and removals are noted on globalThis.__storage, so a test can
    // see which files were written to (and taken out of) the photos bucket.
    upload: async (path: string) => { storageLog().uploaded.push(path); return { data: { path }, error: null }; },
    remove: async (paths: string[]) => { storageLog().removed.push(...paths); return { data: null, error: null }; },
    copy: async (from: string, to: string) => { storageLog().copied.push([from, to]); return { data: { path: to }, error: null }; },
  };
}
