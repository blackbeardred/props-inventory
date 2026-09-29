// Turning a pull list into a walk round the storage rooms, and noticing when
// someone has walked away from a box without finishing it.
//
// Pulling happens room by room, box by box: you stand in front of one
// container, take what's on the list, and move on. So the checklist is
// grouped that way, and the interesting signal falls out of the order people
// tick things in — if a box has been started, and checking has since moved
// somewhere else, whatever is still open in that box got left behind.
//
// Nothing here talks to the database. It takes rows and gives back groups, so
// the rule can be tested without a server.

import type { LocationNode } from "@/lib/locations";

/**
 * Where a row is in its walk. `open` is the default and means nobody has
 * stood in front of it; `checked` means someone confirmed it; `cleared`
 * means someone decided it isn't wanted after all, which silences it without
 * pretending it was pulled.
 */
export type CheckState = "open" | "checked" | "cleared";

export type ChecklistRow = {
  /** The pull_list_items row id. */
  id: string;
  itemId: string;
  name: string;
  quantityNeeded: number;
  checkState: CheckState;
  /** When it stopped being open, for ordering the walk. */
  checkedAt: string | null;
  checkedByName: string | null;
  /** The container the item is filed in, null when it's unassigned. */
  locationId: string | null;
  photoUrl?: string;
};

export type ChecklistContainer = {
  /** The location the items sit in — the box, shelf or rack. */
  id: string | null;
  name: string;
  rows: ChecklistRow[];
};

export type ChecklistRoom = {
  /** The outermost location — the room you walk into. */
  id: string | null;
  name: string;
  containers: ChecklistContainer[];
};

const MAX_DEPTH = 20;

/**
 * The chain of locations from the outermost down to this one. A missing or
 * circular parent stops the walk rather than looping — the column is only a
 * nullable self-reference, so neither is impossible.
 */
function ancestry(locationId: string, byId: Map<string, LocationNode>): LocationNode[] {
  const chain: LocationNode[] = [];
  const seen = new Set<string>();

  let current = byId.get(locationId);
  while (current && !seen.has(current.id) && chain.length < MAX_DEPTH) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_location_id ? byId.get(current.parent_location_id) : undefined;
  }

  return chain;
}

const UNASSIGNED = "Not filed anywhere";
/** Items filed against a room itself rather than a box inside it. */
const LOOSE = "Loose in the room";

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Groups a pull list into rooms and the containers inside them, both in
 * alphabetical order, with the items inside each container by name.
 *
 * A room is the outermost location an item's container sits in; a container
 * is the location the item is actually filed in. An item filed directly
 * against a room has that room for both, so it still gets a heading to stand
 * under rather than being dropped.
 */
export function groupByRoomAndContainer(
  rows: ChecklistRow[],
  locations: LocationNode[]
): ChecklistRoom[] {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const rooms = new Map<string, ChecklistRoom>();

  for (const row of rows) {
    const chain = row.locationId ? ancestry(row.locationId, byId) : [];
    const room = chain[0];
    const container = chain[chain.length - 1];

    const roomKey = room?.id ?? "";
    let roomGroup = rooms.get(roomKey);
    if (!roomGroup) {
      roomGroup = {
        id: room?.id ?? null,
        name: room?.name ?? UNASSIGNED,
        containers: [],
      };
      rooms.set(roomKey, roomGroup);
    }

    const containerKey = container?.id ?? "";
    let containerGroup = roomGroup.containers.find(
      (candidate) => (candidate.id ?? "") === containerKey
    );
    if (!containerGroup) {
      containerGroup = {
        id: container?.id ?? null,
        // Repeating the room's name as a heading inside itself reads as a
        // mistake; what it means is "in here, not in one of the boxes".
        name: !container ? UNASSIGNED : container.id === room?.id ? LOOSE : container.name,
        rows: [],
      };
      roomGroup.containers.push(containerGroup);
    }

    containerGroup.rows.push(row);
  }

  const ordered = [...rooms.values()].sort((a, b) => {
    // Items with nowhere to be are last: they're a filing problem, not a stop
    // on the walk.
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return compareNames(a.name, b.name);
  });

  for (const room of ordered) {
    room.containers.sort((a, b) => {
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      // The room itself first, then the boxes within it.
      if (a.id === room.id) return -1;
      if (b.id === room.id) return 1;
      return compareNames(a.name, b.name);
    });
    for (const container of room.containers) {
      container.rows.sort((a, b) => compareNames(a.name, b.name));
    }
  }

  return ordered;
}

export type PullIssue = {
  row: ChecklistRow;
  /** "Props Room A / Shakespeare box", for finding it again. */
  where: string;
  /** When the last thing in that container was checked. */
  containerLeftAt: string;
};

/**
 * The items someone walked past.
 *
 * A container counts as *started* once anything in it has been checked. The
 * container being worked on now is whichever was checked most recently —
 * everything still open there is simply not done yet, which is not a problem.
 * But a started container that isn't the current one has been left behind,
 * and whatever is still open in it is what this returns.
 *
 * Containers nobody has touched are not issues: they're the rest of the list.
 * Cleared rows are never issues — that's what clearing is for.
 */
export function findPullIssues(
  rows: ChecklistRow[],
  locations: LocationNode[]
): PullIssue[] {
  const byId = new Map(locations.map((location) => [location.id, location]));

  const lastCheckByContainer = new Map<string, string>();
  for (const row of rows) {
    if (row.checkState !== "checked" || !row.checkedAt) continue;
    const key = row.locationId ?? "";
    const existing = lastCheckByContainer.get(key);
    if (!existing || row.checkedAt > existing) {
      lastCheckByContainer.set(key, row.checkedAt);
    }
  }

  if (lastCheckByContainer.size === 0) return [];

  // The one being worked on right now. Everything open there is just the rest
  // of this box, so it stays quiet.
  let current: string | null = null;
  let latest = "";
  for (const [key, checkedAt] of lastCheckByContainer) {
    if (checkedAt > latest) {
      latest = checkedAt;
      current = key;
    }
  }

  const issues: PullIssue[] = [];
  for (const row of rows) {
    if (row.checkState !== "open") continue;

    const key = row.locationId ?? "";
    const containerLeftAt = lastCheckByContainer.get(key);
    if (!containerLeftAt) continue; // never started — not a miss
    if (key === current) continue; // still standing there

    const chain = row.locationId ? ancestry(row.locationId, byId) : [];
    issues.push({
      row,
      where: chain.length > 0 ? chain.map((node) => node.name).join(" / ") : UNASSIGNED,
      containerLeftAt,
    });
  }

  // Most recently abandoned first: that's the box you can still walk back to.
  return issues.sort((a, b) => {
    if (a.containerLeftAt !== b.containerLeftAt) {
      return b.containerLeftAt.localeCompare(a.containerLeftAt);
    }
    return compareNames(a.row.name, b.row.name);
  });
}
