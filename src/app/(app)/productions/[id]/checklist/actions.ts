"use server";

/**
 * Ticking a pull list off while walking the storage rooms.
 *
 * Checking a row records that a person stood in front of the shelf, and — since
 * they're holding the prop — marks it pulled as well. Unchecking undoes only
 * the check: "I ticked that by mistake" shouldn't quietly put a prop back into
 * storage that's already in someone's hands.
 *
 * Clearing is the third way out, for a prop that turns out not to be wanted.
 * It silences the warning without claiming the thing was pulled, which is what
 * makes the warning trustworthy for everything else.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CheckState } from "@/lib/checklist";

export type CheckOutcome = { ok: true } | { ok: false; error: string };

const STATES: CheckState[] = ["open", "checked", "cleared"];

export async function setCheckState(
  productionId: string,
  pullListItemId: string,
  state: CheckState
): Promise<CheckOutcome> {
  if (!STATES.includes(state)) {
    return { ok: false, error: "That isn’t a state a row can be in." };
  }
  if (!pullListItemId) {
    return { ok: false, error: "Nothing to update." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/productions/${productionId}/checklist`);

  // Row-level security keeps this to the caller's own organization; the
  // update is written in terms the reader can check against the column
  // comments rather than spread across three branches.
  const patch: Record<string, unknown> = {
    check_state: state,
    checked_at: state === "open" ? null : new Date().toISOString(),
    checked_by: state === "open" ? null : user.id,
  };

  if (state === "checked") {
    patch.status = "pulled";
  }

  const { error } = await supabase
    .from("pull_list_items")
    .update(patch)
    .eq("id", pullListItemId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/productions/${productionId}/checklist`);
  revalidatePath(`/productions/${productionId}/issues`);
  revalidatePath(`/productions/${productionId}`);
  revalidatePath("/items");

  return { ok: true };
}
