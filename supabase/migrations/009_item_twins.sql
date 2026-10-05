-- Migration 009: twins — props the theatre owns more than one of, that look
-- exactly alike.
--
-- Two brass candlesticks bought as a pair are two real props, each with its
-- own shelf and its own life on pull lists, but no photograph can tell them
-- apart. Linking them as twins lets the app say so:
--   - a confirmed picture of one counts for all of them, so photographing
--     either one finds every twin (match_items, below);
--   - a photo of the prop table that finds one of a set can mark whichever
--     twin isn't already in use;
--   - deleting one (lost, broken) gives its pictures to a remaining twin
--     rather than losing them.
--
-- Twins are only ever linked by a person: the app offers ("Is this another
-- one of those?") but never assumes, because similar-looking props are often
-- not the same prop.
--
-- One new table; match_items is replaced with a twin-aware version (same
-- arguments, same result shape); item_reference_photos (008) gains the
-- 'twin' source. Nothing else existing is touched.
--
-- Safe to run more than once. Parts 1–3 have no $$ blocks; Part 4 replaces a
-- function and so has one. If a paste is cut short, run the parts separately.
-- Needs 008 to have been run first.

-- ── Part 1: the table ──────────────────────────────────────────────────

-- One row per item that has twins. Items sharing a twin_set are twins of one
-- another; there's no separate "set" table, the shared uuid is the set. An
-- item belongs to at most one set (item_id is the key), and deleting the
-- item takes its row with it.
create table if not exists item_twins (
  item_id uuid primary key references items(id) on delete cascade,
  -- Denormalised from items.org_id, as elsewhere, so the policies are a
  -- column comparison.
  org_id uuid not null references organizations(id) on delete cascade,
  twin_set uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists item_twins_set_idx on item_twins (twin_set);
create index if not exists item_twins_org_idx on item_twins (org_id);

-- ── Part 2: who can see and touch it ───────────────────────────────────

alter table item_twins enable row level security;

drop policy if exists "org members can read their twins" on item_twins;
create policy "org members can read their twins" on item_twins
  for select using (org_id = auth_org_id());

-- The item must be the theatre's own, as in item_photo_embeddings. A set is
-- only ever joined by items of one theatre, because every row in it had to
-- pass this check.
drop policy if exists "org members can manage their twins" on item_twins;
create policy "org members can manage their twins" on item_twins
  for all
  using (org_id = auth_org_id())
  with check (
    org_id = auth_org_id()
    and exists (
      select 1 from items i
      where i.id = item_id and i.org_id = auth_org_id()
    )
  );

-- ── Part 3: a deleted twin's photo, kept as a picture of the one left ───

alter table item_reference_photos drop constraint if exists item_reference_photos_source_check;
alter table item_reference_photos add constraint item_reference_photos_source_check
  check (source in ('find_by_photo', 'prop_table', 'duplicate', 'twin'));

-- ── Part 4: matching shares pictures across twins ──────────────────────
--
-- Each item scores as the closest picture of itself or of any of its twins,
-- so every twin in a set comes back with the same score. Still not security
-- definer: the policies on all three tables keep it to one theatre.

create or replace function match_items(
  query_embedding extensions.vector(512),
  match_count int default 5
)
returns table (item_id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  with pictures as (
    select e.item_id, e.embedding
    from item_photo_embeddings e
    where e.model = 'clip-vit-base-patch32'
    union all
    select r.item_id, r.embedding
    from item_reference_photos r
    where r.model = 'clip-vit-base-patch32' and r.embedding is not null
  ),
  scored as (
    select p.item_id, max(1 - (p.embedding <=> query_embedding)) as similarity
    from pictures p
    group by p.item_id
  ),
  shared as (
    select s.item_id, s.similarity from scored s
    union all
    select mate.item_id, s.similarity
    from scored s
    join item_twins mine on mine.item_id = s.item_id
    join item_twins mate on mate.twin_set = mine.twin_set and mate.item_id <> s.item_id
  )
  select item_id, max(similarity) as similarity
  from shared
  group by item_id
  order by 2 desc, 1
  limit least(greatest(coalesce(match_count, 5), 1), 50)
$$;

notify pgrst, 'reload schema';
