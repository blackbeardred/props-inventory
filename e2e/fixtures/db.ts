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
      { id: "roomA", name: "Props Room A", parent_location_id: null, description: null, created_at: now },
      { id: "roomB", name: "Props Room B", parent_location_id: null, description: null, created_at: now },
      { id: "costume", name: "Costume Storage", parent_location_id: null, description: null, created_at: now },
      { id: "shelfA", name: "A", parent_location_id: "roomA", description: null, created_at: now },
      { id: "shelfB", name: "B", parent_location_id: "roomA", description: null, created_at: now },
      { id: "shelfB2", name: "B", parent_location_id: "roomB", description: null, created_at: now },
      { id: "shake", name: "Shakespeare Box", parent_location_id: "shelfA", description: null, created_at: now },
      { id: "loft", name: "Loft", parent_location_id: null, description: null, created_at: now },
    ],
    items: [],
    productions: [{ id: "prod1", name: "Noises Off!", status: "planning", start_date: "2026-11-01", end_date: "2026-12-02", created_at: now }],
    pull_lists: [{ id: "pl1", production_id: "prod1", name: "Pull List", created_at: now }],
    pull_list_items: [],
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

/** Back to the seeded theatre: called by POST /api/e2e/reset. */
export function resetFixtures(): void {
  store.__fixtureDB = seed();
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
      out.pull_lists = pl ? { name: pl.name, productions: prod ?? null } : null;
    }
  }
  if (table === "productions" && select.includes("pull_lists(")) {
    out.pull_lists = DB.pull_lists.filter((x) => x.production_id === row.id);
  }
  if (table === "memberships" && select.includes("organizations(")) {
    out.organizations = DB.organizations.find((x) => x.id === row.org_id) ?? null;
  }
  if (table === "memberships" && select.includes("profiles(")) {
    out.profiles = DB.profiles.find((x) => x.id === row.user_id) ?? null;
  }
  return out;
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
  b.range = () => b;
  b.maybeSingle = () => { single = true; return b; };
  b.single = () => { single = true; return b; };
  let op: { kind: "insert" | "update" | "delete"; v?: Row | Row[] } | null = null;
  b.update = (v: Row) => { op = { kind: "update", v }; return b; };
  b.insert = (v: Row | Row[]) => { op = { kind: "insert", v }; return b; };
  b.upsert = () => b;
  b.delete = () => { op = { kind: "delete" }; return b; };
  b.then = (resolve: (v: unknown) => void) => {
    if (op?.kind === "insert") {
      const defaults: Row = table === "pull_list_items" ? { status: "pending", check_state: "open", quantity_needed: 1, checked_at: null, checked_by: null } : {};
      const made = (Array.isArray(op.v) ? op.v : [op.v!]).map((r) => ({ id: `${table}-${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString(), ...defaults, ...r }));
      DB[table] = [...(DB[table] ?? []), ...made];
      rows = made;
    } else if (op?.kind === "update") {
      for (const r of rows) Object.assign(r, op.v);
    } else if (op?.kind === "delete") {
      DB[table] = (DB[table] ?? []).filter((r) => !rows.includes(r));
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
      // Like the real search (migration 004): words split on punctuation,
      // plus a de-punctuated copy of each, so "P-014" can be typed back in.
      const words = hay.split(/[^a-z0-9]+/);
      const squashed = hay.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, ""));
      return terms.every((t) => {
        const plain = t.replace(/[^a-z0-9]/g, "");
        return words.some((w) => w.startsWith(t)) || squashed.some((w) => plain && w.startsWith(plain));
      });
    });
    return Promise.resolve({ data, error: null });
  }
  return Promise.resolve({ data: [], error: null });
}

export function storageFrom() {
  return {
    createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: photoFor(path), error: null })), error: null }),
    createSignedUrl: async (path: string) => ({ data: { signedUrl: photoFor(path) }, error: null }),
    download: async () => ({ data: null, error: { message: "stub" } }),
    upload: async () => ({ data: null, error: null }),
    remove: async () => ({ data: null, error: null }),
  };
}
