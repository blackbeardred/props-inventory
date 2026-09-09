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
-- Profiles (one row per Supabase auth user, linked to an org)
-- ─────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);

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
  -- Editable on the item edit page, since the AI can guess wrong.
  auto_tags text[] not null default '{}',
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
  p_auto_tags text[]
)
returns text
language sql
immutable
as $$
  select coalesce(p_name, '') || ' ' || coalesce(p_description, '') || ' ' || coalesce(array_to_string(p_auto_tags, ' '), '')
$$;

-- Full-text search over name + description + auto_tags (Day 9), used by the
-- search page. auto_tags is never shown in the UI but still affects matches.
create index items_search_idx on items using gin (
  to_tsvector('english', items_search_document(name, description, auto_tags))
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
alter table locations enable row level security;
alter table items enable row level security;
alter table productions enable row level security;
alter table pull_lists enable row level security;
alter table pull_list_items enable row level security;

create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid()
$$;

create policy "org members can read their org" on organizations
  for select using (id = auth_org_id());

create policy "org members can read profiles in their org" on profiles
  for select using (org_id = auth_org_id());

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
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'Profile already exists for this user';
  end if;

  new_invite_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into organizations (name, invite_code) values (org_name, new_invite_code) returning id into new_org_id;

  insert into profiles (id, org_id, full_name, role)
  values (auth.uid(), new_org_id, member_name, 'owner');

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
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'Profile already exists for this user';
  end if;

  select id into target_org_id from organizations where invite_code = upper(p_invite_code);

  if target_org_id is null then
    raise exception 'Invite code not found';
  end if;

  insert into profiles (id, org_id, full_name, role)
  values (auth.uid(), target_org_id, member_name, 'member');

  return target_org_id;
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
  where to_tsvector('english', items_search_document(name, description, auto_tags))
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
  caller_org_id uuid;
  caller_role text;
  new_code text;
begin
  select org_id, role into caller_org_id, caller_role from profiles where id = auth.uid();

  if caller_role is distinct from 'owner' then
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
  caller_org_id uuid;
  caller_role text;
  target_org_id uuid;
  target_role text;
  owner_count int;
begin
  if new_role not in ('owner', 'member') then
    raise exception 'Invalid role: %', new_role;
  end if;

  select org_id, role into caller_org_id, caller_role from profiles where id = auth.uid();

  if caller_role is distinct from 'owner' then
    raise exception 'Only an organization owner can change member roles';
  end if;

  select org_id, role into target_org_id, target_role from profiles where id = target_profile_id;

  if target_org_id is null or target_org_id is distinct from caller_org_id then
    raise exception 'That member is not in your organization';
  end if;

  if target_role = 'owner' and new_role = 'member' then
    select count(*) into owner_count from profiles where org_id = caller_org_id and role = 'owner';
    if owner_count <= 1 then
      raise exception 'An organization must keep at least one owner';
    end if;
  end if;

  update profiles set role = new_role where id = target_profile_id;
end;
$$;

create or replace function remove_member(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid;
  caller_role text;
  target_org_id uuid;
  target_role text;
  owner_count int;
begin
  select org_id, role into caller_org_id, caller_role from profiles where id = auth.uid();

  if caller_role is distinct from 'owner' then
    raise exception 'Only an organization owner can remove a member';
  end if;

  if target_profile_id = auth.uid() then
    raise exception 'You can''t remove yourself. Have another owner do it, or leave from your account settings instead.';
  end if;

  select org_id, role into target_org_id, target_role from profiles where id = target_profile_id;

  if target_org_id is null or target_org_id is distinct from caller_org_id then
    raise exception 'That member is not in your organization';
  end if;

  if target_role = 'owner' then
    select count(*) into owner_count from profiles where org_id = caller_org_id and role = 'owner';
    if owner_count <= 1 then
      raise exception 'An organization must keep at least one owner';
    end if;
  end if;

  delete from profiles where id = target_profile_id;
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
    (prefix_query is null or to_tsvector('english', items_search_document(name, description, auto_tags)) @@ prefix_query)
    and (location_ids is null or location_id = any(location_ids))
  order by name;
end;
$$;
