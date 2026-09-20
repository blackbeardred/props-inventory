-- ═══════════════════════════════════════════════════════════════════════
-- Multi-organization membership + account page
--
-- Run in the Supabase SQL Editor. Safe to run more than once: the two
-- statements that read the old profiles.org_id column are guarded, so a
-- re-run after a partial or completed run is a no-op rather than an error.
--
-- The idea: membership (which organizations you belong to) is split from
-- the active choice (which one you are looking at right now). auth_org_id()
-- still returns exactly one uuid, so every existing policy on items,
-- locations, productions, pull_lists, pull_list_items and storage.objects
-- keeps working unchanged. Only the function underneath them moves.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Membership becomes its own table ───────────────────────────────
create table if not exists memberships (
  user_id uuid not null references profiles(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index if not exists memberships_org_id_idx on memberships(org_id);

-- Backfill from the existing one-org-per-person rows. Lossless, and must
-- run before the columns it reads are dropped below.
do $mig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'org_id'
  ) then
    insert into memberships (user_id, org_id, role, created_at)
    select id, org_id, role, created_at from profiles
    on conflict (user_id, org_id) do nothing;
  end if;
end
$mig$;

-- ── 2. profiles becomes the person, not the membership ────────────────
alter table profiles add column if not exists active_org_id uuid
  references organizations(id) on delete set null;
alter table profiles add column if not exists avatar_url text;

do $mig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'org_id'
  ) then
    update profiles set active_org_id = org_id where active_org_id is null;
  end if;
end
$mig$;

-- ── 3. The security functions everything resolves through ─────────────

-- Every organization the caller belongs to. security definer specifically
-- so that a policy ON memberships can call it without recursing into
-- memberships' own policy, which Postgres would loop on forever.
create or replace function auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from memberships where user_id = auth.uid()
$$;

-- Everyone the caller shares an organization with (including themselves).
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

-- The caller's active organization -- but only while a membership for it
-- still exists. That join is the safety hinge: revoke someone's membership
-- and this returns null on their very next query, so every policy that
-- resolves through it denies them. Access cannot outlive membership.
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

-- The caller's role in that active organization.
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

-- ── 4. RLS: the new table, and the reads that had to widen ────────────
alter table memberships enable row level security;

drop policy if exists "members can read memberships in their orgs" on memberships;
create policy "members can read memberships in their orgs" on memberships
  for select using (org_id in (select auth_org_ids()));
-- No insert/update/delete policy, by design: the only way to write a
-- membership is through a security definer function with a role check in it.

-- You can now belong to several organizations, so reading "your org"
-- becomes reading any of them.
drop policy if exists "org members can read their org" on organizations;
drop policy if exists "org members can read their orgs" on organizations;
create policy "org members can read their orgs" on organizations
  for select using (id in (select auth_org_ids()));

-- The old profiles policy keyed on profiles.org_id, which no longer exists.
drop policy if exists "org members can read profiles in their org" on profiles;
drop policy if exists "members can read profiles they share an org with" on profiles;
create policy "members can read profiles they share an org with" on profiles
  for select using (id = auth.uid() or id in (select auth_peer_ids()));

-- New: the account page edits your own name, avatar and active organization
-- directly. Scoped to your own row. Setting active_org_id to an organization
-- you don't belong to is harmless -- auth_org_id() joins through memberships,
-- so it would simply return null and grant nothing.
drop policy if exists "members can update their own profile" on profiles;
create policy "members can update their own profile" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Only now can the single-org columns go: the policy that referenced
-- profiles.org_id has just been dropped, and auth_org_id() was rewritten
-- above to stop reading it. Dropping them any earlier fails with
-- "cannot drop column org_id ... policy ... depends on it".
alter table profiles drop column if exists org_id;
alter table profiles drop column if exists role;

-- ── 5. Onboarding and joining, now additive rather than once-only ─────
-- Both functions used to raise if a profile already existed. That rejection
-- is exactly what blocks an existing user starting or joining a second
-- theatre, so it goes: the profile is the person and may well exist; the
-- membership is what is always new.
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

-- ── 6. Leaving and switching ──────────────────────────────────────────
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

-- ── 7. The Day 7 management functions, repointed at memberships ───────
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

-- Removing a member now removes them from THIS organization only. Their
-- account and any other memberships they hold are untouched.
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

-- ── 8. Avatars ────────────────────────────────────────────────────────
-- Private bucket, objects at `${user_id}/${filename}`. Readable by people
-- you share an organization with, writable only by you. Same signed-URL
-- approach as item-photos rather than a public bucket, so a volunteer's
-- face isn't sitting on a guessable public URL.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists "members can read avatars from their orgs" on storage.objects;
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

drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1]::uuid = auth.uid()
);

drop policy if exists "users can update their own avatar" on storage.objects;
create policy "users can update their own avatar"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1]::uuid = auth.uid()
);

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1]::uuid = auth.uid()
);

-- PostgREST's schema cache goes stale right after DDL (the Day 9 lesson).
notify pgrst, 'reload schema';
