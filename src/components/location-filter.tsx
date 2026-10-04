"use client";

import { useRouter } from "next/navigation";
import { LocationPicker } from "@/components/location-picker";
import type { LocationNode } from "@/lib/locations";

/**
 * Narrowing the items list to one place, with the same walk-in picker used to
 * file an item.
 *
 * It replaced a row of chips, one per location, which on a phone ran to four
 * lines and pushed the first item 450px down the page — and which could
 * only ever have got worse, since every shelf added another chip. Choosing a
 * room shows everything inside it, boxes included (the page works that out
 * from the tree), which is what a person filtering to a room means.
 */
export function LocationFilter({
  nodes,
  value,
  hrefFor,
}: {
  nodes: LocationNode[];
  value: string;
  /** Where to go for a chosen location id ("" for every location). */
  hrefFor: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
      <LocationPicker
        nodes={nodes}
        value={value}
        onChange={(id) => router.push(hrefFor[id] ?? hrefFor[""])}
        label="Showing"
        noneLabel="Every location"
        placeholder="Type to find a room, shelf or box"
        selfLabel={(name) => (
          <>
            Everything in <span className="font-medium">{name}</span>
          </>
        )}
      />
    </div>
  );
}
