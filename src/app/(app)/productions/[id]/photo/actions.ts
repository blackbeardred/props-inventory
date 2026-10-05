"use server";

/**
 * Marking a production's items from a photograph of the prop table.
 *
 * Two steps, deliberately separated by a person. `readStagePhoto` looks at
 * the picture and proposes: here is what I think I can see, and here are the
 * inventory items each one might be. `applyStagePhoto` writes only what came
 * back ticked. Nothing about a photograph is certain enough to change an
 * inventory on its own — a chair in a photo is not necessarily *your* chair —
 * and an inventory that drifts wrong without anyone noticing is worse than
 * one that takes a moment to update.
 */

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";
import { seeItems, type SeenObject } from "@/lib/ai/see-items";
import { type Category, type ItemRow } from "@/lib/inventory";
import { locationPaths, type LocationNode } from "@/lib/locations";
import { loadTwinRows } from "@/lib/twins-data";

const CATEGORIES: Category[] = ["prop", "costume"];

/** How many inventory items to offer per thing spotted. */
const CANDIDATES_PER_OBJECT = 5;

/** A phone photo, downscaled in the browser, shouldn't come near this. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export type Candidate = {
  id: string;
  name: string;
  category: Category;
  locationName: string | null;
  quantity: number;
  /** True when this item is already on this production's list. */
  alreadyListed: boolean;
  /** A short-lived link to the item's own photo, so the review screen can
   *  put it beside the crop. Null when the item has none. */
  photoUrl: string | null;
  /** The set of twins it belongs to (migration 009), or null. */
  twinSet: string | null;
  /** Pulled for a production right now. */
  inUse: boolean;
};

/** Long enough to sit on a review screen while someone works down it. */
const PREVIEW_URL_TTL = 60 * 60;

export type Detection = SeenObject & {
  /** Stable across the round trip, so the browser can key its rows. */
  key: string;
  candidates: Candidate[];
};

