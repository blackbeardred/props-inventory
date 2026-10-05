import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, Notice, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  PICTURES_PER_LABEL,
  planTrainingSet,
  type TrainingItem,
  type TrainingPicture,
  type TrainingTwin,
} from "@/lib/training-set";
import { TrainingSetExport } from "./training-set-export";

export const metadata: Metadata = { title: "Training set · Props & Costume Inventory" };

// Always read fresh: it's a snapshot of what's been confirmed so far.
export const dynamic = "force-dynamic";

/**
 * Every confirmed picture, as a download a custom-recognition service can
 * train from (src/lib/training-set.ts). The layout is worked out here; the
 * browser fetches the photos and zips them, because the bytes go straight
 * from storage to the person's computer that way.
 */
export default async function TrainingSetPage() {
  if (!supabaseConfigured) redirect("/inventory");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/items/training-set");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = (profile?.active_org_id as string | undefined) ?? null;
  if (!orgId) redirect("/onboarding");

  const [{ data: org }, { data: items }, pictures, { data: twins }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    supabase.from("items").select("id, name, category, photo_url"),
    supabase.from("item_reference_photos").select("id, item_id, photo_path, source, similarity"),
    supabase.from("item_twins").select("item_id, twin_set"),
  ]);

  const heading = (
    <PageHeading
      title="Training set"
      intro="Every picture people have confirmed, sorted into one folder per prop, ready for a custom recognition service to learn from."
      action={
        <Link
          href="/theatre#photos"
          className="inline-flex min-h-11 items-center font-body text-sm text-accent-ink hover:underline md:min-h-0"
        >
          ← Theatre
        </Link>
      }
    />
  );

  if (pictures.error) {
    return (
      <>
        {heading}
        <Notice title="Confirmed pictures aren’t set up yet">
          Migration 008 needs running in Supabase (supabase/migrations/008_item_reference_photos.sql).
          Until it is, no pictures are kept to export.
        </Notice>
      </>
    );
  }

  const rows = {
    items: (items ?? []) as TrainingItem[],
    pictures: (pictures.data ?? []) as TrainingPicture[],
    twins: (twins ?? []) as TrainingTwin[],
  };
  const confirmedOnly = planTrainingSet(rows.items, rows.pictures, rows.twins);
  const everything = planTrainingSet(rows.items, rows.pictures, rows.twins, { includeUnconfirmed: true });

  return (
    <>
      {heading}
      <div className="max-w-2xl space-y-5">
        {rows.pictures.length === 0 ? (
          <EmptyState title="No confirmed pictures yet">
            They’re kept whenever someone taps “That’s it” on{" "}
            <Link href="/items/lookalike" className="text-accent-ink hover:underline">
              Find by photo
            </Link>
            , or ticks a match on a production’s prop-table photo. You can still download every
            item’s own photo below.
          </EmptyState>
        ) : null}

        <TrainingSetExport
          theatre={(org as { name?: string } | null)?.name ?? "your theatre"}
          confirmedOnly={confirmedOnly}
          everything={everything}
          perLabel={PICTURES_PER_LABEL}
        />
      </div>
    </>
  );
}
