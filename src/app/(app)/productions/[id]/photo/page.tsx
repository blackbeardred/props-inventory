import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { StagePhoto } from "./stage-photo";

export const metadata: Metadata = {
  title: "Mark from a photo · Props & Costume Inventory",
};

// Looking at a photo and searching the inventory for every thing in it takes
// longer than a page render normally gets.
export const maxDuration = 60;

type PhotoPageProps = {
  params: Promise<{ id: string }>;
};

export default async function StagePhotoPage({ params }: PhotoPageProps) {
  if (!supabaseConfigured) redirect("/productions");

  const { id } = await params;
  const supabase = await createClient();

  const { data: production } = await supabase
    .from("productions")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!production) {
    return (
      <>
        <PageHeading title="Production not found" />
        <Notice title="This production isn’t available">
          It may have been deleted, or you may not have access to it.
        </Notice>
      </>
    );
  }

  const typed = production as unknown as { id: string; name: string };

  return (
    <>
      <PageHeading
        title="Mark from a photo"
        intro={typed.name}
        action={
          <Link
            href={`/productions/${typed.id}`}
            className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
          >
            Back to production
          </Link>
        }
      />

      <div className="max-w-2xl">
        <StagePhoto productionId={typed.id} />
      </div>
    </>
  );
}