export type ReadOutcome =
  | {
      ok: true;
      detections: Detection[];
      /** Everything already on this production's lists. The browser needs it
       *  for candidates the picture finds, which never pass through here. */
      listedItemIds: string[];
      /** Everything pulled for any production right now, so a photo of one
       *  of a pair of twins can mark the one that's free. */
      inUseItemIds: string[];
    }
  | { ok: false; error: string };

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mediaType: string } | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) return null;

  try {
    const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return null;
    return { bytes, mediaType: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Looks at the photo and pairs everything it sees with the inventory items it
 * might be. The pairing goes through the app's own search rather than putting
 * the whole inventory in front of the model: it costs nothing extra at five
 * thousand items, and it already knows about the invisible tags and the
 * columns an import kept.
 */
export async function readStagePhoto(
  productionId: string,
  dataUrl: string
): Promise<ReadOutcome> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/productions/${productionId}/photo`);

  const photo = decodeDataUrl(dataUrl);
  if (!photo) {
    return { ok: false, error: "That photo didn’t come through. Try taking it again." };
  }

  const seen = await seeItems(photo);
  if (!seen.ok) return { ok: false, error: seen.reason };
  if (seen.objects.length === 0) {
    return {
      ok: false,
      error:
        "Nothing recognisable in that one. A flatter angle with fewer things overlapping usually helps.",
    };
  }

  // What's already on this production's lists, so the review screen can say
  // so rather than quietly proposing a duplicate.
  const { data: lists } = await supabase
    .from("pull_lists")
    .select("id")
    .eq("production_id", productionId);

  const listIds = ((lists ?? []) as { id: string }[]).map((list) => list.id);
  const listed = new Set<string>();
  if (listIds.length > 0) {
    const { data: rows } = await supabase
      .from("pull_list_items")
      .select("item_id")
      .in("pull_list_id", listIds);
    for (const row of (rows ?? []) as { item_id: string }[]) listed.add(row.item_id);
  }

  // Locations are looked up once and shared, rather than joined per search.
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, parent_location_id");
  const locationNames = locationPaths((locationRows ?? []) as unknown as LocationNode[]);

  const searched: { object: SeenObject; items: ItemRow[] }[] = [];
  for (const object of seen.objects) {
    const { data: matches } = await supabase.rpc("search_items_prefix", {
      search_query: object.search,
      location_ids: null,
    });
    searched.push({
      object,
      items: ((matches ?? []) as unknown as ItemRow[]).slice(0, CANDIDATES_PER_OBJECT),
    });
  }

  // Twins (migration 009): the same prop owned more than once looks the
  // same in any photo, so each of a set goes on offer whenever one is found,
  // and the browser marks one that's free. Nothing here before 009 is run.
  const twinRows = await loadTwinRows(
    supabase,
    [...new Set(searched.flatMap(({ items }) => items.map((item) => item.id)))]
  );
  const setOf = new Map(twinRows.map((row) => [row.item_id, row.twin_set]));
  const membersOf = new Map<string, string[]>();
  for (const row of twinRows) membersOf.set(row.twin_set, [...(membersOf.get(row.twin_set) ?? []), row.item_id]);
  const known = new Set(searched.flatMap(({ items }) => items.map((item) => item.id)));
  const missing = twinRows.map((row) => row.item_id).filter((id) => !known.has(id));
  const extraById = new Map<string, ItemRow>();
  if (missing.length) {
    const { data: extra } = await supabase
      .from("items")
      .select("id, name, category, quantity, photo_url, location_id")
      .in("id", missing);
    for (const item of (extra ?? []) as unknown as ItemRow[]) extraById.set(item.id, item);
  }
  for (const entry of searched) {
    const ids = new Set(entry.items.map((item) => item.id));
    for (const item of [...entry.items]) {
      const set = setOf.get(item.id);
      for (const mate of set ? (membersOf.get(set) ?? []) : []) {
        if (ids.has(mate)) continue;
        const row = extraById.get(mate);
        if (!row) continue;
        entry.items.push(row);
        ids.add(mate);
      }
    }
  }

  const { data: pulledRows } = await supabase
    .from("pull_list_items")
    .select("item_id")
    .eq("status", "pulled");
  const inUse = new Set(((pulledRows ?? []) as { item_id: string }[]).map((row) => row.item_id));

  // Every candidate's photo in one request, rather than one per candidate.
  const paths = [
    ...new Set(
      searched.flatMap(({ items }) =>
        items.map((item) => item.photo_url).filter((path): path is string => Boolean(path))
      )
    ),
  ];
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(paths, PREVIEW_URL_TTL);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  const detections: Detection[] = searched.map(({ object, items }, index) => ({
    ...object,
    key: `${index}-${object.search}`,
    candidates: items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      locationName: item.location_id ? (locationNames.get(item.location_id) ?? null) : null,
      quantity: item.quantity,
      alreadyListed: listed.has(item.id),
      photoUrl: item.photo_url ? (signedByPath.get(item.photo_url) ?? null) : null,
      twinSet: setOf.get(item.id) ?? null,
      inUse: inUse.has(item.id),
    })),
  }));

  return { ok: true, detections, listedItemIds: [...listed], inUseItemIds: [...inUse] };
}

export type MarkDecision = {
  /** An existing item to mark, or null when this one is being created. */
  itemId: string | null;
  /** Used when itemId is null: the new item to create first. */
  newItem: { name: string; category: Category } | null;
  quantity: number;
};

export type ApplyOutcome =
  | {
      ok: true;
      marked: number;
      createdItems: { itemId: string; key: string }[];
      orgId: string;
      /** Who confirmed the matches, so the browser can keep their crops as
       *  more pictures of the items (src/lib/reference-photos.ts). */
      userId: string;
    }
  | { ok: false; error: string };

/**
 * Writes the ticked rows. Items that don't exist yet are created first, and
 * their ids come back so the browser can attach the crop it took from the
 * photo — the same path the importer uses for pictures inside a workbook.
 */
export async function applyStagePhoto(
  productionId: string,
  decisionsJson: string,
  status: "pulled" | "pending"
): Promise<ApplyOutcome> {
  if (status !== "pulled" && status !== "pending") {
    return { ok: false, error: "That isn’t a state an item can be in." };
  }

  let incoming: unknown;
  try {
    incoming = JSON.parse(decisionsJson);
  } catch {
    return { ok: false, error: "Couldn’t read what you ticked. Try again." };
  }
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return { ok: false, error: "Nothing was ticked." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/productions/${productionId}/photo`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();

  const orgId = profile?.active_org_id as string | undefined;
  if (!orgId) return { ok: false, error: "You’re not in an organization yet." };

  // The production is fetched rather than trusted: RLS would refuse another
  // org's anyway, but this turns that into a sentence rather than a silent
  // no-op.
  const { data: production } = await supabase
    .from("productions")
    .select("id")
    .eq("id", productionId)
    .maybeSingle();
  if (!production) return { ok: false, error: "That production isn’t available." };

  // Every production gets one list by default; this only creates one if the
  // production has none at all.
  const { data: existingLists } = await supabase
    .from("pull_lists")
    .select("id")
    .eq("production_id", productionId)
    .order("created_at")
    .limit(1);

  let pullListId = ((existingLists ?? []) as { id: string }[])[0]?.id;
  if (!pullListId) {
    const { data: created, error } = await supabase
      .from("pull_lists")
      .insert({ production_id: productionId, name: "Pull List" })
      .select("id")
      .maybeSingle();
    if (error || !created) {
      return { ok: false, error: error?.message ?? "Couldn’t start a pull list." };
    }
    pullListId = (created as { id: string }).id;
  }

  const createdItems: { itemId: string; key: string }[] = [];
  const rows: { pull_list_id: string; item_id: string; quantity_needed: number; status: string }[] =
    [];
  const newItems: { id: string; org_id: string; name: string; category: Category }[] = [];

  for (const raw of incoming as (MarkDecision & { key?: string })[]) {
    const quantityRaw = Number(raw?.quantity);
    const quantity =
      Number.isFinite(quantityRaw) && quantityRaw >= 1 ? Math.min(999, Math.floor(quantityRaw)) : 1;

    if (typeof raw?.itemId === "string" && raw.itemId) {
      rows.push({
        pull_list_id: pullListId,
        item_id: raw.itemId,
        quantity_needed: quantity,
        status,
      });
      continue;
    }

    const name = raw?.newItem?.name?.trim();
    if (!name) continue;

    const category: Category = CATEGORIES.includes(raw.newItem?.category as Category)
      ? (raw.newItem!.category as Category)
      : "prop";

    const id = randomUUID();
    newItems.push({ id, org_id: orgId, name: name.slice(0, 200), category });
    createdItems.push({ itemId: id, key: typeof raw.key === "string" ? raw.key : id });
    rows.push({ pull_list_id: pullListId, item_id: id, quantity_needed: quantity, status });
  }

  if (rows.length === 0) return { ok: false, error: "Nothing was ticked." };

  if (newItems.length > 0) {
    const { error } = await supabase.from("items").insert(
      newItems.map((item) => ({ ...item, quantity: 1 }))
    );
    if (error) {
      return { ok: false, error: `Couldn’t add the new items: ${error.message}` };
    }
  }

  const { error } = await supabase.from("pull_list_items").insert(rows);
  if (error) {
    return { ok: false, error: `Couldn’t update the pull list: ${error.message}` };
  }

  revalidatePath(`/productions/${productionId}`);
  revalidatePath("/inventory");

  return { ok: true, marked: rows.length, createdItems, orgId, userId: user.id };
}
