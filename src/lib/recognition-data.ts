/**
 * Everything the recognition check needs, read in the browser: every stored
 * fingerprint (items' own photos and confirmed pictures), the twins, and the
 * items' names. Paged, because a select returns at most 1,000 rows.
 */

import { createClient } from "@/lib/supabase/client";
import { EMBEDDING_MODEL } from "@/lib/embedding";
import { normalise, parseVector, type Picture, type Trial } from "@/lib/recognition-check";

const PAGE = 1000;

async function everyRow<T>(
  read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export type CheckData = {
  pictures: Picture[];
  /** Confirmed pictures with a fingerprint: the photos with known answers. */
  trials: (Trial & { photoPath: string })[];
  twinsOf: Map<string, string[]>;
  names: Map<string, string>;
  /** Items with a photo but no fingerprint yet: they can't be found at all. */
  unfingerprinted: number;
};

export async function loadCheckData(): Promise<CheckData> {
  const supabase = createClient();
  const [own, confirmed, items] = await Promise.all([
    everyRow<{ item_id: string; embedding: string; model: string; photo_url: string }>((from, to) =>
      supabase.from("item_photo_embeddings").select("item_id, embedding, model, photo_url").range(from, to)
    ),
    everyRow<{ id: string; item_id: string; embedding: string | null; model: string; photo_path: string }>((from, to) =>
      supabase
        .from("item_reference_photos")
        .select("id, item_id, embedding, model, photo_path")
        .not("embedding", "is", null)
        .range(from, to)
    ).catch(() => []),
    everyRow<{ id: string; name: string; photo_url: string | null }>((from, to) =>
      supabase.from("items").select("id, name, photo_url").range(from, to)
    ),
  ]);
  const twinRows = await everyRow<{ item_id: string; twin_set: string }>((from, to) =>
    supabase.from("item_twins").select("item_id, twin_set").range(from, to)
  ).catch(() => []);

  const names = new Map(items.map((item) => [item.id, item.name]));
  const pictures: Picture[] = [];
  const fingerprinted = new Set<string>();
  for (const row of own) {
    const vector = row.model === EMBEDDING_MODEL ? parseVector(row.embedding) : null;
    if (!vector || !names.has(row.item_id)) continue;
    pictures.push({ key: `own:${row.item_id}`, itemId: row.item_id, vector: normalise(vector) });
    fingerprinted.add(row.item_id);
  }
  const trials: CheckData["trials"] = [];
  for (const row of confirmed) {
    const vector = row.model === EMBEDDING_MODEL ? parseVector(row.embedding) : null;
    if (!vector || !names.has(row.item_id)) continue;
    const picture = { key: `ref:${row.id}`, itemId: row.item_id, vector: normalise(vector) };
    pictures.push(picture);
    trials.push({ ...picture, photoPath: row.photo_path });
  }

  const sets = new Map<string, string[]>();
  for (const row of twinRows) sets.set(row.twin_set, [...(sets.get(row.twin_set) ?? []), row.item_id]);
  const twinsOf = new Map<string, string[]>();
  for (const members of sets.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    for (const id of sorted) twinsOf.set(id, sorted);
  }

  const unfingerprinted = items.filter((item) => item.photo_url && !fingerprinted.has(item.id)).length;
  return { pictures, trials, twinsOf, names, unfingerprinted };
}
