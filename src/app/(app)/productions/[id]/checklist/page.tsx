import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, Notice, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { groupByRoomAndContainer, findPullIssues } from "@/lib/checklist";
import { loadChecklistRows } from "@/lib/checklist-data";
import { ChecklistView } from "./checklist-view";

export const metadata: Metadata = {
  title: "Checklist · Props & Costume Inventory",
};

type ChecklistPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ChecklistPage({ params, searchParams }: ChecklistPageProps) {
  if (!supabaseConfigured) redirect("/productions");

  const { id } = await params;
  const listId = first((await searchParams).list);

  const supabase = await createClient();

  const [{ data: production }, { data: lists }] = await Promise.all([
    supabase.from("productions").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("pull_lists")
      .select("id, name")
      .eq("production_id", id)
      .order("created_at"),
  ]);

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

  const typedProduction = production as unknown as { id: string; name: string };
  const allLists = (lists ?? []) as unknown as { id: string; name: string }[];

  // One list at a time: "Act 1 props" and "Costumes" are usually separate
  // trips, and folding them together loses a division someone made on purpose.
  const activeList = allLists.find((list) => list.id === listId) ?? allLists[0];

  const { rows, locations, photoPaths, photoPathByRowId } = await loadChecklistRows(
    supabase,
    activeList ? [activeList.id] : []
  );

  // Issues are counted across every list, because walking away from a box is
  // a fact about the whole production, not about one list.
  const acrossProduction = await loadChecklistRows(
    supabase,
    allLists.map((list) => list.id)
  );
  const issueCount = findPullIssues(acrossProduction.rows, acrossProduction.locations).length;

  const photoUrlByRowId: Record<string, string> = {};
  if (photoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(photoPaths, SIGNED_URL_TTL_SECONDS);
    const urlByPath = new Map(
      ((signed ?? []) as { path?: string | null; signedUrl: string }[])
        .filter((entry) => entry.signedUrl)
        .map((entry) => [entry.path ?? "", entry.signedUrl])
    );
    for (const [rowId, path] of photoPathByRowId) {
      const url = urlByPath.get(path);
      if (url) photoUrlByRowId[rowId] = url;
    }
  }

  const rooms = groupByRoomAndContainer(rows, locations);

  return (
    <>
      <PageHeading
        title="Checklist"
        intro={
          activeList
            ? `${typedProduction.name} · ${activeList.name}`
            : typedProduction.name
        }
        action={
          <span className="flex flex-wrap gap-2">
            <Link
              href={`/productions/${typedProduction.id}/issues`}
              className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 font-body text-sm font-medium transition-colors ${
                issueCount > 0
                  ? "bg-danger/15 text-danger-ink hover:bg-danger/25"
                  : "border border-rule text-foreground hover:bg-surface"
              }`}
            >
              Pull issues
              {issueCount > 0 ? (
                <span className="rounded-full bg-danger-ink px-1.5 font-body text-xs text-background">
                  {issueCount}
                </span>
              ) : null}
            </Link>
            <Link
              href={`/productions/${typedProduction.id}`}
              className="inline-flex items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Back to production
            </Link>
          </span>
        }
      />

      {allLists.length > 1 ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {allLists.map((list) => (
            <Link
              key={list.id}
              href={`/productions/${typedProduction.id}/checklist?list=${list.id}`}
              className={`rounded-full border px-3 py-1 font-body text-sm transition-colors ${
                list.id === activeList?.id
                  ? "border-accent bg-accent text-background"
                  : "border-rule text-muted hover:text-foreground"
              }`}
            >
              {list.name}
            </Link>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="Nothing on this list yet">
          Add items to the pull list and they’ll appear here, grouped by the
          room and box they live in.
        </EmptyState>
      ) : (
        <div className="max-w-3xl">
          <ChecklistView
            productionId={typedProduction.id}
            rooms={rooms}
            photoUrlByRowId={photoUrlByRowId}
          />
        </div>
      )}
    </>
  );
}
