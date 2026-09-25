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
