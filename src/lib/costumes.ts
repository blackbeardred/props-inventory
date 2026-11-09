/**
 * Costumes on pull lists (migration 019): the pure rules, apart from the
 * database so they can be tested on their own.
 *
 * A costume is a named group of pull-list lines ("Margaret costume": long
 * white dress, corset, tartan shawl…). Each piece is still an ordinary line,
 * so status, the checklist and "not checked" work on it as before. The
 * database calls the group a pull_list_group, so prop sets can use it too.
 */

/** The longest name the database accepts (pull_list_groups.name check). */
export const MAX_COSTUME_NAME = 80;

/**
 * "Margaret" → "Margaret costume". A name that already says costume is kept
 * as typed, so nobody gets "Margaret costume costume". Null when blank.
 */
export function costumeName(input: string): string | null {
  const name = input.replace(/\s+/g, " ").trim();
  if (!name) return null;
  const full = /\bcostumes?$/i.test(name) ? name : `${name} costume`;
  return full.slice(0, MAX_COSTUME_NAME).trim();
}

/** "Margaret costume" → "Margaret", for the checklist's "Margaret · Corset". */
export function costumeShortName(name: string): string {
  return name.replace(/\s+costumes?$/i, "").trim() || name;
}

export type Line = {
  id: string;
  item_id: string;
  group_id?: string | null;
  status: string;
  items: { category: string } | null;
};

export type Group = { id: string; name: string; position: number; created_at: string };

/**
 * A pull list in the order it's shown: each costume with its pieces, then
 * costume pieces not in a costume yet, then props. Lines keep their order
 * within each part. A line whose costume isn't in `groups` counts as loose.
 */
export function arrangeList<L extends Line, G extends Group>(lines: L[], groups: G[]) {
  const known = new Set(groups.map((g) => g.id));
  const sorted = [...groups].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const costumes = sorted.map((group) => ({ group, lines: lines.filter((l) => l.group_id === group.id) }));
  const loose = lines.filter((l) => !l.group_id || !known.has(l.group_id));
  return {
    costumes,
    loosePieces: loose.filter((l) => l.items?.category === "costume"),
    props: loose.filter((l) => l.items?.category !== "costume"),
  };
}

/** "7 pieces · 3 pulled". Returned lines count as pulled: they were. */
export function costumeSummary(lines: { status: string }[]): { pieces: number; pulled: number } {
  return { pieces: lines.length, pulled: lines.filter((l) => l.status === "pulled" || l.status === "returned").length };
}

/** One line from any pull list in the theater, with the show it was for. */
export type HistoryLine = {
  item_id: string;
  pull_list_id: string;
  production_id: string;
  group_id: string | null;
  status: string;
};

export type Suggestion = {
  item_id: string;
  /** Past shows where it was in the same costume as one of the pieces. */
  sameCostume: number;
  /** Past shows where it was on the same pull list (costume or not). */
  sameList: number;
  /** The costume it was last in with them, for "In Margaret costume". */
  costume: string | null;
  /** Pulled for another show right now. */
  inUse: boolean;
};

/**
 * What else to pull, from past shows: everything that was on the same pull
 * list as one of `seeds`, in a production other than `production`. Being in
 * the same costume counts double. Skips what's already on this list (`skip`)
 * and the seeds themselves. Best first; ties go to the most shows, then name
 * order is left to the caller.
 */
export function suggestPieces(
  history: HistoryLine[],
  {
    seeds,
    production,
    skip = [],
    groupNames = new Map<string, string>(),
    limit = 5,
  }: {
    seeds: string[];
    production: string;
    skip?: string[];
    groupNames?: Map<string, string>;
    limit?: number;
  }
): Suggestion[] {
  const seedSet = new Set(seeds);
  const skipSet = new Set([...skip, ...seeds]);
  const past = history.filter((l) => l.production_id !== production);

  const byList = new Map<string, HistoryLine[]>();
  for (const line of past) {
    const list = byList.get(line.pull_list_id) ?? [];
    list.push(line);
    byList.set(line.pull_list_id, list);
  }

  const lists = new Map<string, Set<string>>();
  const costumes = new Map<string, Set<string>>();
  const lastCostume = new Map<string, string>();
  for (const lines of byList.values()) {
    const seedLines = lines.filter((l) => seedSet.has(l.item_id));
    if (!seedLines.length) continue;
    const seedGroups = new Set(seedLines.map((l) => l.group_id).filter((g): g is string => Boolean(g)));
    for (const line of lines) {
      if (skipSet.has(line.item_id)) continue;
      const show = line.production_id;
      if (!lists.has(line.item_id)) lists.set(line.item_id, new Set());
      lists.get(line.item_id)!.add(show);
      if (line.group_id && seedGroups.has(line.group_id)) {
        if (!costumes.has(line.item_id)) costumes.set(line.item_id, new Set());
        costumes.get(line.item_id)!.add(show);
        const name = groupNames.get(line.group_id);
        if (name) lastCostume.set(line.item_id, name);
      }
    }
  }

  const pulledElsewhere = new Set(
    history.filter((l) => l.production_id !== production && l.status === "pulled").map((l) => l.item_id)
  );

  return [...lists.keys()]
    .map((item_id) => ({
      item_id,
      sameCostume: costumes.get(item_id)?.size ?? 0,
      sameList: lists.get(item_id)!.size,
      costume: lastCostume.get(item_id) ?? null,
      inUse: pulledElsewhere.has(item_id),
    }))
    .sort(
      (a, b) =>
        2 * b.sameCostume + b.sameList - (2 * a.sameCostume + a.sameList) ||
        b.sameList - a.sameList ||
        a.item_id.localeCompare(b.item_id)
    )
    .slice(0, limit);
}

/** "2 shows", "in Margaret costume, 2 shows". */
export function suggestionNote(s: Suggestion): string {
  const shows = s.sameCostume || s.sameList;
  const count = `${shows} show${shows === 1 ? "" : "s"}`;
  return s.costume && s.sameCostume ? `with ${s.costume}, ${count}` : count;
}
