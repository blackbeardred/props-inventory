"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens a tryout link (migration 013): signs this browser in without an
 * account — a Supabase anonymous user — unless someone is already signed in,
 * then joins the link's own test theatre as its owner.
 *
 * A server action behind a button rather than something the page does on
 * load, so the chat apps that fetch a link to draw its preview don't make an
 * anonymous user and a membership every time the link is pasted.
 */
export async function openTryout(token: string) {
  const back = (message: string): never =>
    redirect(`/try/${encodeURIComponent(token)}?error=${encodeURIComponent(message)}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      // The Supabase switch that allows this is off, or the rate limit hit.
      back(
        /anonymous/i.test(error.message)
          ? "Test links aren’t switched on yet. Let Arjun know, and try again in a little while."
          : `Couldn’t open your test copy: ${error.message}`
      );
    }
  }

  const { error } = await supabase.rpc("join_tryout", { p_token: token });
  if (error) back(error.message);

  revalidatePath("/", "layout");
  redirect("/inventory");
}
