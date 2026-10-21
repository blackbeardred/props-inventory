-- ═══════════════════════════════════════════════════════════════════════
-- Tryout links: a private test copy of Propolis per person, no account
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Each link (https://…/try/<token>) belongs to one test theatre of its own,
-- seeded with a small sample inventory. Opening it signs the browser in as a
-- Supabase *anonymous* user (Authentication → Sign In / Providers → Allow
-- anonymous sign-ins must be on) and makes that user an owner of the link's
-- theatre. From then on it's an ordinary theatre: every RLS policy already
-- keeps it apart from every other theatre through auth_org_id(), so no
-- existing table, function or policy changes here.
--
--   tryout_links               which token opens which theatre, and for whom
--   create_tryout(label)       SQL editor only: a new test theatre + its link
--   rename_tryout(token, label) SQL editor only: "Tester 3" becomes "Gregg"
--   tryout_label(token)        anyone: the name on a link, or null if it's off
--   join_tryout(token)         signed in (anonymous or not): join that theatre
--   seed_sample_theatre(org)   internal: the sample rooms, props and shows
--
-- Making ten:   select create_tryout('Tester ' || n) from generate_series(1, 10) n;
-- Listing them: select label, 'https://props-inventory-xi.vercel.app/try/' || token
--               from tryout_links order by created_at;
-- Switching one off: update tryout_links set disabled_at = now() where label = 'Tester 3';
-- Removing them all, and everything in them:
--               delete from organizations where id in (select org_id from tryout_links);
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

  insert into items (org_id, location_id, name, category, description, quantity, condition, import_data)
  select p_org, place, name, category, description, quantity, condition, coalesce(extra, '{}'::jsonb)
  from (values
    (shakespeare, 'Yorick''s skull', 'prop', 'Resin, lightly aged. Lower jaw is loose.', 1, 'good', null::jsonb),
    (shakespeare, 'Rapier, steel-hilt', 'prop', 'Blunted stage rapier with a swept hilt.', 2, 'good', '{"Inventory No.": "W-031"}'::jsonb),
    (shakespeare, 'Quill and inkwell', 'prop', 'Goose feather quill, pewter inkwell.', 1, 'fair', null),
    (shakespeare, 'Pewter tankard', 'prop', null, 4, 'good', null),
    (shakespeare, 'Crown (Prop)', 'prop', 'Gold-painted brass, paste stones.', 1, 'needs_repair', '{"Notes": "Two stones missing"}'::jsonb),
    (shelf_a, 'Brass candlestick', 'prop', 'Tall, with a drip tray.', 1, 'good', null),
    (shelf_a, 'Brass candlestick', 'prop', 'Short, slightly dented base.', 1, 'fair', null),
    (shelf_a, 'Oil lantern', 'prop', 'Battery LED inside; glass chimney is real.', 1, 'good', null),
    (shelf_a, 'Map (Aged)', 'prop', 'Tea-stained parchment of a made-up coastline.', 1, 'good', '{"Inventory No.": "P-014", "Donor": "The Hartley family"}'::jsonb),
    (shelf_b, 'Silver Tray', 'prop', 'Oval, with handles.', 1, 'good', null),
    (shelf_b, 'Silver Tray', 'prop', 'Oval, with handles. Scratched underneath.', 1, 'fair', null),
    (shelf_b, 'Tea set', 'prop', 'Brass-handled teapot and four cups.', 1, 'good', null),
    (shelf_b, 'Rotary telephone', 'prop', 'Black, 1950s. Bell rings from a battery box.', 1, 'good', null),
    (room_b, 'Wooden chair', 'prop', 'Plain kitchen chair, pine.', 4, 'good', null),
    (room_b, 'Ladderback chair, carved oak', 'prop', null, 2, 'fair', null),
    (room_b, 'Travel trunk', 'prop', 'Leather straps, brass corners. Holds a body.', 1, 'good', null),
    (room_b, 'Rug (Persian style)', 'prop', 'Red and blue, about 2 by 3 metres. Orange/rust border.', 1, 'fair', null),
    (rack, 'Velvet cloak', 'costume', 'Deep green, full length, with a hood.', 1, 'good', null),
    (rack, 'Doublet, black', 'costume', 'Slashed sleeves, men''s 40R.', 1, 'good', null),
    (rack, 'Ruff collar', 'costume', 'Starched linen.', 3, 'new', null),
    (rack, 'Bowler hat', 'costume', null, 2, 'good', null),
    (loft, 'Fishing net', 'prop', 'About 3 metres square, hemp.', 1, 'fair', null),
    (loft, 'Bicycle, 1920s', 'prop', 'Rides, but the brakes don''t. Walk it on.', 1, 'needs_repair', null),
    (null, 'Umbrella, black', 'prop', 'Opens fully.', 3, 'good', null)
  ) as seed(place, name, category, description, quantity, condition, extra);

  insert into productions (org_id, name, start_date, end_date, status)
    values (p_org, 'Noises Off!', current_date + 30, current_date + 60, 'planning') returning id into noises;
  insert into productions (org_id, name, start_date, end_date, status)
    values (p_org, 'Twelfth Night', current_date - 7, current_date + 14, 'in_run') returning id into twelfth;
  insert into pull_lists (production_id) values (noises) returning id into list_noises;
  insert into pull_lists (production_id) values (twelfth) returning id into list_twelfth;

  insert into pull_list_items (pull_list_id, item_id, quantity_needed, status, check_state)
  select list_noises, i.id, n, s, 'open'
  from (values ('Rotary telephone', 1, 'pending'), ('Silver Tray', 1, 'pending'), ('Travel trunk', 1, 'pulled')) as want(name, n, s)
  cross join lateral (select id from items where org_id = p_org and items.name = want.name order by created_at limit 1) i;

  insert into pull_list_items (pull_list_id, item_id, quantity_needed, status, check_state, checked_at)
  select list_twelfth, i.id, n, 'pulled', c, case when c = 'checked' then now() end
  from (values ('Rapier, steel-hilt', 2, 'checked'), ('Ruff collar', 3, 'checked'), ('Doublet, black', 1, 'open'), ('Pewter tankard', 2, 'open')) as want(name, n, c)
  cross join lateral (select id from items where org_id = p_org and items.name = want.name order by created_at limit 1) i;
end;
$$;

-- ── Making, naming and opening links ───────────────────────────────────

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

  insert into organizations (name, invite_code)
  values (cleaned || '''s test theatre', upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)))
  returning id into new_org;

  perform seed_sample_theatre(new_org);

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
revoke all on function create_tryout(text) from public, anon, authenticated;
revoke all on function rename_tryout(text, text) from public, anon, authenticated;
revoke all on function tryout_label(text) from public;
grant execute on function tryout_label(text) to anon, authenticated;
revoke all on function join_tryout(text) from public, anon;
grant execute on function join_tryout(text) to authenticated;
