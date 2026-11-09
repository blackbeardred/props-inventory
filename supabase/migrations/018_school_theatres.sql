-- ═══════════════════════════════════════════════════════════════════════
-- School theatres: one account, the teacher's
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- A theatre can be marked as a school. A school theatre has exactly one
-- member, the teacher, so a school can use Propolis without any student
-- accounts and without Propolis holding student data.
--
--   1. organizations.is_school, false for every existing theatre.
--   2. The one-member rule, as a trigger on memberships. It refuses a second
--      member however the row arrives: an invite code, a tryout link, any
--      function written later, or an insert from the SQL editor. The app's
--      own users can't insert memberships at all (no insert policy, by
--      design), so this also covers everything running as an admin.
--   3. Turning school mode on only works with exactly one member, and is
--      checked by a trigger on organizations as well as the function.
--   4. A one-time handover link, so the teacher can pass the theatre to a new
--      teacher without there ever being two accounts in it: accepting swaps
--      the old account for the new one in a single transaction.
--
-- Changed functions:
--   create_organization_and_profile  gains p_is_school (default false)
--   regenerate_invite_code           refuses for a school
--   join_organization_with_code      says why a school can't be joined
--   leave_organization               tells a teacher to hand over first
-- New functions:
--   set_school_mode(boolean)         owners only, the open theatre
--   create_school_handover()         the teacher makes (or remakes) a link
--   cancel_school_handover()         the teacher switches the link off
--   school_handover_info(token)      what the link page shows
--   accept_school_handover(token, name)   the new teacher takes over
--   create_school_handover_for(org)  SQL editor only: a link for a school
--                                    whose teacher is gone
--
-- No existing RLS policy changes. One new table, school_handovers, with RLS
-- on and no policies: only the functions above touch it.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. The setting ─────────────────────────────────────────────────────

alter table organizations add column if not exists is_school boolean not null default false;

-- ── 2. One member, enforced on the table ───────────────────────────────

create or replace function enforce_school_single_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  school boolean;
begin
  -- Lock the theatre's row, so two joins at the same moment, or a join and
  -- a switch to school mode, are taken one after the other and can't both
  -- find the seat empty. Locked whether or not it's a school yet: a switch
  -- in progress must be waited for, then read as it ends up.
  select is_school into school from organizations where id = new.org_id for update;
  if school and exists (
    select 1 from memberships where org_id = new.org_id and user_id <> new.user_id
  ) then
    raise exception 'School theatres have one account, the teacher''s.';
  end if;
  return new;
end;
$$;

drop trigger if exists school_single_member on memberships;
create trigger school_single_member
  before insert or update of org_id, user_id on memberships
  for each row execute function enforce_school_single_member();

-- ── 3. Turning school mode on needs exactly one member ─────────────────

create or replace function enforce_school_mode_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_school and not old.is_school then
    if (select count(*) from memberships where org_id = new.id) > 1 then
      raise exception 'School theatres have one account, the teacher''s.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists school_mode_switch on organizations;
create trigger school_mode_switch
  before update of is_school on organizations
  for each row execute function enforce_school_mode_switch();

create or replace function set_school_mode(p_school boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid := auth_org_id();
  others text;
begin
  if caller_org_id is null then
    raise exception 'You have no active organization';
  end if;
  if auth_org_role() is distinct from 'owner' then
    raise exception 'Only an owner can change this setting.';
  end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), false)
     or exists (select 1 from tryout_links where org_id = caller_org_id) then
    raise exception 'A test copy can''t be made a school.';
  end if;

  -- Hold the theatre still while the members are counted.
  perform 1 from organizations where id = caller_org_id for update;

  if p_school then
    select string_agg(coalesce(nullif(btrim(p.full_name), ''), 'Unnamed member'), ', ' order by m.created_at)
      into others
    from memberships m join profiles p on p.id = m.user_id
    where m.org_id = caller_org_id and m.user_id <> auth.uid();

    if others is not null then
      raise exception 'Remove everyone else first: %. A school theatre has one account, the teacher''s.', others;
    end if;

    -- No code to share: the old one stops working the moment this is on.
    update organizations set is_school = true, invite_code = null where id = caller_org_id;
  else
    -- Back to normal. A handover link only means something for a school.
    -- The invite code stays empty until the owner makes a new one.
    delete from school_handovers where org_id = caller_org_id;
    update organizations set is_school = false where id = caller_org_id;
  end if;
end;
$$;

-- ── 4. Handover links ─────────────────────────────────────────────────

