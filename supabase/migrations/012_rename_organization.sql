-- ═══════════════════════════════════════════════════════════════════════
-- Renaming a theatre
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- A theatre's name was fixed at sign-up: organizations has no UPDATE
-- policy (by design, Day 3), so nothing in the app could change it. This
-- adds one function, rename_organization(new_name), in the same pattern as
-- regenerate_invite_code() (Day 7): security definer, so it can make this
-- one controlled change, with the checks inside it.
--
--   - Owners only, and only the theatre the caller currently has open.
--   - The name is tidied (spaces trimmed, runs of spaces made one) and must
--     be 1 to 100 characters.
--
-- No table, column or policy changes. Members still can't update the
-- organizations table directly; this function is the only way.
-- ═══════════════════════════════════════════════════════════════════════

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

-- PostgREST's schema cache goes stale right after DDL (the Day 9 lesson).
notify pgrst, 'reload schema';
