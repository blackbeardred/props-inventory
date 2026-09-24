"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Category, Condition } from "@/lib/inventory";
import { MAX_IMPORT_ROWS } from "@/lib/csv";

const CATEGORIES: Category[] = ["prop", "costume"];
const CONDITIONS: Condition[] = ["new", "good", "fair", "needs_repair"];

// Inserted in batches rather than one statement per row: a few hundred items
// is one or two round trips instead of a few hundred.
const CHUNK_SIZE = 200;

type IncomingRow = {
  line?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  quantity?: unknown;
  condition?: unknown;
  locationName?: unknown;
  tags?: unknown;
};

type CleanRow = {
  line: number;
  name: string;
  category: Category;
  description: string | null;
  quantity: number;
  condition: Condition | null;
  locationName: string | null;
  tags: string[];
};

function fail(message: string): never {
  redirect(`/items/import?error=${encodeURIComponent(message)}`);
}

/**
 * Re-checks a row the browser already validated. The preview exists to help
 * the user; this exists because anything arriving from a client is a claim,
 * not a fact. Returns null for a row that can't be saved.
 */
function clean(raw: IncomingRow): CleanRow | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 200) return null;

  const quantity =
    typeof raw.quantity === "number" && Number.isInteger(raw.quantity)
      ? raw.quantity
      : 1;
  if (quantity < 1) return null;

  const category =
    typeof raw.category === "string" && CATEGORIES.includes(raw.category as Category)
      ? (raw.category as Category)
      : "prop";

  const condition =
    typeof raw.condition === "string" && CONDITIONS.includes(raw.condition as Condition)
      ? (raw.condition as Condition)
      : null;

  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 2000)
      : null;

  const locationName =
    typeof raw.locationName === "string" && raw.locationName.trim()
      ? raw.locationName.trim()
      : null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t && t.length <= 40)
        .slice(0, 20)
    : [];

  const line = typeof raw.line === "number" ? raw.line : 0;

  return { line, name, category, description, quantity, condition, locationName, tags };
}

export async function importItems(formData: FormData) {
  const payload = String(formData.get("rows") ?? "");
  const createMissingLocations = formData.get("createLocations") === "on";

  if (!payload) {
    fail("That import didn’t include any rows.");
  }

  let incoming: unknown;
  try {
    incoming = JSON.parse(payload);
  } catch {
    fail("Couldn’t read the rows from that file. Try uploading it again.");
  }

  if (!Array.isArray(incoming)) {
    fail("Couldn’t read the rows from that file. Try uploading it again.");
  }

  if (incoming.length > MAX_IMPORT_ROWS) {
    fail(
      `That’s more than ${MAX_IMPORT_ROWS} rows. Split the file and import it in parts.`
    );
  }

  const rows = (incoming as IncomingRow[])
    .map(clean)
    .filter((row): row is CleanRow => row !== null);

  if (rows.length === 0) {
    fail("None of those rows could be imported — every one was missing a name or had an unusable quantity.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/items/import");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active_org_id) {
    redirect("/onboarding");
  }

  const orgId = profile.active_org_id as string;

  // ── Resolve location names to ids ──────────────────────────────────────
  const { data: existingLocations } = await supabase
    .from("locations")
    .select("id, name");

  const locationIdByName = new Map<string, string>();
  for (const location of (existingLocations ?? []) as { id: string; name: string }[]) {
    locationIdByName.set(location.name.trim().toLowerCase(), location.id);
  }

  const wanted = new Set<string>();
  for (const row of rows) {
    if (row.locationName) wanted.add(row.locationName.toLowerCase());
  }

  const missing = [...wanted].filter((name) => !locationIdByName.has(name));
  let locationsCreated = 0;

  if (createMissingLocations && missing.length > 0) {
    // Insert under the spelling the file used, not the lowercased key.
    const originals = new Map<string, string>();
    for (const row of rows) {
      if (row.locationName) {
        originals.set(row.locationName.toLowerCase(), row.locationName);
      }
    }

    const { data: created, error: locationError } = await supabase
      .from("locations")
      .insert(
        missing.map((key) => ({ org_id: orgId, name: originals.get(key) ?? key }))
      )
      .select("id, name");

    if (locationError) {
      fail(`Couldn’t create the missing locations: ${locationError.message}`);
    }

    for (const location of (created ?? []) as { id: string; name: string }[]) {
      locationIdByName.set(location.name.trim().toLowerCase(), location.id);
    }
    locationsCreated = created?.length ?? 0;
  }

  // ── Insert the items ───────────────────────────────────────────────────
  let imported = 0;
  let unmatchedLocations = 0;

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);

    const payloadChunk = chunk.map((row) => {
      const locationId = row.locationName
        ? (locationIdByName.get(row.locationName.toLowerCase()) ?? null)
        : null;

      if (row.locationName && !locationId) unmatchedLocations += 1;

      return {
        org_id: orgId,
        name: row.name,
        category: row.category,
        description: row.description,
        quantity: row.quantity,
        condition: row.condition,
        location_id: locationId,
        // No photo, so no AI tags to detect; anything from a "tags" column is
        // the user's own writing and belongs in manual_tags.
        manual_tags: row.tags,
      };
    });

    const { error, count } = await supabase
      .from("items")
      .insert(payloadChunk, { count: "exact" });

    if (error) {
      // Earlier chunks are already saved — say so rather than implying the
      // whole import rolled back, so the user doesn't import twice.
      fail(
        `Imported ${imported} item${imported === 1 ? "" : "s"} before this failed: ${error.message}. Nothing after that was saved.`
      );
    }

    imported += count ?? payloadChunk.length;
  }

  const params = new URLSearchParams({ imported: String(imported) });
  const skipped = (incoming as IncomingRow[]).length - rows.length;
  if (skipped > 0) params.set("skipped", String(skipped));
  if (locationsCreated > 0) params.set("locations", String(locationsCreated));
  if (unmatchedLocations > 0) params.set("unmatched", String(unmatchedLocations));

  redirect(`/items?${params.toString()}`);
}
