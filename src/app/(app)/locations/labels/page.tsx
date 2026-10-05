import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState, Notice, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { buildLocationChoices, type LocationNode } from "@/lib/locations";
import { originFromHost, isLocalHost } from "@/lib/origin";
import { qrSymbol } from "@/lib/qr-svg";
import { LabelSheet, type LabelData } from "./label-sheet";

export const metadata: Metadata = {
  title: "Box labels · Props & Costume Inventory",
};

/**
 * A sheet of labels, one per storage location, each carrying a QR code that
 * opens that location's contents.
 *
 * The point is the walk round the store: you are holding a box and you want to
 * know what is in it, and the alternative to a label is remembering which of
 * four "Shakespeare box" entries this one is. A phone camera reads these
 * without an app, so anyone in the company can use them, not only people with
 * a login — and the page it opens does ask for a login, so the label gives away
 * nothing to someone who finds the box.
 */
export default async function LabelsPage() {
  if (!supabaseConfigured) {
    return (
      <>
        <PageHeading title="Box labels" />
        <Notice title="Connect Supabase to print labels">
          Copy <code>.env.local.example</code> to <code>.env.local</code> and add
          your project URL and anon key, then reload.
        </Notice>
      </>
    );
  }

  const supabase = await createClient();

  const [locationsResult, itemsResult] = await Promise.all([
    supabase.from("locations").select("id, name, parent_location_id").order("name"),
    supabase.from("items").select("location_id"),
  ]);

  const rows = (locationsResult.data ?? []) as unknown as LocationNode[];

  const itemCounts = new Map<string, number>();
  for (const item of (itemsResult.data ?? []) as unknown as {
    location_id: string | null;
  }[]) {
    if (item.location_id) {
      itemCounts.set(item.location_id, (itemCounts.get(item.location_id) ?? 0) + 1);
    }
  }

  const withChildren = new Set(
    rows.map((row) => row.parent_location_id).filter((id): id is string => Boolean(id))
  );

  const host = (await headers()).get("host");
  const origin = originFromHost(host);

  const labels: LabelData[] = buildLocationChoices(rows).map((choice) => {
    const segments = choice.path.split(" / ");
    // Straight into the place in Inventory. Labels printed before carry
    // /items?location=…, which still redirects here, so no box needs a new
    // label.
    const url = `${origin}/inventory?place=${choice.id}`;
    return {
      id: choice.id,
      name: segments[segments.length - 1],
      within: segments.slice(0, -1).join(" / "),
      itemCount: itemCounts.get(choice.id) ?? 0,
      hasChildren: withChildren.has(choice.id),
      url,
      symbol: qrSymbol(url),
    };
  });

  return (
    <>
      {/* Off the paper: the first sheet should start with labels, not with a
          page title someone has to cut round. */}
      <div data-print-hide>
        <PageHeading
          title="Box labels"
          intro="A QR code per location. Print, cut along the dashed lines, and tape one to each box — scanning it opens that box’s contents."
          action={
            <Link
              href="/inventory"
              className="inline-flex min-h-11 items-center justify-center rounded-md md:min-h-0 border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              Back to inventory
            </Link>
          }
        />
      </div>

      {locationsResult.error ? (
        <Notice title="Couldn’t load locations">{locationsResult.error.message}</Notice>
      ) : labels.length === 0 ? (
        <EmptyState title="No locations to label yet">
          Add a room, shelf or box first with the{" "}
          <Link href="/locations/new" className="text-accent hover:underline">
            Add location
          </Link>{" "}
          button.
        </EmptyState>
      ) : (
        <>
          {/* A label printed from a dev server points at a dev server, which is
              nobody's phone. Worth saying before thirty of them come out. */}
          {isLocalHost(host ?? "") ? (
            <div data-print-hide className="mb-6">
              <Notice title="These codes point at this development server">
                They read as <code>{origin}/…</code>, which a phone on another
                network can’t open. Print the real labels from the deployed site.
              </Notice>
            </div>
          ) : null}

          <LabelSheet labels={labels} />
        </>
      )}
    </>
  );
}
