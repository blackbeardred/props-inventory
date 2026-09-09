import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { Notice, PageHeading } from "@/components/ui";
import { searchItemsLive } from "./actions";
import { SearchBar } from "./search-bar";

export const metadata: Metadata = {
  title: "Search · Props & Costume Inventory",
};

type SearchPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  if (!supabaseConfigured) {
    return (
      <>
        <PageHeading
          title="Search"
          intro="Find any prop or costume by name, description, or location."
        />
        <Notice title="Connect Supabase to search your inventory">
          Copy <code>.env.local.example</code> to <code>.env.local</code> and add
          your project URL and anon key (Day 1, step 3), then reload.
        </Notice>
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const initialText = first(resolvedSearchParams.q)?.trim() ?? "";
  const locationIdsParam = first(resolvedSearchParams.locations);
  const initialLocationIds = locationIdsParam
    ? locationIdsParam.split(",").filter(Boolean)
    : [];

  const supabase = await createClient();
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name")
    .order("name");
  const locations = (locationRows ?? []) as unknown as {
    id: string;
    name: string;
  }[];

  const initialChips = locations.filter((location) =>
    initialLocationIds.includes(location.id)
  );

  // Run the very first search on the server, from the URL — so a shared or
  // bookmarked search link shows results immediately, with no client-side
  // round trip on load. Everything after that (as the user keeps typing)
  // is handled live by the client component.
  const hasInitialQuery = Boolean(initialText) || initialChips.length > 0;
  const initialResult = hasInitialQuery
    ? await searchItemsLive(
        initialText,
        initialChips.map((location) => location.id)
      )
    : { items: [], error: null };

  return (
    <>
      <PageHeading
        title="Search"
        intro="Find any prop or costume by name, description, or location."
      />
      <SearchBar
        locations={locations}
        initialText={initialText}
        initialChips={initialChips}
        initialItems={initialResult.items}
        initialError={initialResult.error}
      />
    </>
  );
}
