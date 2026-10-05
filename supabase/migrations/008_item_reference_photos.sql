-- Migration 008: more than one picture of each item.
--
-- When someone photographs a prop and the app finds it ("where's this
-- item?"), that photograph is a second picture of the same thing, taken from
-- another angle, in other light. Until now it was thrown away. From now on,
-- when a person confirms the match, it is kept against the item: tapping
-- "That's it" on Find by photo, or ticking a match on the prop-table photo
-- screen. A match nobody confirmed is never kept, so a wrong guess can't
-- teach the app the wrong thing.
--
-- These pictures are never shown anywhere. They exist for two reasons:
--   1. Matching uses them straight away. match_items now compares a new
--      photo against every picture of an item and keeps the closest, so an
--      item photographed from three angles is found from any of them.
--   2. They are labelled examples, which is what a custom-trained
--      recognition model would one day need, collected for free.
--
-- One new table, and match_items is replaced with a version that also reads
-- it (same arguments, same result shape, so nothing calling it changes).
-- Nothing else existing is touched.
--
-- Safe to run more than once. Parts 1 and 2 have no $$ blocks; Part 3
-- replaces a function and so has one. If a paste is cut short, run the three
-- parts separately.

-- ── Part 1: the table ──────────────────────────────────────────────────

create table if not exists item_reference_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  -- Denormalised from items.org_id, as in item_photo_embeddings, so the
  -- policies below are a column comparison rather than a subquery per row.
  org_id uuid not null references organizations(id) on delete cascade,
  -- Where the picture is, in the item-photos bucket, under the item's own
  -- folder: {org}/{item}/ref-{uuid}.jpg.
  photo_path text not null,
  -- How it was confirmed.
  source text not null check (source in ('find_by_photo', 'prop_table')),
  -- How alike the app thought it was when it was confirmed, 0..1. Null when
  -- the match was made by name alone.
  similarity real,
  -- The fingerprint, as in item_photo_embeddings. Null until a device that
  -- holds the recognition model gets to it.
  model text not null default 'clip-vit-base-patch32',
  embedding extensions.vector(512),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists item_reference_photos_item_idx
  on item_reference_photos (item_id);
create index if not exists item_reference_photos_org_idx
  on item_reference_photos (org_id);

-- ── Part 2: who can see and touch it ───────────────────────────────────

alter table item_reference_photos enable row level security;

drop policy if exists "org members can read their reference photos" on item_reference_photos;
create policy "org members can read their reference photos" on item_reference_photos
  for select using (org_id = auth_org_id());

-- The `exists` check is the same one item_photo_embeddings has, for the same
-- reason: without it a caller could hang a picture carrying their own org_id
-- on another theatre's item_id, and read that item back out of a match.
drop policy if exists "org members can manage their reference photos" on item_reference_photos;
create policy "org members can manage their reference photos" on item_reference_photos
  for all
  using (org_id = auth_org_id())
  with check (
    org_id = auth_org_id()
    and exists (
      select 1 from items i
      where i.id = item_id and i.org_id = auth_org_id()
    )
  );

-- ── Part 3: matching against every picture of an item ──────────────────
--
-- Each item scores as its closest picture: its own photo or any confirmed
-- one. Still not security definer, so the two policies above and
-- item_photo_embeddings' own keep it to one theatre.

create or replace function match_items(
  query_embedding extensions.vector(512),
  match_count int default 5
)
returns table (item_id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select p.item_id, max(1 - (p.embedding <=> query_embedding)) as similarity
  from (
    select e.item_id, e.embedding
    from item_photo_embeddings e
    where e.model = 'clip-vit-base-patch32'
    union all
    select r.item_id, r.embedding
    from item_reference_photos r
    where r.model = 'clip-vit-base-patch32' and r.embedding is not null
  ) p
  group by p.item_id
  order by 2 desc
  limit least(greatest(coalesce(match_count, 5), 1), 50)
$$;

notify pgrst, 'reload schema';
