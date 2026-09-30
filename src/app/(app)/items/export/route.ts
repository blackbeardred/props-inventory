/**
 * The inventory, as a spreadsheet you can take away.
 *
 * Deliberately the importer's own format: what comes out of here goes back in
 * through /items/import unchanged, columns and all. That's what makes it a
 * copy of the inventory rather than a one-way report — useful for an insurance
 * list, for handing a show's props to another company, and for not feeling
 * locked in to this app.
 *
 * Columns an import brought in that this app has no field for come back out
 * under their original headings, so a round trip doesn't quietly lose the
 * donor, the acquisition date or the inventory number.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { buildLocationChoices, type LocationNode } from "@/lib/locations";
import type { ItemRow } from "@/lib/inventory";
import { buildExportTable } from "@/lib/export";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";

/** Long enough to download the pictures, short enough not to be a public link. */
const PHOTO_LINK_TTL_SECONDS = 60 * 60 * 24;

/** Beyond this the download stops being a spreadsheet someone opens. */
const MAX_ROWS = 10000;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/items", request.url));
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");
  const withPhotos = url.searchParams.get("photos") !== "0";

  let query = supabase
    .from("items")
    .select(
      "id, name, category, description, photo_url, quantity, condition, location_id, created_at, auto_tags, import_data"
    )
    .order("name")
    .limit(MAX_ROWS);

  if (locationId) query = query.eq("location_id", locationId);

  const [{ data: itemRows, error }, { data: locationRows }] = await Promise.all([
    query,
    supabase.from("locations").select("id, name, parent_location_id"),
  ]);

  if (error) {
    return new NextResponse(`Couldn't export: ${error.message}`, { status: 500 });
  }

  const items = (itemRows ?? []) as unknown as (ItemRow & {
    import_data: Record<string, string> | null;
  })[];

  // Full paths, so "Shakespeare box" says which room it's in — and so the
  // importer can match it back to the same place.
  const pathById = new Map(
    buildLocationChoices((locationRows ?? []) as unknown as LocationNode[]).map((choice) => [
      choice.id,
      choice.path,
    ])
  );

  const photoUrlByPath = new Map<string, string>();
  if (withPhotos) {
    const paths = items
      .map((item) => item.photo_url)
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrls(paths, PHOTO_LINK_TTL_SECONDS);
      for (const entry of signed ?? []) {
        if (entry.signedUrl && !entry.error) {
          photoUrlByPath.set(entry.path ?? "", entry.signedUrl);
        }
      }
    }
  }

  const table = buildExportTable(items, {
    pathById,
    photoUrlByPath: withPhotos ? photoUrlByPath : undefined,
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `inventory-${today}.csv`;

  // A byte-order mark, because Excel otherwise reads a UTF-8 file as Latin-1
  // and turns every £ and every accent into mojibake.
  const body = `﻿${toCsv(table)}`;

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // It's a snapshot of live data; a cached copy would be a lie.
      "cache-control": "no-store",
    },
  });
}
