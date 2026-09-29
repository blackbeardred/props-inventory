-- ═══════════════════════════════════════════════════════════════════════
-- Recognising an item by what it looks like
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- The prop-table photo screen already reads a picture into a list of things
-- and offers inventory items for each one — but it finds those items by
-- NAME, through the app's own search. That works when the model happens to
-- call a thing what the theatre calls it, and fails when it doesn't: "goblet"
-- never finds "Chalice, pewter", and a bare "candlestick" offers all six of
-- them in no useful order.
--
-- This adds the other half: a visual fingerprint of each item's photo, so a
-- crop from the table photo can be compared against pictures of the things
-- the theatre actually owns. That is what turns "a brass globe" into "your
-- brass globe, P-014, Shelf 3B".
--
-- The fingerprints are produced in the browser by a small open vision model
-- (CLIP ViT-B/32, 512 numbers per image) — no API key, no per-photo cost.
-- Postgres only has to store them and measure distance, which is what
-- pgvector is for.
--
-- Nothing existing changes. No table, column, policy or function defined in
-- 001–004 is touched.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. pgvector
--
-- Into the `extensions` schema, which is where Supabase keeps extensions
-- and which is already on the search path for API requests.
-- ─────────────────────────────────────────────────────────────
create extension if not exists vector with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- 2. The fingerprints
--
-- One row per item, because an item has one photo. Replacing the photo
-- overwrites the row; deleting the item takes the row with it.
--
-- `photo_url` and `model` are not redundant. Without them there is no way to
-- tell a current fingerprint from one computed against a photo that has
-- since been replaced, or against a different model whose numbers mean
-- something else entirely — and a stale fingerprint doesn't fail loudly, it
-- quietly matches the wrong prop. They are what lets the backfill skip what
-- it has already done and redo only what actually changed.
-- ─────────────────────────────────────────────────────────────
create table if not exists item_photo_embeddings (
  item_id uuid primary key references items(id) on delete cascade,
  -- Denormalised from items.org_id so the RLS policy below is a column
  -- comparison rather than a subquery on every row of every search.
  org_id uuid not null references organizations(id) on delete cascade,
  -- The photo this was computed from. Compared against items.photo_url to
  -- spot a fingerprint left behind by a photo that has since changed.
  photo_url text not null,
  -- Which model produced it. Vectors from two different models are not
  -- comparable, so a model change has to invalidate rather than mix.
  model text not null default 'clip-vit-base-patch32',
  embedding extensions.vector(512) not null,
  created_at timestamptz not null default now()
);

create index if not exists item_photo_embeddings_org_idx
  on item_photo_embeddings (org_id);

-- No similarity index on purpose. At a theatre's scale — a few thousand
-- items at the very most — scanning every fingerprint is a few
-- milliseconds, and an approximate index (ivfflat/hnsw) would trade exact
-- results for speed that isn't needed, plus a rebuild step whenever the
-- inventory grows. One `create index` away if it ever matters.

-- ─────────────────────────────────────────────────────────────
-- 3. Row-level security
--
-- Same `auth_org_id()` rule as every other table. The extra `exists` check
-- on write is the part worth reading twice: without it, a caller could
-- attach a fingerprint carrying their own org_id to another theatre's
-- item_id, and then read that item's name straight back out of a match
-- result. The item has to be one of theirs too.
-- ─────────────────────────────────────────────────────────────
alter table item_photo_embeddings enable row level security;

drop policy if exists "org members can read their item embeddings" on item_photo_embeddings;
create policy "org members can read their item embeddings" on item_photo_embeddings
  for select using (org_id = auth_org_id());

drop policy if exists "org members can manage their item embeddings" on item_photo_embeddings;
create policy "org members can manage their item embeddings" on item_photo_embeddings
  for all
  using (org_id = auth_org_id())
  with check (
    org_id = auth_org_id()
    and exists (
      select 1 from items i
      where i.id = item_id and i.org_id = auth_org_id()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 4. Finding the lookalikes
--
-- Deliberately NOT security definer — the same choice as search_items. It
-- runs with the caller's own permissions, so the policy above is what limits
-- it to one theatre's fingerprints. A security definer version would have to
-- re-implement that limit by hand, and get it right forever.
--
-- Returns ids and scores, not rows: the caller fetches the items it wants
-- through the normal items policy, so there is exactly one place where "may
-- I see this item" is decided.
--
-- similarity runs 0..1, higher being closer. Cosine distance (`<=>`) is the
-- right measure for CLIP vectors, which carry direction rather than
-- magnitude.
-- ─────────────────────────────────────────────────────────────
drop function if exists match_items(extensions.vector, int);
create or replace function match_items(
  query_embedding extensions.vector(512),
  match_count int default 5
)
returns table (item_id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select e.item_id, 1 - (e.embedding <=> query_embedding) as similarity
  from item_photo_embeddings e
  where e.model = 'clip-vit-base-patch32'
  order by e.embedding <=> query_embedding
  limit least(greatest(coalesce(match_count, 5), 1), 50)
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. Tell the API about the new table and function
--
-- Without this the app reports "could not find the function match_items"
-- until the schema cache happens to refresh on its own.
-- ─────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
