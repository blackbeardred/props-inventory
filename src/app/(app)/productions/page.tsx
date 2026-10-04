import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  Badge,
  DataTable,
  EmptyState,
  Notice,
  PageHeading,
} from "@/components/ui";
import {
  PRODUCTION_STATUS_LABELS,
  formatDateRange,
  pluralize,
  type ProductionRow,
  type ProductionStatus,
} from "@/lib/inventory";

export const metadata: Metadata = {
  title: "Productions · Props & Costume Inventory",
};

const STATUS_TONE: Record<ProductionStatus, "neutral" | "muted" | "accent"> = {
  planning: "neutral",
  in_run: "accent",
  closed: "muted",
};

export default async function ProductionsPage() {
  if (!supabaseConfigured) {
    return (
      <>
        <PageHeading
          title="Productions"
          intro="Each show or run, and the pull lists that go with it."
        />
        <Notice title="Connect Supabase to load your productions">
          Copy <code>.env.local.example</code> to <code>.env.local</code> and add
          your project URL and anon key (Day 1, step 3), then reload.
        </Notice>
      </>
    );
  }

  const supabase = await createClient();

  const [productionsResult, pullListsResult] = await Promise.all([
    supabase
      .from("productions")
      .select("id, name, status, start_date, end_date, created_at")
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("pull_lists").select("production_id"),
  ]);

  const pullListCounts = new Map<string, number>();
  for (const pullList of (pullListsResult.data ?? []) as unknown as {
    production_id: string;
  }[]) {
    pullListCounts.set(
      pullList.production_id,
      (pullListCounts.get(pullList.production_id) ?? 0) + 1,
    );
  }

  const productions = (productionsResult.data ?? []) as unknown as ProductionRow[];

  return (
    <>
      <PageHeading
        title="Productions"
        intro={
          productions.length > 0
            ? `${pluralize(productions.length, "production")} on the books.`
            : "Each show or run, and the pull lists that go with it."
        }
        action={
          <Link
            href="/productions/new"
            className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 bg-accent px-4 py-2 font-body text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Add production
          </Link>
        }
      />

      {productionsResult.error ? (
        <Notice title="Couldn’t load productions">
          {productionsResult.error.message}
        </Notice>
      ) : productions.length === 0 ? (
        <EmptyState title="No productions yet">
          Add your first show or run with the{" "}
          <Link href="/productions/new" className="text-accent hover:underline">
            Add production
          </Link>{" "}
          button above.
        </EmptyState>
      ) : (
        <>
        {/* Phones get cards: the table scrolled sideways there, with Edit
            off the edge and the dates wrapped onto three lines. */}
        <ul className="space-y-2.5 md:hidden">
          {productions.map((production) => {
            const lists = pullListCounts.get(production.id) ?? 0;
            return (
              <li key={production.id} className="rounded-lg border border-rule bg-surface">
                <Link
                  href={`/productions/${production.id}`}
                  className="block px-4 pb-2 pt-3"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-display text-[17px] font-semibold leading-tight text-foreground">
                      {production.name}
                    </span>
                    <Badge tone={STATUS_TONE[production.status] ?? "neutral"}>
                      {PRODUCTION_STATUS_LABELS[production.status] ?? production.status}
                    </Badge>
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-muted">
                    {formatDateRange(production.start_date, production.end_date)} ·{" "}
                    {pluralize(lists, "pull list")}
                  </span>
                </Link>
                <div className="flex justify-end border-t border-dashed border-rule px-2">
                  <Link
                    href={`/productions/${production.id}/edit`}
                    className="inline-flex min-h-11 items-center px-2 font-body text-sm text-muted hover:text-foreground"
                  >
                    Edit
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
        <DataTable columns={["Production", "Status", "Dates", "Pull lists", ""]}>
          {productions.map((production) => (
            <tr key={production.id} className="border-b border-rule align-top">
              <td className="px-3 py-3 font-body text-sm text-foreground">
                <Link
                  href={`/productions/${production.id}`}
                  className="hover:text-accent hover:underline"
                >
                  {production.name}
                </Link>
              </td>
              <td className="px-3 py-3">
                <Badge tone={STATUS_TONE[production.status] ?? "neutral"}>
                  {PRODUCTION_STATUS_LABELS[production.status] ??
                    production.status}
                </Badge>
              </td>
              <td className="px-3 py-3 font-body text-sm text-muted">
                {formatDateRange(production.start_date, production.end_date)}
              </td>
              <td className="px-3 py-3 font-body text-sm text-muted">
                {pullListCounts.get(production.id) ?? 0}
              </td>
              <td className="px-3 py-3 font-body text-sm text-right">
                <Link
                  href={`/productions/${production.id}/edit`}
                  className="text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
        </div>
        </>
      )}
    </>
  );
}