create table if not exists school_handovers (
  -- 32 hex characters from a random UUID: the secret in the link.
  token text primary key,
  -- One live link per school: making a new one replaces the old.
  org_id uuid not null unique references organizations(id) on delete cascade,
  -- Kept if that account is later deleted, so a link made before still works.
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

-- No policies: nothing reads or writes this table except the functions here.
alter table school_handovers enable row level security;
revoke all on school_handovers from anon, authenticated;

create or replace function create_school_handover()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid := auth_org_id();
  new_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if caller_org_id is null then
    raise exception 'You have no active organization';
  end if;
  if auth_org_role() is distinct from 'owner' then
    raise exception 'Only the teacher can hand the theatre over.';
  end if;
  if not (select is_school from organizations where id = caller_org_id) then
    raise exception 'Handover links are for school theatres.';
  end if;

  delete from school_handovers where org_id = caller_org_id;
  insert into school_handovers (token, org_id, created_by)
  values (new_token, caller_org_id, auth.uid());
  return new_token;
end;
$$;

create or replace function cancel_school_handover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org_id uuid := auth_org_id();
begin
  if caller_org_id is null or auth_org_role() is distinct from 'owner' then
    raise exception 'Only the teacher can cancel a handover link.';
  end if;
  delete from school_handovers where org_id = caller_org_id;
end;
$$;

-- What the link's page shows, before anyone accepts: the theatre, who is
-- handing it over, and when the link stops working. Nothing for a dead link.
create or replace function school_handover_info(p_token text)
returns table (theatre_name text, from_name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.name, p.full_name, h.expires_at
  from school_handovers h
  join organizations o on o.id = h.org_id and o.is_school
  left join profiles p on p.id = h.created_by
  where h.token = p_token and h.expires_at > now()
$$;

create or replace function accept_school_handover(p_token text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  leaving uuid;
  cleaned text := nullif(btrim(regexp_replace(coalesce(member_name, ''), '\s+', ' ', 'g')), '');
begin
  if auth.uid() is null then
    raise exception 'Log in first.';
  end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), false) then
    raise exception 'Sign up with your own email first.';
  end if;

  -- Taking the link row locks it, so two people accepting at once can't
  -- both win: the second finds it gone.
  select org_id into target from school_handovers
  where token = p_token and expires_at > now()
  for update;
  if target is null then
    raise exception 'This handover link isn''t working. Ask the teacher for a new one.';
  end if;

  perform 1 from organizations where id = target and is_school for update;
  if not found then
    raise exception 'This handover link isn''t working. Ask the teacher for a new one.';
  end if;

  if exists (select 1 from memberships where org_id = target and user_id = auth.uid()) then
    raise exception 'You''re already the teacher for this theatre.';
  end if;

  -- The swap. The old account goes first, so the theatre never has two.
  select user_id into leaving from memberships where org_id = target;
  delete from memberships where org_id = target;

  insert into profiles (id, full_name, active_org_id)
  values (auth.uid(), coalesce(cleaned, 'Teacher'), target)
  on conflict (id) do update set active_org_id = target;

  insert into memberships (user_id, org_id, role) values (auth.uid(), target, 'owner');

  -- The old teacher lands on another theatre of theirs, or nowhere.
  if leaving is not null then
    update profiles
    set active_org_id = (
      select org_id from memberships where user_id = leaving order by created_at limit 1
    )
    where id = leaving and active_org_id = target;
  end if;

  delete from school_handovers where org_id = target;
  return target;
end;
$$;

-- For Arjun, in the SQL editor: a link for a school whose teacher has gone
-- (left the school, lost their login, or had their account deleted).
create or replace function create_school_handover_for(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if not coalesce((select is_school from organizations where id = p_org), false) then
    raise exception 'That theatre isn''t a school.';
  end if;
  delete from school_handovers where org_id = p_org;
  insert into school_handovers (token, org_id, created_by) values (new_token, p_org, null);
  return new_token;
end;
$$;

-- ── 5. Existing functions, school-aware ───────────────────────────────

-- Creating a theatre can make it a school from the start. The old
-- two-argument version is dropped so calls aren't ambiguous; the new one
-- takes the same two named arguments, so the app works before and after.
drop function if exists create_organization_and_profile(text, text);
create or replace function create_organization_and_profile(
  org_name text,
  member_name text,
  p_is_school boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  new_invite_code text;
begin
  if p_is_school and coalesce((select is_anonymous from auth.users where id = auth.uid()), false) then
    raise exception 'Sign up with your own email to set up a school.';
  end if;

  -- A school has no invite code: nobody else can join it.
  if not p_is_school then
    new_invite_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  end if;

  insert into organizations (name, invite_code, is_school)
  values (org_name, new_invite_code, p_is_school)
  returning id into new_org_id;

  insert into profiles (id, full_name, active_org_id)
  values (auth.uid(), member_name, new_org_id)
  on conflict (id) do update set active_org_id = new_org_id;

  insert into memberships (user_id, org_id, role)
  values (auth.uid(), new_org_id, 'owner');

  return new_org_id;
end;
$$;

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

  if (select is_school from organizations where id = caller_org_id) then
    raise exception 'School theatres have one account, the teacher''s.';
  end if;

  new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  update organizations set invite_code = new_code where id = caller_org_id;

  return new_code;
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
  target_is_school boolean;
begin
  select id, is_school into target_org_id, target_is_school from organizations
  where invite_code = upper(p_invite_code);

  if target_org_id is null then
    raise exception 'Invite code not found';
  end if;

  -- A school never has a code, but say why rather than "not found" if one
  -- was ever set by hand. The trigger refuses it either way.
  if target_is_school then
    raise exception 'School theatres have one account, the teacher''s.';
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

  -- A school's teacher is its only account: leaving would strand it.
  if (select is_school from organizations where id = p_org_id) then
    raise exception 'You''re the teacher for this school theatre. Hand it over to the new teacher first, from the Theatre page.';
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

-- ── 6. Who may call what ───────────────────────────────────────────────
-- Supabase grants execute on new functions to anon and authenticated by
-- default, so each is set explicitly.

revoke all on function enforce_school_single_member() from public, anon, authenticated;
revoke all on function enforce_school_mode_switch() from public, anon, authenticated;
revoke all on function set_school_mode(boolean) from public, anon;
grant execute on function set_school_mode(boolean) to authenticated;
revoke all on function create_school_handover() from public, anon;
grant execute on function create_school_handover() to authenticated;
revoke all on function cancel_school_handover() from public, anon;
grant execute on function cancel_school_handover() to authenticated;
revoke all on function school_handover_info(text) from public;
grant execute on function school_handover_info(text) to anon, authenticated;
revoke all on function accept_school_handover(text, text) from public, anon;
grant execute on function accept_school_handover(text, text) to authenticated;
revoke all on function create_school_handover_for(uuid) from public, anon, authenticated;
revoke all on function create_organization_and_profile(text, text, boolean) from public, anon;
grant execute on function create_organization_and_profile(text, text, boolean) to authenticated;
