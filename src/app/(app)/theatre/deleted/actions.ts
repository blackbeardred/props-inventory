"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserAndProfile } from "@/lib/auth";
import { deleteForever, restoreRecord, type RestoreResult } from "@/lib/recently-deleted";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE = "/theatre/deleted";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

/** Restore, from the Recently Deleted page. */
export async function restoreDeleted(formData: FormData) {
  const recordId = String(formData.get("recordId") ?? "");
  if (!ID.test(recordId)) back({ error: "That wasn’t recognised." });
  const supabase = await createClient();
  const result = await restoreRecord(supabase, recordId);
  if (!result.ok) back({ error: result.message });
  back({ restored: result.label, href: result.href, ...(result.notes.length ? { notes: result.notes.join("\n") } : {}) });
}

/** Undo, from the bar that shows right after a delete. Returns rather than
 *  redirects: the person stays on the page they deleted from. */
export async function undoDelete(recordId: string): Promise<RestoreResult> {
  if (!ID.test(recordId)) return { ok: false, message: "That wasn’t recognised." };
  const supabase = await createClient();
  return restoreRecord(supabase, recordId);
}

/** Gone for good before its 30 days are up. Owners only (the user's choice). */
export async function deleteDeletedForever(formData: FormData) {
  const recordId = String(formData.get("recordId") ?? "");
  if (!ID.test(recordId)) back({ error: "That wasn’t recognised." });
  const { profile } = await getUserAndProfile();
  if (profile?.role !== "owner") back({ error: "Only an owner of this theatre can delete things forever." });
  const supabase = await createClient();
  const result = await deleteForever(supabase, recordId);
  if (!result.ok) back({ error: "That’s no longer in Recently Deleted." });
  back({ forever: result.label ?? "It" });
}
