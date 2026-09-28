// Uploading pictures that came out of a spreadsheet, straight from the browser.
//
// Photos linked by URL are fetched on the server, because only the server
// should be deciding which addresses are safe to request. Pictures embedded in
// a workbook are the opposite case: the browser already holds the bytes, and
// sending a hundred of them back through a server action would mean
// base64-inflating them past the action body limit and spending a serverless
// invocation per handful. Storage's own row-level security still decides what
// may be written — the path has to start with the caller's organization — so
// going direct is no less locked down than going through the server.

import { createClient } from "@/lib/supabase/client";
import { PHOTOS_BUCKET } from "@/lib/supabase/storage";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export type PhotoUpload = {
  itemId: string;
  bytes: Uint8Array;
  contentType: string;
};

export type UploadResult = { itemId: string; ok: boolean; message?: string };

/** How many uploads are in flight at once. Enough to be quick, few enough
 *  that a phone on theatre wifi isn't trying to push twenty files at once. */
const CONCURRENCY = 4;

async function uploadOne(orgId: string, job: PhotoUpload): Promise<UploadResult> {
  const supabase = createClient();
  const extension = EXTENSIONS[job.contentType];
  if (!extension) {
    return { itemId: job.itemId, ok: false, message: `Unsupported picture type ${job.contentType}` };
  }

  // Same shape the server uses, because the storage policy keys on the first
  // segment being the organization and the app expects the item to own its
  // folder.
  const path = `${orgId}/${job.itemId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(path, new Blob([job.bytes as BlobPart], { type: job.contentType }), {
      contentType: job.contentType,
    });

  if (uploadError) {
    return { itemId: job.itemId, ok: false, message: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("items")
    .update({ photo_url: path })
    .eq("id", job.itemId);

  if (updateError) {
    return { itemId: job.itemId, ok: false, message: updateError.message };
  }

  return { itemId: job.itemId, ok: true };
}

/**
 * Uploads every picture, a few at a time, reporting progress as it goes so a
 * hundred of them doesn't look like a hung page.
 */
export async function uploadImportedPhotos(
  orgId: string,
  jobs: PhotoUpload[],
  onProgress: (done: number, failed: number) => void
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  let done = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= jobs.length) return;

      const result = await uploadOne(orgId, jobs[index]);
      results.push(result);
      done += 1;
      if (!result.ok) failed += 1;
      onProgress(done, failed);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker())
  );

  return results;
}
