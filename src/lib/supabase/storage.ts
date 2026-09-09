/**
 * Storage bucket for item photos (Day 4). Private bucket — objects live at
 * `${org_id}/${item_id}/${filename}` and are only reachable by org members
 * via RLS policies on storage.objects (see supabase/schema.sql), so photos
 * are shown through short-lived signed URLs rather than a public link.
 */
export const PHOTOS_BUCKET = "item-photos";

export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
