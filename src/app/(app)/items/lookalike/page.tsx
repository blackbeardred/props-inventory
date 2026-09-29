import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { LookalikeSearch } from "./lookalike-search";

export const metadata: Metadata = { title: "Find by photo" };

export default async function LookalikePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/items/lookalike");

  return (
    <>
      <PageHeading
        title="Find by photo"
        intro="Take a picture of something and see which of your items it looks like."
      />
      <LookalikeSearch />
    </>
  );
}
