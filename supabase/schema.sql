-- Day 2 schema: run this in the Supabase SQL editor after creating your project.
-- Scope: organizations, locations, items (props/costumes), productions, pull lists.
-- Deliberately excludes: AI classification, OCR, QR codes, marketplace, billing.

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
  -- AI-generated tags from the item's photo (material, color, style — e.g.
  -- "wood", "brown"), Day 9. Deliberately never shown in item lists or
  -- search results — only affects which items a text search matches.
  -- Editable on the item edit page, since the AI can guess wrong. Fully
  -- overwritten whenever a photo is (re-)tagged — see manual_tags below for
  -- the tags that survive that.
  auto_tags text[] not null default '{}',
  -- User-typed tags (Day 11), kept separate from auto_tags specifically so
  -- that uploading a new photo or clicking "Regenerate tags from photo"
  -- never wipes out a tag someone added by hand. Folded into search
  -- alongside auto_tags (see items_search_document below) but, like
  -- auto_tags, never shown in item lists or search results.
  manual_tags text[] not null default '{}',
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
  p_manual_tags text[]
)
returns text
language sql
immutable
as $$
  select coalesce(p_name, '') || ' ' || coalesce(p_description, '') || ' '
    || coalesce(array_to_string(p_auto_tags, ' '), '') || ' '
    || coalesce(array_to_string(p_manual_tags, ' '), '')
$$;

-- Full-text search over name + description + auto_tags + manual_tags
-- (Day 9, extended Day 11 for manual_tags). Neither tag column is ever
-- shown in the UI but both affect matches.
create index items_search_idx on items using gin (
  to_tsvector('english', items_search_document(name, description, auto_tags, manual_tags))
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
  created_at timestamptz not null default now()
);

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
create or replace function search_items(search_query text)
returns setof items
language sql
stable
as $$
  select *
  from items
  where to_tsvector('english', items_search_document(name, description, auto_tags, manual_tags))
        @@ websearch_to_tsquery('english', search_query)
  order by name
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
    -- Strip anything that isn't a letter or digit from each word *before*
    -- appending the prefix marker, then join into a tsquery-syntax string
    -- like "glo:* & mic:*" — each word becomes its own prefix lexeme, so
    -- results narrow as more letters are typed.
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

  return query
  select *
  from items
  where
    (prefix_query is null or to_tsvector('english', items_search_document(name, description, auto_tags, manual_tags)) @@ prefix_query)
    and (location_ids is null or location_id = any(location_ids))
  order by name;
end;
$$;
