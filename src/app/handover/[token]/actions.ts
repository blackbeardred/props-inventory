"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NOT_SET_UP, handoverPath, isHandoverToken, schoolNotSetUp } from "@/lib/school";

/**
 * The new teacher takes the school theater over (migration 018). One step in
 * the database: the old teacher's account is removed and this one added as
 * owner, so the theater never has two. The link is used up.
 */
export async function acceptHandover(token: string, formData: FormData) {
  const back = (message: string) =>
    redirect(`${handoverPath(token)}?error=${encodeURIComponent(message)}`);
  if (!isHandoverToken(token)) back("This handover link isn’t working. Ask the teacher for a new one.");

  const name = String(formData.get("fullName") ?? "").replace(/\s+/g, " ").trim();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(handoverPath(token))}`);

  const { error } = await supabase.rpc("accept_school_handover", {
    p_token: token,
    member_name: name,
  });
  if (error) back(schoolNotSetUp(error) ? NOT_SET_UP : error.message);

  // The theater name and switcher in the header live in the shared layout.
  revalidatePath("/", "layout");
  redirect("/theatre?notice=handover-accepted");
}
