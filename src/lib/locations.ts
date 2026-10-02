// Turning the locations table's parent links into something a dropdown can
// show. Two boxes can both be called "Shakespeare box" — one in the shed,
// one in the garage — so a bare name is ambiguous wherever a location is
// picked. Everywhere that offers a choice of location shows the full path.

export type LocationNode = {
  id: string;
  name: string;
  parent_location_id: string | null;
};

export type LocationChoice = {
  id: string;
  /** "Shed / Shakespeare box" */
  path: string;
  /** How deep it sits, for indenting. */
  depth: number;
};

const MAX_DEPTH = 20;

/**
 * Builds the full path for every location, sorted so children follow their
 * parents alphabetically. A location whose parent is missing or circular
 * (which shouldn't happen, but the column is only a nullable self-reference)
 * falls back to its own name rather than looping forever.
 */
export function buildLocationChoices(rows: LocationNode[]): LocationChoice[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  const choices = rows.map((row) => {
    const names: string[] = [row.name];
    const seen = new Set<string>([row.id]);
    let parentId = row.parent_location_id;
    let depth = 0;

    while (parentId && depth < MAX_DEPTH) {
      if (seen.has(parentId)) break;
      const parent = byId.get(parentId);
      if (!parent) break;
      seen.add(parent.id);
      names.unshift(parent.name);
      parentId = parent.parent_location_id;
      depth += 1;
    }

    return { id: row.id, path: names.join(" / "), depth };
  });

  return choices.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { sensitivity: "base" })
  );
}

export type LocationTreeNode = {
  id: string;
  /** "Shakespeare box" */
  name: string;
  /** "Shed / Shakespeare box" */
  path: string;
  /** Ids from the outermost space down to this one's parent. */
  trail: string[];
  children: LocationTreeNode[];
};

/**
 * The same rows as an actual tree, for a picker you walk into rather than a
 * list you scroll.
 *
 * A flat list of paths is fine at a dozen locations and unusable at two
 * hundred: every bin in the building is on screen at once, and the thing you
 * want is distinguished from its neighbours by a prefix you have to read to
 * the end of. Walking in shows you a room's contents and nothing else.
 *
 * Rows whose parent is missing (deleted, or hidden by row-level security)
 * surface at the top level rather than vanishing, because an item filed in
 * one still has to be findable. A cycle — which the schema permits, since
 * `parent_location_id` is only a nullable self-reference — is broken by
 * taking the first node of it as a root, so this returns a tree rather than
 * hanging.
 */
export function buildLocationTree(rows: LocationNode[]): LocationTreeNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  /** Whether following this row's parents comes back round to the row. */
  function loopsBackToItself(row: LocationNode): boolean {
    const seen = new Set<string>([row.id]);
    let parentId = row.parent_location_id;
    for (let step = 0; parentId && step < MAX_DEPTH; step += 1) {
      if (parentId === row.id) return true;
      if (seen.has(parentId)) return false; // a loop, but not one this row is in
      seen.add(parentId);
      parentId = byId.get(parentId)?.parent_location_id ?? null;
    }
    return false;
  }

  const nodes = new Map<string, LocationTreeNode>();
  for (const row of rows) {
    nodes.set(row.id, { id: row.id, name: row.name, path: row.name, trail: [], children: [] });
  }

  const roots: LocationTreeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parent_location_id ? nodes.get(row.parent_location_id) : undefined;
    // Rooted when it has no parent, when its parent is gone, or when its
    // parent chain is a ring this row sits on — cutting exactly the edges
    // that would make the "tree" unwalkable, and keeping every row.
    if (parent && !loopsBackToItself(row)) parent.children.push(node);
    else roots.push(node);
  }

  const byName = (a: LocationTreeNode, b: LocationTreeNode) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  // Paths and trails are read off the finished tree rather than off the raw
  // parent links, so what the picker walks and what it prints cannot disagree.
  const describe = (list: LocationTreeNode[], names: string[], ids: string[]) => {
    list.sort(byName);
    for (const node of list) {
      node.path = [...names, node.name].join(" / ");
      node.trail = ids;
      describe(node.children, [...names, node.name], [...ids, node.id]);
    }
  };
  describe(roots, [], []);

  return roots;
}

/** Depth-first, parents before children — the order a reader expects. */
export function flattenLocationTree(roots: LocationTreeNode[]): LocationTreeNode[] {
  const out: LocationTreeNode[] = [];
  const walk = (list: LocationTreeNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(roots);
  return out;
}

/**
 * Case- and accent-insensitive, so "cafe" finds "Café" and nobody has to know
 * which way the box was labelled.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/**
 * Locations whose path matches every word typed, in any order and anywhere in
 * the path — so "shake cro" finds "Props Room A / Shakespeare box / Crowns
 * tin", and so does "crowns".
 */
export function matchLocations(
  all: LocationTreeNode[],
  query: string,
): LocationTreeNode[] {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const scored = all
    .map((node) => {
      const haystack = normalizeForSearch(node.path);
      if (!words.every((word) => haystack.includes(word))) return null;
      // A hit on the location's own name beats one on an ancestor's: typing
      // "props room" should offer the room before the six boxes inside it.
      const own = normalizeForSearch(node.name);
      const onOwnName = words.every((word) => own.includes(word));
      return { node, rank: (onOwnName ? 0 : 1) * 1000 + node.path.length };
    })
    .filter((entry): entry is { node: LocationTreeNode; rank: number } => entry !== null);

  scored.sort((a, b) => a.rank - b.rank || a.node.path.localeCompare(b.node.path));
  return scored.map((entry) => entry.node);
}
