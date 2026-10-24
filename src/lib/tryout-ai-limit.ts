/**
 * The AI tagging allowance in a test copy (tryout links, migration 013).
 *
 * The sample items come tagged (migration 016). Of the items a tester adds,
 * the first ten are tagged by the model, as anywhere else, and keep that when
 * edited; anything past ten gets word tags (wordTags in tag-words.ts): free,
 * and enough for "oak" to find "wood". Someone with a real account, in any
 * theatre, has no limit.
 *
 * Counted from the items themselves, with no counter stored (Arjun chose no
 * schema change, Oct 2026): a tester's own items are the ones made after
 * their theatre was, since the sample ones are made with it. Deleting one of
 * the first ten frees its place.
 */

import type { createClient } from "@/lib/supabase/server";

export const TRYOUT_AI_ITEMS = 10;

type Client = Awaited<ReturnType<typeof createClient>>;

/** null: no limit. Otherwise, the ids of the items that may use the model. */
export type AiAllowance = Set<string> | null;

export async function aiAllowance(
  supabase: Client,
  user: { is_anonymous?: boolean } | null | undefined,
  orgId: string
): Promise<AiAllowance> {
  if (!user?.is_anonymous) return null;
  const { data: org } = await supabase.from("organizations").select("created_at").eq("id", orgId).maybeSingle();
  const since = (org as { created_at?: string } | null)?.created_at;
  if (!since) return new Set();
  const { data: own } = await supabase
    .from("items")
    .select("id")
    .eq("org_id", orgId)
    .gt("created_at", since)
    .order("created_at")
    .limit(TRYOUT_AI_ITEMS);
  return new Set(((own ?? []) as { id: string }[]).map((row) => row.id));
}

/** May this item (null: one about to be added) be tagged by the model? */
export function mayUseAI(allowance: AiAllowance, itemId: string | null): boolean {
  if (allowance === null) return true;
  return itemId === null ? allowance.size < TRYOUT_AI_ITEMS : allowance.has(itemId);
}
