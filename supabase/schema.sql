-- Day 2 schema: run this in the Supabase SQL editor after creating your project.
-- Scope: organizations, locations, items (props/costumes), productions, pull lists.
-- Deliberately excludes: AI classification, OCR, QR codes, marketplace, billing.

-- pgvector, for the visual fingerprints in item_photo_embeddings below.
-- Into `extensions`, which is where Supabase keeps extensions. Migration 006.
create extension if not exists vector with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- Organizations (a theatre company, school program, etc.)
-- ─────────────────────────────────────────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Profiles (one row per Supabase auth user — the person, not their
-- membership). A person can belong to several organizations; which ones
-- lives in `memberships` below, and which one they're currently looking
-- at lives in active_org_id here.
-- ─────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  -- The organization this person is currently working in. Every RLS policy
  -- in this file resolves through auth_org_id(), which reads this column
  -- but only honours it while a matching memberships row exists.
  active_org_id uuid references organizations(id) on delete set null,
  -- Private `avatars` bucket, object at `${id}/${filename}`.
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Memberships (which people belong to which organizations, and their
-- role in each). Splitting this from profiles is what allows one person
-- to work across several theatres.
-- ─────────────────────────────────────────────────────────────
create table memberships (
  user_id uuid not null references profiles(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index memberships_org_id_idx on memberships(org_id);

-- ─────────────────────────────────────────────────────────────
-- Locations (storage rooms, shelves, bins — self-referencing for nesting)
-- e.g. "Costume Loft" > "Rack 3" > "Bin B"
-- ─────────────────────────────────────────────────────────────
create table locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  parent_location_id uuid references locations(id) on delete set null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Items (props and costumes)
-- ─────────────────────────────────────────────────────────────
create table items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  name text not null,
  category text not null default 'prop' check (category in ('prop', 'costume')),
  description text,
  photo_url text,
  quantity integer not null default 1,
  condition text check (condition in ('new', 'good', 'fair', 'needs_repair')),
  -- Generated search tags: what this thing is, what it's likely made of,
  -- what it's for. Derived from the item's own name, category and
  -- description, plus its photo when it has one, so that searching "wood"
  -- finds a wooden chest, a wooden table and a guitar alike — none of which
  -- need the word "wood" written anywhere. Never shown in item lists or
  -- search results; they only affect what a search matches. Fully replaced
  -- each time the item is retagged. See src/lib/ai/tag-item.ts.
  auto_tags text[] not null default '{}',
  -- Columns from the spreadsheet an item was imported from that no field
  -- matched — an inventory number, a donor, what it cost — keyed by the
  -- heading they came from. Searchable and shown on the item's own page,
  -- never in lists. Empty for items typed in by hand. Kept apart from
  -- auto_tags on purpose: those are replaced wholesale on every retag, and
  -- anything stored with them would vanish the first time someone edited a
  -- description.
  import_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_org_id_idx on items(org_id);
create index items_location_id_idx on items(location_id);

-- array_to_string() is marked STABLE rather than IMMUTABLE in Postgres
-- (collation-related — see postgresql.org bug #17360), so it can't be used
-- directly inside an index expression. This thin wrapper re-declares the
-- same logic as IMMUTABLE, which is safe here: tag text is plain lowercase
-- ASCII we generate ourselves, so there's no real collation sensitivity.
create or replace function items_search_document(
  p_name text,
  p_description text,
  p_auto_tags text[],
  p_import_data jsonb
)
returns text
language sql
immutable
as $$
  -- The document is indexed three times over:
  --   1. as written;
  --   2. with punctuation squeezed out of the middle of words. Search-as-
  --      you-type strips punctuation from what the user types ("P-001"
  --      becomes the term p001), and Postgres reads "P-001" as the two words
  --      p and 001, so without this copy an inventory number could never be
  --      typed back in;
  --   3. with punctuation turned into spaces. Postgres reads "orange/rust" as
  --      a file path, one word, so without this copy "rust" wouldn't find it
  --      (migration 011).
  select base
    || ' ' || regexp_replace(base, '[^[:alnum:][:space:]]+', '', 'g')
    || ' ' || regexp_replace(base, '[^[:alnum:][:space:]]+', ' ', 'g')
  from (
    select coalesce(p_name, '') || ' ' || coalesce(p_description, '') || ' '
      || coalesce(array_to_string(p_auto_tags, ' '), '') || ' '
      || coalesce(
           (select string_agg(entry.value, ' ')
            from jsonb_each_text(coalesce(p_import_data, '{}'::jsonb)) as entry),
           ''
         ) as base
  ) as document
$$;

-- Full-text search over name + description + the generated tags + whatever
-- an import kept from columns this app has no field for. None of those are
-- shown in lists; they exist so that a search for a material, a category, an
-- inventory number or a donor's name matches things whose name never
-- mentions it.
create index items_search_idx on items using gin (
  to_tsvector('english', items_search_document(name, description, auto_tags, import_data))
);

-- ─────────────────────────────────────────────────────────────
-- Productions (a specific show/run)
-- ─────────────────────────────────────────────────────────────
create table productions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'planning' check (status in ('planning', 'in_run', 'closed')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Pull lists (the checklist of items needed for a production)
-- ─────────────────────────────────────────────────────────────
create table pull_lists (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references productions(id) on delete cascade,
  name text not null default 'Pull List',
  created_at timestamptz not null default now()
);

create table pull_list_items (
  id uuid primary key default gen_random_uuid(),
  pull_list_id uuid not null references pull_lists(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  quantity_needed integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'pulled', 'returned')),
  -- Whether a person actually stood in front of the shelf, which `status`
  -- can't say: a whole list can be marked pulled from a desk. `open` until
  -- someone walks the checklist, `checked` once confirmed in person,
  -- `cleared` when the prop turns out not to be wanted after all.
  check_state text not null default 'open'
    check (check_state in ('open', 'checked', 'cleared')),
  checked_at timestamptz,
  checked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Visual fingerprints of item photos (migration 006)
--
-- One row per item, so a crop from a photo of the prop table can be compared
-- against pictures of the things this theatre actually owns — which is what
-- turns "a brass globe" into "your brass globe, P-014, Shelf 3B". Produced in
-- the browser by CLIP ViT-B/32 (512 numbers per image); no API key involved.
--
-- photo_url and model are what distinguish a current fingerprint from one
-- left behind by a replaced photo or a different model. A stale fingerprint
-- doesn't fail loudly — it quietly matches the wrong prop.
--
-- org_id is denormalised from items so the RLS policy is a column comparison
-- rather than a subquery on every row of every search.
-- ─────────────────────────────────────────────────────────────
create table item_photo_embeddings (
  item_id uuid primary key references items(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  photo_url text not null,
  model text not null default 'clip-vit-base-patch32',
  embedding extensions.vector(512) not null,
  created_at timestamptz not null default now()
);

create index item_photo_embeddings_org_idx on item_photo_embeddings (org_id);

-- ─────────────────────────────────────────────────────────────
-- More pictures of each item (migration 008)
--
-- A photograph someone took that the app matched to an item, and a person
-- confirmed ("That's it" on Find by photo, or a ticked match on the
-- prop-table screen), or the photos of a duplicate deleted with this item
-- named as its twin. Never shown; match_items compares against these as
-- well as the item's own photo, and they are labelled examples for any
-- future custom-trained model. embedding is null until a device holding the
-- recognition model fingerprints it.
-- ─────────────────────────────────────────────────────────────
create table item_reference_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  photo_path text not null,
  source text not null check (source in ('find_by_photo', 'prop_table', 'duplicate', 'twin')),
  similarity real,
  model text not null default 'clip-vit-base-patch32',
  embedding extensions.vector(512),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index item_reference_photos_item_idx on item_reference_photos (item_id);
create index item_reference_photos_org_idx on item_reference_photos (org_id);

-- ─────────────────────────────────────────────────────────────
-- Twins (migration 009)
--
-- Props the theatre owns more than one of that look exactly alike: each a
-- real item with its own shelf and pull-list life, but no photo can tell
-- them apart. Items sharing a twin_set are twins; the uuid is the set.
-- Pictures of one count for all (match_items), and deleting one gives its
-- pictures to a remaining twin. Only ever linked by a person.
-- ─────────────────────────────────────────────────────────────
create table item_twins (
  item_id uuid primary key references items(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  twin_set uuid not null,
  created_at timestamptz not null default now()
);

create index item_twins_set_idx on item_twins (twin_set);
create index item_twins_org_idx on item_twins (org_id);

-- No similarity index on purpose: at a few thousand items an exact scan is a
-- few milliseconds, and an approximate index would trade exactness for speed
-- that isn't needed.

-- ─────────────────────────────────────────────────────────────
-- Row Level Security: every table is scoped to the caller's org.
-- ─────────────────────────────────────────────────────────────
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table locations enable row level security;
alter table items enable row level security;
alter table productions enable row level security;
alter table pull_lists enable row level security;
alter table pull_list_items enable row level security;
alter table item_photo_embeddings enable row level security;
alter table item_reference_photos enable row level security;
alter table item_twins enable row level security;

create or replace function auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from memberships where user_id = auth.uid()
$$;

create or replace function auth_peer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct m2.user_id
  from memberships m1
  join memberships m2 on m2.org_id = m1.org_id
  where m1.user_id = auth.uid()
$$;

create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.active_org_id
  from profiles p
  join memberships m on m.user_id = p.id and m.org_id = p.active_org_id
  where p.id = auth.uid()
$$;

create or replace function auth_org_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from profiles p
  join memberships m on m.user_id = p.id and m.org_id = p.active_org_id
  where p.id = auth.uid()
$$;

create policy "org members can read their orgs" on organizations
  for select using (id in (select auth_org_ids()));

create policy "members can read profiles they share an org with" on profiles
  for select using (id = auth.uid() or id in (select auth_peer_ids()));

-- The account page edits your own name, avatar and active organization
-- directly, so this one write policy exists. Scoped to your own row, and
-- pointing active_org_id somewhere you don't belong grants nothing, since
-- auth_org_id() joins through memberships before honouring it.
create policy "members can update their own profile" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- No insert/update/delete policy on memberships, by design: the only way
-- to write one is a security definer function with a role check inside.
create policy "members can read memberships in their orgs" on memberships
  for select using (org_id in (select auth_org_ids()));

create policy "org members can manage their locations" on locations
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

create policy "org members can manage their items" on items
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- The `exists` check on write is the part worth reading twice: without it, a
-- caller could attach a fingerprint carrying their own org_id to another
-- theatre's item_id, then read that item's name back out of a match result.
--
-- These two are the only policies this table should ever have (migration
-- 010). The pre-006 draft used other names, and because policies are OR'd,
-- its org-only write policy reopened that hole when it turned up alongside
-- these on the live database. The drops are no-ops on a fresh database and
-- are here so this file says the same as the migrations.
drop policy if exists "org members read embeddings" on item_photo_embeddings;
drop policy if exists "org members write embeddings" on item_photo_embeddings;

create policy "org members can read their item embeddings" on item_photo_embeddings
  for select using (org_id = auth_org_id());

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

create policy "org members can read their reference photos" on item_reference_photos
  for select using (org_id = auth_org_id());

create policy "org members can read their twins" on item_twins
  for select using (org_id = auth_org_id());

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

create policy "org members can manage their productions" on productions
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

create policy "org members can manage their pull lists" on pull_lists
  for all using (
    production_id in (select id from productions where org_id = auth_org_id())
  );

create policy "org members can manage their pull list items" on pull_list_items
  for all using (
    pull_list_id in (
      select pl.id from pull_lists pl
      join productions p on p.id = pl.production_id
      where p.org_id = auth_org_id()
    )
  );


-- ─────────────────────────────────────────────────────────────
-- Onboarding: creates an organization and its first (owner) profile
-- atomically. security definer so it can bypass the read-only RLS
-- policies above for this one bootstrap step — organizations and
-- profiles otherwise have no INSERT policy at all, by design, so the
-- only way to create either is through this function (Day 3).
-- ─────────────────────────────────────────────────────────────
create or replace function create_organization_and_profile(org_name text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  new_invite_code text;
begin
  new_invite_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into organizations (name, invite_code)
  values (org_name, new_invite_code)
  returning id into new_org_id;

  insert into profiles (id, full_name, active_org_id)
  values (auth.uid(), member_name, new_org_id)
  on conflict (id) do update set active_org_id = new_org_id;

  insert into memberships (user_id, org_id, role)
  values (auth.uid(), new_org_id, 'owner');

  return new_org_id;
end;
$$;

-- A teammate joins an existing organization with its invite code, as a
-- 'member' (not 'owner'). Same bootstrap rationale as the function above —
-- security definer to bypass the read-only-by-default RLS on organizations
-- and profiles for this one step.
create or replace function join_organization_with_code(p_invite_code text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  select id into target_org_id from organizations
  where invite_code = upper(p_invite_code);

  if target_org_id is null then
    raise exception 'Invite code not found';
  end if;

  if exists (
    select 1 from memberships where user_id = auth.uid() and org_id = target_org_id
  ) then
    raise exception 'You are already a member of that organization';
  end if;

  insert into profiles (id, full_name, active_org_id)
  values (auth.uid(), member_name, target_org_id)
  on conflict (id) do update set active_org_id = target_org_id;

  insert into memberships (user_id, org_id, role)
  values (auth.uid(), target_org_id, 'member');

  return target_org_id;
end;
$$;

create or replace function leave_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  owner_count int;
  next_org_id uuid;
begin
  select role into caller_role from memberships
  where user_id = auth.uid() and org_id = p_org_id;

  if caller_role is null then
    raise exception 'You are not a member of that organization';
  end if;

  -- An organization with no owner can never be administered again: nobody
  -- could manage members or regenerate the invite code, and the inventory
  -- would be stranded. Hand it over before walking out.
  if caller_role = 'owner' then
    select count(*) into owner_count from memberships
    where org_id = p_org_id and role = 'owner';

    if owner_count <= 1 then
      raise exception 'You are the only owner. Promote someone else to owner before leaving.';
    end if;
  end if;

  delete from memberships where user_id = auth.uid() and org_id = p_org_id;

  -- Land on another organization, or nowhere if that was the last one.
  select org_id into next_org_id from memberships
  where user_id = auth.uid()
  order by created_at
  limit 1;

  update profiles set active_org_id = next_org_id where id = auth.uid();
end;
$$;

create or replace function switch_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from memberships where user_id = auth.uid() and org_id = p_org_id
  ) then
    raise exception 'You are not a member of that organization';
  end if;

  update profiles set active_org_id = p_org_id where id = auth.uid();
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- Storage: item photos (Day 4). Private bucket — objects live at
-- `${org_id}/${item_id}/${filename}` and RLS on storage.objects restricts
-- every operation to members of that org, mirroring the app-table policies
-- above. Photos are served via short-lived signed URLs, not a public link.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', false)
on conflict (id) do nothing;

create policy "org members can read their item photos"
on storage.objects for select
using (
  bucket_id = 'item-photos'
  and (storage.foldername(name))[1]::uuid = auth_org_id()
);

create policy "org members can upload their item photos"
on storage.objects for insert
with check (
  bucket_id = 'item-photos'
  and (storage.foldername(name))[1]::uuid = auth_org_id()
);

create policy "org members can update their item photos"
on storage.objects for update
using (
  bucket_id = 'item-photos'
  and (storage.foldername(name))[1]::uuid = auth_org_id()
);

create policy "org members can delete their item photos"
on storage.objects for delete
using (
  bucket_id = 'item-photos'
  and (storage.foldername(name))[1]::uuid = auth_org_id()
);


-- ─────────────────────────────────────────────────────────────
-- Storage: avatars. Private bucket, objects at `${user_id}/${filename}`.
-- Readable by anyone you share an organization with, writable only by
-- you. Private rather than public so a volunteer's face isn't sitting on
-- a guessable URL.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "members can read avatars from their orgs"
on storage.objects for select
using (
  bucket_id = 'avatars'
  and (
    -- Always your own, even while you belong to no organization.
    (storage.foldername(name))[1]::uuid = auth.uid()
    or (storage.foldername(name))[1]::uuid in (select auth_peer_ids())
  )
);

create policy "users can upload their own avatar"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1]::uuid = auth.uid()
);

create policy "users can update their own avatar"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1]::uuid = auth.uid()
);

create policy "users can delete their own avatar"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1]::uuid = auth.uid()
);


-- ─────────────────────────────────────────────────────────────
-- Search (Day 5). Reuses the items_search_idx GIN index created above.
-- Plain (non security definer) function — RLS on `items` still applies to
-- the query inside it, so results stay scoped to the caller's org exactly
-- like a normal select.
-- ─────────────────────────────────────────────────────────────
create or replace function location_search_paths()
returns table (location_id uuid, path text)
language sql
stable
as $$
  with recursive chain as (
    select id as leaf_id, id as node_id, name, parent_location_id
    from locations
    union all
    select c.leaf_id, parent.id, parent.name, parent.parent_location_id
    from chain c
    join locations parent on parent.id = c.parent_location_id
  )
  select leaf_id, string_agg(name, ' ')
  from chain
  group by leaf_id
$$;

create or replace function location_descendants(p_ids uuid[])
returns setof uuid
language sql
stable
as $$
  with recursive tree as (
    select id from locations where id = any(p_ids)
    union
    select child.id
    from locations child
    join tree on child.parent_location_id = tree.id
  )
  select id from tree
$$;

create or replace function search_items(search_query text)
returns setof items
language sql
stable
as $$
  with paths as (
    select * from location_search_paths()
  )
  select i.*
  from items i
  left join paths p on p.location_id = i.location_id
  where to_tsvector(
          'english',
          items_search_document(i.name, i.description, i.auto_tags, i.import_data)
            || ' ' || coalesce(p.path, '')
        ) @@ websearch_to_tsquery('english', search_query)
  order by i.name
$$;


-- ─────────────────────────────────────────────────────────────
-- Organization/member management (Day 7). security definer, same
-- rationale as the onboarding/invite functions above: these bypass the
-- read-only-by-default RLS on organizations/profiles for one controlled
-- step, gated by an explicit role check inside the function body rather
-- than a broader UPDATE/DELETE policy.
-- ─────────────────────────────────────────────────────────────
create or replace function regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid := auth_org_id();
  new_code text;
begin
  if caller_org_id is null then
    raise exception 'You have no active organization';
  end if;

  if auth_org_role() is distinct from 'owner' then
    raise exception 'Only an organization owner can regenerate the invite code';
  end if;

  new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  update organizations set invite_code = new_code where id = caller_org_id;

  return new_code;
end;
$$;

-- Renaming the theatre (migration 012). Same pattern as the invite code:
-- owners only, the open theatre only, the checks inside.
create or replace function rename_organization(new_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid := auth_org_id();
  cleaned text := btrim(regexp_replace(coalesce(new_name, ''), '\s+', ' ', 'g'));
begin
  if caller_org_id is null then
    raise exception 'You have no active organization';
  end if;

  if auth_org_role() is distinct from 'owner' then
    raise exception 'Only an owner can rename the theatre';
  end if;

  if cleaned = '' then
    raise exception 'A theatre needs a name';
  end if;

  if char_length(cleaned) > 100 then
    raise exception 'That name is too long: 100 characters at most';
  end if;

  update organizations set name = cleaned where id = caller_org_id;

  return cleaned;
end;
$$;

create or replace function set_member_role(target_profile_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid := auth_org_id();
  target_role text;
  owner_count int;
begin
  if new_role not in ('owner', 'member') then
    raise exception 'Invalid role: %', new_role;
  end if;

  if caller_org_id is null then
    raise exception 'You have no active organization';
  end if;

  if auth_org_role() is distinct from 'owner' then
    raise exception 'Only an organization owner can change member roles';
  end if;

  select role into target_role from memberships
  where user_id = target_profile_id and org_id = caller_org_id;

  if target_role is null then
    raise exception 'That member is not in your organization';
  end if;

  if target_role = 'owner' and new_role = 'member' then
    select count(*) into owner_count from memberships
    where org_id = caller_org_id and role = 'owner';

    if owner_count <= 1 then
      raise exception 'An organization must keep at least one owner';
    end if;
  end if;

  update memberships set role = new_role
  where user_id = target_profile_id and org_id = caller_org_id;
end;
$$;

create or replace function remove_member(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid := auth_org_id();
  target_role text;
  owner_count int;
begin
  if caller_org_id is null then
    raise exception 'You have no active organization';
  end if;

  if auth_org_role() is distinct from 'owner' then
    raise exception 'Only an organization owner can remove a member';
  end if;

  if target_profile_id = auth.uid() then
    raise exception 'You can''t remove yourself. Leave the organization from your account page instead.';
  end if;

  select role into target_role from memberships
  where user_id = target_profile_id and org_id = caller_org_id;

  if target_role is null then
    raise exception 'That member is not in your organization';
  end if;

  if target_role = 'owner' then
    select count(*) into owner_count from memberships
    where org_id = caller_org_id and role = 'owner';

    if owner_count <= 1 then
      raise exception 'An organization must keep at least one owner';
    end if;
  end if;

  delete from memberships
  where user_id = target_profile_id and org_id = caller_org_id;

  -- If that was the org they were looking at, move them somewhere valid.
  update profiles
  set active_org_id = (
    select org_id from memberships
    where user_id = target_profile_id
    order by created_at
    limit 1
  )
  where id = target_profile_id and active_org_id = caller_org_id;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- Prefix search (Day 8), for search-as-you-type. Reuses the items_search_idx
-- GIN index above. Each word in the query is turned into a prefix lexeme
-- ("glo" -> "glo:*") so results update as the user keeps typing, and an
-- optional list of location ids narrows the same query without a second
-- round trip. Plain (non security definer) function, like search_items —
-- RLS on `items` still applies inside it.
-- ─────────────────────────────────────────────────────────────
create or replace function search_items_prefix(search_query text, location_ids uuid[] default null)
returns setof items
language plpgsql
stable
as $$
declare
  prefix_text text;
  prefix_query tsquery;
begin
  if search_query is not null and btrim(search_query) <> '' then
    select nullif(string_agg(cleaned, ' & '), '')
    into prefix_text
    from (
      select regexp_replace(raw_word, '[^[:alnum:]]+', '', 'g') || ':*' as cleaned
      from unnest(regexp_split_to_array(btrim(search_query), '\s+')) as raw_word
    ) as words
    where cleaned <> ':*';

    if prefix_text is not null then
      prefix_query := to_tsquery('english', prefix_text);
    end if;
  end if;

  -- The location path is joined in rather than stored on the item, which
  -- means this can't use the items_search_idx expression index and scans
  -- instead. At a theatre's scale (thousands of items at the very most)
  -- that is a few milliseconds; the alternative is denormalising the path
  -- onto every item and keeping it correct through triggers whenever a
  -- location is renamed or moved, which is a lot of machinery to maintain
  -- for a table this size.
  return query
  with paths as (
    select * from location_search_paths()
  )
  select i.*
  from items i
  left join paths p on p.location_id = i.location_id
  where
    (
      prefix_query is null
      or to_tsvector(
           'english',
           items_search_document(i.name, i.description, i.auto_tags, i.import_data)
             || ' ' || coalesce(p.path, '')
         ) @@ prefix_query
    )
    and (
      location_ids is null
      or i.location_id in (select location_descendants(location_ids))
    )
  order by i.name;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- Finding the items whose photo looks most like a given one (migration 006)
--
-- Deliberately NOT security definer — the same choice as search_items. It
-- runs with the caller's own permissions, so the item_photo_embeddings policy
-- is what limits it to one theatre's fingerprints.
--
-- Returns ids and scores rather than rows, so "may I see this item" stays
-- decided in exactly one place: the items policy, when the caller fetches
-- them. similarity runs 0..1, higher being closer. Cosine distance is the
-- right measure for CLIP vectors, which carry direction rather than
-- magnitude.
-- ─────────────────────────────────────────────────────────────
create or replace function match_items(
  query_embedding extensions.vector(512),
  match_count int default 5
)
returns table (item_id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  -- Each item scores as its closest picture: its own photo, any of the
  -- confirmed ones in item_reference_photos (migration 008), or any picture
  -- of one of its twins (migration 009), so every twin scores the same.
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

-- ─────────────────────────────────────────────────────────────
-- Recently Deleted (migration 007)
--
-- A snapshot of each deleted item, place, production, pull list or pull-list
-- line, with everything the delete took with it, so it can be restored for
-- 30 days. Restoring re-inserts the rows with their original ids. Nothing
-- else in this file knows about it: every other table and function behaves
-- exactly as before. See src/lib/recently-deleted.ts.
-- ─────────────────────────────────────────────────────────────
create table if not exists deleted_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null
    check (kind in ('item', 'location', 'production', 'pull_list', 'pull_list_item')),
  -- What the list shows: the thing's name, and a line about what went with it.
  label text not null,
  detail text,
  -- The deleted row and its dependants, as read just before the delete.
  snapshot jsonb not null,
  -- Storage paths (item photos) the snapshot still points at, removed from
  -- the photos bucket when the snapshot is purged rather than at delete time.
  photo_paths text[] not null default '{}',
  deleted_at timestamptz not null default now(),
  deleted_by uuid references profiles(id) on delete set null
);

create index if not exists deleted_records_org_deleted_at_idx
  on deleted_records (org_id, deleted_at desc);

-- ── Part 2: who can see and touch it ───────────────────────────────────

alter table deleted_records enable row level security;

drop policy if exists "org members can read their deleted records" on deleted_records;
create policy "org members can read their deleted records" on deleted_records
  for select using (org_id = auth_org_id());

-- Written by the person deleting, in their own theatre, under their own name.
drop policy if exists "org members can record their deletions" on deleted_records;
create policy "org members can record their deletions" on deleted_records
  for insert with check (org_id = auth_org_id() and deleted_by = auth.uid());

-- Restoring removes the snapshot, so any member can delete one; deleting
-- forever before the 30 days are up is limited to owners in the app. (A
-- member could already delete the original rows outright under the existing
-- policies, so this is no wider than what they had.)
drop policy if exists "org members can clear their deleted records" on deleted_records;
create policy "org members can clear their deleted records" on deleted_records
  for delete using (org_id = auth_org_id());

-- No update policy: a snapshot is never edited, only restored or cleared.

-- ═══════════════════════════════════════════════════════════════════════
-- Tryout links (migration 013): a private test copy per person, no account.
-- Opening /try/<token> signs in anonymously and joins that link's own test
-- theatre as an owner. See supabase/migrations/013_tryout_links.sql for how
-- to make, rename, switch off and remove them.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists tryout_links (
  -- 32 hex characters from a random UUID: the secret in the link.
  token text primary key,
  org_id uuid not null unique references organizations(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

-- No policies: nothing reads or writes this table except the functions below.
alter table tryout_links enable row level security;
revoke all on tryout_links from anon, authenticated;

-- ── The sample theatre ─────────────────────────────────────────────────

create or replace function seed_sample_theatre(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room_a uuid; room_b uuid; costumes uuid; loft uuid;
  shelf_a uuid; shelf_b uuid; shakespeare uuid; rack uuid;
  noises uuid; twelfth uuid; list_noises uuid; list_twelfth uuid;
begin
  insert into locations (org_id, name, description)
    values (p_org, 'Props Room A', 'Behind the scene shop, ground floor') returning id into room_a;
  insert into locations (org_id, name, description)
    values (p_org, 'Props Room B', 'Basement, past the boiler') returning id into room_b;
  insert into locations (org_id, name, description)
    values (p_org, 'Costume Storage', null) returning id into costumes;
  insert into locations (org_id, name, description)
    values (p_org, 'Loft', 'Above the stage right wing') returning id into loft;
  insert into locations (org_id, parent_location_id, name)
    values (p_org, room_a, 'Shelf A') returning id into shelf_a;
  insert into locations (org_id, parent_location_id, name)
    values (p_org, room_a, 'Shelf B') returning id into shelf_b;
  insert into locations (org_id, parent_location_id, name, description)
    values (p_org, shelf_a, 'Shakespeare box', 'Everything Elizabethan') returning id into shakespeare;
  insert into locations (org_id, parent_location_id, name)
    values (p_org, costumes, 'Rack 1') returning id into rack;

  -- Photos aren't set here: a function can't upload files. They're added
  -- afterwards by scripts/add-sample-photos.mjs, from supabase/sample-photos/.
  insert into items (org_id, location_id, name, category, description, quantity, condition, import_data)
  select p_org, place, name, category, description, quantity, condition, coalesce(extra, '{}'::jsonb)
  from (values
    (shakespeare, 'Yorick''s skull', 'prop', 'Life-size plastic skull. The lower jaw hinges open.', 1, 'good', null::jsonb),
    (shakespeare, 'Stage dagger', 'prop', 'Black double-edged dagger with a ribbed grip. Blunted, for stage use only.', 2, 'good', '{"Inventory No.": "W-031"}'::jsonb),
    (shakespeare, 'Royal crown, blue velvet', 'prop', 'Gold filigree with paste sapphires and pearls, a blue velvet cap and white fur trim.', 1, 'good', null::jsonb),
    (shakespeare, 'Crown, gold', 'prop', 'Aged gold metal crown with fleur-de-lis points, lined in black felt.', 1, 'needs_repair', '{"Notes": "One stud loose"}'::jsonb),
    (shelf_a, 'Violin ornament, brass', 'prop', 'Solid brass violin on a round base, about 30 cm tall.', 1, 'good', null::jsonb),
    (loft, 'Birdcage, gold', 'prop', 'Gold wire birdcage with a hanging hook and a latched door.', 1, 'good', null::jsonb),
    (shelf_a, 'Lantern, black metal', 'prop', 'Square black lantern with glass panes and a ring handle. Battery candle inside.', 1, 'good', null::jsonb),
    (shelf_a, 'Map, framed', 'prop', 'Fantasy map, "The Realms of Derabor", in a dark wood frame carved "Rusty Hook Inn".', 1, 'good', '{"Inventory No.": "P-014", "Donor": "The Hartley family"}'::jsonb),
    (shelf_b, 'Serving platter, black', 'prop', 'Oval glazed platter.', 1, 'good', null::jsonb),
    (shelf_b, 'Serving platter, black', 'prop', 'Oval glazed platter. Small chip on the underside.', 1, 'fair', null::jsonb),
    (shelf_b, 'Mug, monogram A', 'prop', 'White ceramic with a black rim and a gold-edged letter A.', 1, 'good', null::jsonb),
    (shelf_b, 'Dinner plate, white', 'prop', 'Plain white china with a wide rim.', 4, 'good', null::jsonb),
    (shelf_b, 'Rotary telephone', 'prop', 'Black with gold trim and a coiled cord. Bell rings from a battery box.', 1, 'good', null::jsonb),
    (room_b, 'Wooden urn', 'prop', 'Turned wooden vessel, dark and worn smooth.', 1, 'good', null::jsonb),
    (costumes, 'Walking cane, mahogany', 'prop', 'Glossy carved handle with a brass collar.', 1, 'good', null::jsonb),
    (room_b, 'Travel trunk', 'prop', 'Black steamer trunk with studded straps and brass latches. Well travelled; holds a body.', 1, 'good', null::jsonb),
    (loft, 'Curtains, paisley (pair)', 'prop', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', 1, 'fair', null::jsonb),
    (rack, 'Fan, lace', 'costume', 'Folding fan of cream lace on pale bamboo sticks, with a silk tassel.', 1, 'good', null::jsonb),
    (rack, 'Doublet, black and red', 'costume', 'Black wool with red trim, a row of buttons and shoulder wings. Men''s 40R.', 1, 'good', null::jsonb),
    (rack, 'Ruff collar', 'costume', 'Wide white pleated ruff with lace at the neck.', 3, 'new', null::jsonb),
    (rack, 'Spectacles, black frames', 'costume', 'Thick black frames with clear lenses, no prescription.', 2, 'good', null::jsonb),
    (room_b, 'Anvil', 'prop', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', 1, 'good', null::jsonb),
    (room_b, 'Wheelbarrow, wooden', 'prop', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', 1, 'needs_repair', null::jsonb),
    (null, 'Umbrella, blue', 'prop', 'Blue canopy with a wooden crook handle. Opens fully.', 1, 'good', null::jsonb)
  ) as seed(place, name, category, description, quantity, condition, extra);

  insert into productions (org_id, name, start_date, end_date, status)
    values (p_org, 'Noises Off!', current_date + 30, current_date + 60, 'planning') returning id into noises;
  insert into productions (org_id, name, start_date, end_date, status)
    values (p_org, 'Twelfth Night', current_date - 7, current_date + 14, 'in_run') returning id into twelfth;
  insert into pull_lists (production_id) values (noises) returning id into list_noises;
  insert into pull_lists (production_id) values (twelfth) returning id into list_twelfth;

  insert into pull_list_items (pull_list_id, item_id, quantity_needed, status, check_state)
  select list_noises, i.id, n, s, 'open'
  from (values ('Rotary telephone', 1, 'pending'), ('Serving platter, black', 1, 'pending'), ('Travel trunk', 1, 'pulled')) as want(name, n, s)
  cross join lateral (select id from items where org_id = p_org and items.name = want.name order by created_at limit 1) i;

  insert into pull_list_items (pull_list_id, item_id, quantity_needed, status, check_state, checked_at)
  select list_twelfth, i.id, n, 'pulled', c, case when c = 'checked' then now() end
  from (values ('Stage dagger', 2, 'checked'), ('Ruff collar', 3, 'checked'), ('Doublet, black and red', 1, 'open'), ('Dinner plate, white', 2, 'open')) as want(name, n, c)
  cross join lateral (select id from items where org_id = p_org and items.name = want.name order by created_at limit 1) i;
end;
$$;

-- ── Making, naming and opening links ───────────────────────────────────

-- Sample items start with search tags, and test copies have no invite
-- code (migration 016).
create or replace function tag_sample_theatre(p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  -- The values are printed by scripts/sample-tags.mjs, from supabase/sample-photos/tags.json.
  update items i
  set auto_tags = t.tags
  from (values
    ('Yorick''s skull', 'Life-size plastic skull. The lower jaw hinges open.', array['skull', 'head', 'skeleton', 'bones', 'anatomy', 'plastic', 'white', 'ivory', 'hamlet', 'shakespeare', 'elizabethan', 'gothic', 'halloween', 'death', 'graveyard', 'macabre', 'memento mori']),
    ('Stage dagger', 'Black double-edged dagger with a ribbed grip. Blunted, for stage use only.', array['dagger', 'knife', 'blade', 'weapon', 'steel', 'metal', 'black', 'silver', 'medieval', 'renaissance', 'elizabethan', 'combat', 'stage fight', 'assassin', 'macbeth', 'grey', 'gray']),
    ('Royal crown, blue velvet', 'Gold filigree with paste sapphires and pearls, a blue velvet cap and white fur trim.', array['crown', 'headwear', 'regalia', 'jewellery', 'jewels', 'pearls', 'velvet', 'fabric', 'faux fur', 'fur', 'metal', 'blue', 'navy', 'sapphire', 'gold', 'white', 'royal', 'ornate', 'medieval', 'tudor', 'king', 'queen', 'coronation', 'monarch', 'yellow']),
    ('Crown, gold', 'Aged gold metal crown with fleur-de-lis points, lined in black felt.', array['crown', 'headwear', 'regalia', 'metal', 'felt', 'fabric', 'gold', 'black', 'fleur-de-lis', 'medieval', 'gothic', 'aged', 'king', 'queen', 'monarch', 'royalty', 'yellow']),
    ('Violin ornament, brass', 'Solid brass violin on a round base, about 30 cm tall.', array['violin', 'fiddle', 'musical instrument', 'instrument', 'music', 'ornament', 'figurine', 'statue', 'brass', 'metal', 'gold', 'decorative', 'classical', 'set dressing', 'mantelpiece', 'yellow']),
    ('Birdcage, gold', 'Gold wire birdcage with a hanging hook and a latched door.', array['birdcage', 'cage', 'bird', 'wire', 'metal', 'gold', 'victorian', 'ornate', 'decorative', 'hanging', 'parlour', 'set dressing', 'pet', 'yellow']),
    ('Lantern, black metal', 'Square black lantern with glass panes and a ring handle. Battery candle inside.', array['lantern', 'lamp', 'light', 'candle', 'lighting', 'metal', 'glass', 'black', 'cream', 'victorian', 'rustic', 'night', 'street', 'outdoor', 'white']),
    ('Map, framed', 'Fantasy map, "The Realms of Derabor", in a dark wood frame carved "Rusty Hook Inn".', array['map', 'chart', 'picture', 'frame', 'framed', 'wall art', 'artwork', 'wood', 'paper', 'glass', 'brown', 'green', 'blue', 'fantasy', 'pirate', 'nautical', 'tavern', 'inn', 'rustic', 'treasure', 'adventure', 'set dressing']),
    ('Serving platter, black', 'Oval glazed platter.', array['platter', 'plate', 'dish', 'tray', 'serving dish', 'tableware', 'crockery', 'dinnerware', 'ceramic', 'glazed', 'black', 'dinner', 'banquet', 'feast', 'food', 'kitchen']),
    ('Serving platter, black', 'Oval glazed platter. Small chip on the underside.', array['platter', 'plate', 'dish', 'tray', 'serving dish', 'tableware', 'crockery', 'dinnerware', 'ceramic', 'glazed', 'black', 'dinner', 'banquet', 'feast', 'food', 'kitchen']),
    ('Mug, monogram A', 'White ceramic with a black rim and a gold-edged letter A.', array['mug', 'cup', 'drinkware', 'tableware', 'crockery', 'ceramic', 'white', 'black', 'gold', 'letter', 'monogram', 'initial', 'coffee', 'tea', 'breakfast', 'kitchen', 'office', 'yellow']),
    ('Dinner plate, white', 'Plain white china with a wide rim.', array['plate', 'dish', 'tableware', 'crockery', 'dinnerware', 'china', 'porcelain', 'ceramic', 'white', 'dinner', 'meal', 'food', 'banquet', 'kitchen']),
    ('Rotary telephone', 'Black with gold trim and a coiled cord. Bell rings from a battery box.', array['telephone', 'phone', 'rotary', 'dial', 'handset', 'plastic', 'metal', 'black', 'gold', 'vintage', 'retro', '1950s', 'antique', 'office', 'call', 'ringing', 'noir', 'yellow']),
    ('Wooden urn', 'Turned wooden vessel, dark and worn smooth.', array['urn', 'vase', 'pot', 'vessel', 'jar', 'wood', 'brown', 'dark brown', 'rustic', 'antique', 'turned', 'decoration', 'set dressing', 'ashes']),
    ('Walking cane, mahogany', 'Glossy carved handle with a brass collar.', array['cane', 'walking stick', 'stick', 'accessory', 'mahogany', 'wood', 'brass', 'metal', 'brown', 'red', 'gold', 'victorian', 'edwardian', 'gentleman', 'character', 'elderly', 'yellow']),
    ('Travel trunk', 'Black steamer trunk with studded straps and brass latches. Well travelled; holds a body.', array['trunk', 'steamer trunk', 'chest', 'box', 'luggage', 'suitcase', 'storage', 'metal', 'wood', 'leather', 'black', 'grey', 'brass', 'vintage', 'antique', 'victorian', '1920s', 'travel', 'journey', 'hiding place', 'treasure', 'gray', 'gold']),
    ('Curtains, paisley (pair)', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', array['curtains', 'drapes', 'window', 'textile', 'soft furnishing', 'fabric', 'cotton', 'sheer', 'yellow', 'mustard', 'orange', 'rust', 'purple', 'gold', 'paisley', 'pattern', 'bohemian', '1970s', 'window dressing', 'set dressing']),
    ('Fan, lace', 'Folding fan of cream lace on pale bamboo sticks, with a silk tassel.', array['fan', 'folding fan', 'hand fan', 'accessory', 'lace', 'silk', 'fabric', 'bamboo', 'wood', 'cream', 'white', 'ivory', 'beige', 'victorian', 'regency', 'spanish', 'elegant', 'lady', 'ballroom', 'brown']),
    ('Doublet, black and red', 'Black wool with red trim, a row of buttons and shoulder wings. Men''s 40R.', array['doublet', 'jacket', 'coat', 'top', 'menswear', 'wool', 'fabric', 'buttons', 'metal', 'black', 'red', 'elizabethan', 'tudor', 'renaissance', 'shakespeare', 'period', 'nobleman', 'courtier']),
    ('Ruff collar', 'Wide white pleated ruff with lace at the neck.', array['ruff', 'collar', 'neckwear', 'accessory', 'linen', 'cotton', 'lace', 'fabric', 'white', 'pleated', 'elizabethan', 'tudor', 'renaissance', 'shakespeare', 'period', 'nobility']),
    ('Spectacles, black frames', 'Thick black frames with clear lenses, no prescription.', array['spectacles', 'glasses', 'eyeglasses', 'eyewear', 'accessory', 'plastic', 'glass', 'black', 'clear', 'retro', 'geek', 'reading', 'disguise', 'character']),
    ('Anvil', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', array['anvil', 'blacksmith', 'forge', 'smithy', 'tool', 'cast iron', 'iron', 'metal', 'steel', 'black', 'silver', 'grey', 'rustic', 'industrial', 'medieval', 'western', 'workshop', 'heavy', 'cartoon', 'gray']),
    ('Wheelbarrow, wooden', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', array['wheelbarrow', 'barrow', 'cart', 'wheel', 'garden', 'wood', 'metal', 'brown', 'red', 'rustic', 'antique', 'farm', 'country', 'village', 'outdoor']),
    ('Umbrella, blue', 'Blue canopy with a wooden crook handle. Opens fully.', array['umbrella', 'brolly', 'parasol', 'accessory', 'rain', 'fabric', 'nylon', 'metal', 'wood', 'blue', 'brown', 'classic', 'weather', 'outdoor', 'character', 'plastic'])
  ) as t(name, description, tags)
  where i.org_id = p_org
    and i.name = t.name
    and i.description is not distinct from t.description
    and i.auto_tags is distinct from t.tags
$$;

create or replace function create_tryout(p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  new_org uuid;
  new_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if cleaned = '' then
    raise exception 'A tryout link needs a name';
  end if;

  -- No invite code: a test copy is one tester's own (migration 016).
  insert into organizations (name, invite_code)
  values (cleaned || '''s test theatre', null)
  returning id into new_org;

  perform seed_sample_theatre(new_org);
  perform tag_sample_theatre(new_org);

  insert into tryout_links (token, org_id, label) values (new_token, new_org, cleaned);
  return new_token;
end;
$$;

create or replace function rename_tryout(p_token text, p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  target uuid;
begin
  if cleaned = '' then
    raise exception 'A tryout link needs a name';
  end if;
  update tryout_links set label = cleaned where token = p_token returning org_id into target;
  if target is null then
    raise exception 'No tryout link has that token';
  end if;
  update organizations set name = cleaned || '''s test theatre' where id = target;
  -- The people who opened it without an account carry the link's name; a
  -- real account that joined keeps its own.
  update profiles set full_name = cleaned
  where id in (select user_id from memberships where org_id = target)
    and id in (select id from auth.users where is_anonymous);
  return cleaned;
end;
$$;

create or replace function tryout_label(p_token text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select label from tryout_links where token = p_token and disabled_at is null
$$;

create or replace function join_tryout(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  who text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select org_id, label into target, who
  from tryout_links where token = p_token and disabled_at is null;
  if target is null then
    raise exception 'That test link isn''t working any more';
  end if;

  insert into profiles (id, full_name, active_org_id)
  values (auth.uid(), who, target)
  on conflict (id) do update set active_org_id = target;

  -- An owner of their own copy, so every feature can be tried, owner-only
  -- ones included. Opening the link again is harmless.
  insert into memberships (user_id, org_id, role)
  values (auth.uid(), target, 'owner')
  on conflict (user_id, org_id) do nothing;

  return target;
end;
$$;

-- Who may call what. Supabase grants execute on new functions to anon and
-- authenticated by default, so the SQL-editor-only ones are taken back.
revoke all on function seed_sample_theatre(uuid) from public, anon, authenticated;
revoke all on function tag_sample_theatre(uuid) from public, anon, authenticated;
revoke all on function create_tryout(text) from public, anon, authenticated;
revoke all on function rename_tryout(text, text) from public, anon, authenticated;
revoke all on function tryout_label(text) from public;
grant execute on function tryout_label(text) to anon, authenticated;
revoke all on function join_tryout(text) from public, anon;
grant execute on function join_tryout(text) to authenticated;
