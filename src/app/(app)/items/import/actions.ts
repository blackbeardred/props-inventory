"use server";

import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Category, Condition } from "@/lib/inventory";
import { MAX_IMPORT_ROWS } from "@/lib/csv";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";

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
  photoUrl?: unknown;
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
  photoUrl: string | null;
};

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

  // Re-checked rather than trusted: this becomes a server-side fetch.
  const photoUrl =
    typeof raw.photoUrl === "string" && /^https?:\/\/\S+$/i.test(raw.photoUrl.trim())
      ? raw.photoUrl.trim()
      : null;

  return {
    line,
    name,
    category,
    description,
    quantity,
    condition,
    locationName,
    tags,
    photoUrl,
  };
}

export type ImportOutcome =
  | {
      ok: true;
      imported: number;
      skipped: number;
      locationsCreated: number;
      unmatchedLocations: number;
      /** Rows that named a picture, to be fetched in batches afterwards. */
      photoJobs: PhotoJob[];
    }
  | { ok: false; error: string };

/**
 * Creates the items. Returns rather than redirecting, because the wizard has
 * more to do afterwards — fetching any photos the sheet linked to — and needs
 * to know what landed.
 */
export async function importItems(
  rowsJson: string,
  createMissingLocations: boolean
): Promise<ImportOutcome> {
  if (!rowsJson) {
    return { ok: false, error: "That import didn’t include any rows." };
  }

  let incoming: unknown;
  try {
    incoming = JSON.parse(rowsJson);
  } catch {
    return {
      ok: false,
      error: "Couldn’t read the rows from that file. Try uploading it again.",
    };
  }

  if (!Array.isArray(incoming)) {
    return {
      ok: false,
      error: "Couldn’t read the rows from that file. Try uploading it again.",
    };
  }

  if (incoming.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `That’s more than ${MAX_IMPORT_ROWS} rows. Split the file and import it in parts.`,
    };
  }

  const rows = (incoming as IncomingRow[])
    .map(clean)
    .filter((row): row is CleanRow => row !== null);

  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "None of those rows could be imported — every one was missing a name or had an unusable quantity.",
    };
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
      return {
        ok: false,
        error: `Couldn’t create the missing locations: ${locationError.message}`,
      };
    }

    for (const location of (created ?? []) as { id: string; name: string }[]) {
      locationIdByName.set(location.name.trim().toLowerCase(), location.id);
    }
    locationsCreated = created?.length ?? 0;
  }

  // ── Insert the items ───────────────────────────────────────────────────
  let imported = 0;
  let unmatchedLocations = 0;
  const photoJobs: PhotoJob[] = [];

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);

    const payloadChunk = chunk.map((row) => {
      const locationId = row.locationName
        ? (locationIdByName.get(row.locationName.toLowerCase()) ?? null)
        : null;

      if (row.locationName && !locationId) unmatchedLocations += 1;

      // Ids are minted here rather than by the database, so the photos that
      // still need fetching can be matched to their items without reading
      // them back.
      const id = randomUUID();
      if (row.photoUrl) photoJobs.push({ itemId: id, url: row.photoUrl });

      return {
        id,
        org_id: orgId,
        name: row.name,
        category: row.category,
        description: row.description,
        quantity: row.quantity,
        condition: row.condition,
        location_id: locationId,
        // Importing doesn't call the tagging model — a few hundred API calls
        // would make an import crawl — so anything in a "tags" column seeds
        // the search tags, and the item gets properly tagged the first time
        // someone saves it.
        auto_tags: row.tags,
      };
    });

    const { error, count } = await supabase
      .from("items")
      .insert(payloadChunk, { count: "exact" });

    if (error) {
      return {
        ok: false,
        error: `Imported ${imported} item${imported === 1 ? "" : "s"} before this failed: ${error.message}. Nothing after that was saved.`,
      };
    }

    imported += count ?? payloadChunk.length;
  }

  return {
    ok: true,
    imported,
    skipped: (incoming as IncomingRow[]).length - rows.length,
    locationsCreated,
    unmatchedLocations,
    photoJobs,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Fetching photos named by URL in the spreadsheet
// ═══════════════════════════════════════════════════════════════════════

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type PhotoJob = { itemId: string; url: string };
export type PhotoResult = { itemId: string; ok: boolean; message?: string };

/**
 * Refuses to fetch anything that resolves to the machine itself or to a
 * private network. Without this, pasting a URL into a spreadsheet would be
 * enough to make the server fetch things only it can reach — an internal
 * admin page, a cloud metadata endpoint — and store the result where the
 * uploader can read it.
 */
async function isPubliclyRoutable(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }

  try {
    // Checked by resolved address, not by the name written down, so a
    // hostname pointing at 127.0.0.1 doesn't slip through.
    const addresses = await lookup(host, { all: true });
    return addresses.every(({ address, family }) => {
      if (family === 6) {
        const v6 = address.toLowerCase();
        return !(v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80"));
      }
      const [a, b] = address.split(".").map(Number);
      if (a === 10 || a === 127 || a === 0) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 169 && b === 254) return false;
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Fetches a small batch of photos and attaches them to their items. Called
 * repeatedly by the import wizard rather than once for the whole file: a
 * hundred downloads would blow any serverless time limit, and doing it in
 * batches also gives the person a progress count instead of a dead page.
 */
export async function attachPhotos(jobs: PhotoJob[]): Promise<PhotoResult[]> {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  if (jobs.length > 10) jobs = jobs.slice(0, 10);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jobs.map((job) => ({
      itemId: job.itemId,
      ok: false,
      message: "Signed out",
    }));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle();

  const orgId = profile?.active_org_id as string | undefined;
  if (!orgId) {
    return jobs.map((job) => ({
      itemId: job.itemId,
      ok: false,
      message: "No active organization",
    }));
  }

  return Promise.all(
    jobs.map(async (job): Promise<PhotoResult> => {
      try {
        if (!(await isPubliclyRoutable(job.url))) {
          return { itemId: job.itemId, ok: false, message: "That link isn’t a public web address" };
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(job.url, {
            signal: controller.signal,
            redirect: "follow",
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          return { itemId: job.itemId, ok: false, message: `The link returned ${response.status}` };
        }

        // A redirect can land somewhere private even when the original URL
        // was fine, so the destination is checked too.
        if (response.url && response.url !== job.url && !(await isPubliclyRoutable(response.url))) {
          return { itemId: job.itemId, ok: false, message: "The link redirected somewhere private" };
        }

        const contentType = (response.headers.get("content-type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const extension = PHOTO_EXTENSIONS[contentType];
        if (!extension) {
          return { itemId: job.itemId, ok: false, message: `That link is ${contentType || "not an image"}` };
        }

        const declaredLength = Number(response.headers.get("content-length") ?? "");
        if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_BYTES) {
          return { itemId: job.itemId, ok: false, message: "That image is bigger than 8MB" };
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_PHOTO_BYTES) {
          return { itemId: job.itemId, ok: false, message: "That image is bigger than 8MB" };
        }

        const path = `${orgId}/${job.itemId}/${randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(PHOTOS_BUCKET)
          .upload(path, bytes, { contentType });

        if (uploadError) {
          return { itemId: job.itemId, ok: false, message: uploadError.message };
        }

        // RLS keeps this to the caller's own organization.
        const { error: updateError } = await supabase
          .from("items")
          .update({ photo_url: path })
          .eq("id", job.itemId);

        if (updateError) {
          return { itemId: job.itemId, ok: false, message: updateError.message };
        }

        return { itemId: job.itemId, ok: true };
      } catch (error) {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? "The link took too long to respond"
            : "Couldn’t fetch that link";
        return { itemId: job.itemId, ok: false, message };
      }
    })
  );
}
