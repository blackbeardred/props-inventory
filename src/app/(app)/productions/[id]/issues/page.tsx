import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, Notice, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { findPullIssues } from "@/lib/checklist";
import { loadChecklistRows } from "@/lib/checklist-data";
import { IssueList } from "./issue-list";

export const metadata: Metadata = {
  title: "Pull issues · Props & Costume Inventory",
};

type IssuesPageProps = {
  params: Promise<{ id: string }>;
};

/**
 * What got walked past.
 *
 * Someone pulls a box at a time. Once they've started a box and then checked
 * something in a different one, whatever is still open in the first box didn't
 * make it into the crate — and nobody will notice until the item is wanted on
 * stage. This is that list, newest abandonment first, because that's the box
 * still worth walking back to.
 */
export default async function PullIssuesPage({ params }: IssuesPageProps) {
  if (!supabaseConfigured) redirect("/productions");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: production }, { data: lists }] = await Promise.all([
    supabase.from("productions").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("pull_lists").select("id, name").eq("production_id", id).order("created_at"),
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
  const listIds = ((lists ?? []) as unknown as { id: string }[]).map((list) => list.id);

  const { rows, locations } = await loadChecklistRows(supabase, listIds);
  const issues = findPullIssues(rows, locations);

  return (
    <>
      <PageHeading
        title="Pull issues"
        intro={typedProduction.name}
        action={
          <span className="flex flex-wrap gap-2">
            <Link
              href={`/productions/${typedProduction.id}/checklist`}
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Checklist
            </Link>
            <Link
              href={`/productions/${typedProduction.id}`}
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Back to production
            </Link>
          </span>
        }
      />

      {issues.length === 0 ? (
        <EmptyState title="Nothing left behind">
          Anything still to pull is in a box nobody has started yet, or in the
          one being worked on now. This page fills up when checking moves on to
          another box with things still open in the last one.
        </EmptyState>
      ) : (
        <div className="max-w-3xl">
          <p className="mb-4 font-body text-sm text-muted">
            {issues.length === 1
              ? "One prop was left behind when checking moved to another box."
              : `${issues.length} props were left behind when checking moved to another box.`}{" "}
            Clear anything you decided not to use.
          </p>
          <IssueList productionId={typedProduction.id} issues={issues} />
        </div>
      )}
    </>
  );
}
