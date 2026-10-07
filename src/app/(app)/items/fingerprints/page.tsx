import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { FingerprintRunner } from "./fingerprint-runner";
import { RecognitionCheck } from "./recognition-check";

export const metadata: Metadata = { title: "Photo fingerprints · Props & Costume Inventory" };

export default async function FingerprintsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/items/fingerprints");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();

  const orgId = (profile?.active_org_id as string | undefined) ?? null;

  return (
    <>
      <PageHeading
        title="Photo fingerprints"
        intro="So a photograph of the prop table can recognise the things you already own, rather than guessing from their names."
      />
      {orgId ? (
        <>
          <FingerprintRunner orgId={orgId} />
          <RecognitionCheck />
        </>
      ) : (
        <p className="font-body text-sm text-foreground/70">
          You&rsquo;re not in an organization yet.
        </p>
      )}
    </>
  );
}
