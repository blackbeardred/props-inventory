import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, EmptyState, Notice, PageHeading } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getUserAndProfile } from "@/lib/auth";
import { formatDate } from "@/lib/inventory";
import { listDeleted, purgeExpired } from "@/lib/recently-deleted";
import { KEEP_DAYS, KIND_LABELS, daysLeft, deletedAgo, expiresAt } from "@/lib/deleted-records";
import { deleteDeletedForever, restoreDeleted } from "./actions";

export const metadata: Metadata = {
  title: "Recently deleted · Props & Costume Inventory",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Everything deleted in the last 30 days, newest first, each with Restore.
 *
 * Opening the page is also what clears anything past its 30 days (and the
 * photos only those snapshots still pointed at), so there's no scheduled job
 * to keep running. Deleting forever, before the time is up, is for owners.
 */
export default async function RecentlyDeletedPage({ searchParams }: PageProps) {
  if (!supabaseConfigured) redirect("/");
  const { user, profile } = await getUserAndProfile();
  if (!user) redirect("/login?next=/theatre/deleted");
  if (!profile) redirect("/onboarding");

  const params = await searchParams;
  const restored = first(params.restored);
  const href = first(params.href);
  const notes = first(params.notes)?.split("\n").filter(Boolean) ?? [];
  const forever = first(params.forever);
  const error = first(params.error);

  const supabase = await createClient();
  await purgeExpired(supabase);
  const { records, missingTable } = await listDeleted(supabase);
  const isOwner = profile.role === "owner";
  const now = new Date();

  return (
    <>
      <PageHeading
        title="Recently deleted"
        intro={`Anything deleted in the last ${KEEP_DAYS} days. Restoring puts it back with everything that went with it.`}
        action={
          <Link
            href="/theatre"
            className="inline-flex min-h-11 items-center font-body text-sm text-accent-ink hover:underline md:min-h-0"
          >
            ← Theatre
          </Link>
        }
      />

      <div className="max-w-3xl space-y-4">
        {restored ? (
          <Notice title={`Restored ${restored}`}>
            {notes.length ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
            {href?.startsWith("/") && !href.startsWith("//") ? (
              <Link href={href} className="mt-1 inline-flex min-h-11 items-center text-accent-ink hover:underline md:min-h-0">
                Go to it →
              </Link>
            ) : null}
          </Notice>
        ) : null}
        {forever ? <Notice title={`${forever} is gone for good`} /> : null}
        {error ? <Notice title="That didn’t go through">{error}</Notice> : null}

        {missingTable ? (
          <Notice title="Recently Deleted isn’t set up yet">
            Migration 007 needs running in Supabase (supabase/migrations/007_recently_deleted.sql).
            Until it is, deleting anything is refused rather than lost.
          </Notice>
        ) : records.length === 0 ? (
          <EmptyState title="Nothing deleted lately">
            Items, places, productions, pull lists and pull-list lines you delete wait here for{" "}
            {KEEP_DAYS} days in case you want them back.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule">
            {records.map((record) => {
              const left = daysLeft(record.deleted_at, now);
              return (
                <li
                  key={record.id}
                  data-deleted-record
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-4 py-3"
                >
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone="muted">{KIND_LABELS[record.kind] ?? record.kind}</Badge>
                      <span className="font-body text-sm font-medium text-foreground">{record.label}</span>
                    </p>
                    {record.detail ? (
                      <p className="mt-0.5 font-mono text-[11px] text-muted">{record.detail}</p>
                    ) : null}
                    <p className="mt-0.5 font-body text-xs text-muted">
                      Deleted {deletedAgo(record.deleted_at, now)}
                      {record.profiles?.full_name ? ` by ${record.profiles.full_name}` : ""} ·{" "}
                      <span title={formatDate(expiresAt(record.deleted_at).toISOString())}>
                        {left <= 1 ? "gone for good tomorrow" : `gone for good in ${left} days`}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={restoreDeleted}>
                      <input type="hidden" name="recordId" value={record.id} />
                      <SubmitButton variant="ghost" pendingText="Restoring…">
                        Restore
                      </SubmitButton>
                    </form>
                    {isOwner ? (
                      <form action={deleteDeletedForever}>
                        <input type="hidden" name="recordId" value={record.id} />
                        <DeleteButton
                          confirmMessage={`Delete "${record.label}" forever? It can't be restored after this.`}
                        >
                          Delete forever
                        </DeleteButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!isOwner && records.length ? (
          <p className="font-body text-xs text-muted">
            Only an owner can delete something forever before its {KEEP_DAYS} days are up.
          </p>
        ) : null}
      </div>
    </>
  );
}
