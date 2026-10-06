-- Migration 010: exactly two policies on item_photo_embeddings, again.
--
-- The live database was found with FOUR policies on item_photo_embeddings:
-- the two that 006 creates, and the two from the five-step SQL draft that
-- came before 006 ("org members read embeddings", "org members write
-- embeddings"). 006 drops those draft names, so they must have come back
-- after it ran (the draft pasted again, most likely). RLS policies are OR'd
-- together, and the draft's write policy only checks org_id: with it in
-- place, a member of one theatre can insert a fingerprint carrying their own
-- org_id against another theatre's item_id, and then read that item's name
-- back out of match_items. That is the hole 006's write policy exists to
-- close (Day 18 notes, "Superseding a policy doesn't replace it").
--
-- This migration:
--   1. drops the two draft names explicitly;
--   2. drops any OTHER policy on the table that isn't one of the two below,
--      whatever it's called, and says which in a NOTICE, so the next
--      stray name can't do this again either;
--   3. re-creates the two intended policies, exactly as 006 defines them,
--      so their definitions are known even if they were edited by hand;
--   4. stops with an error if anything other than those two is left.
--
-- No other table, policy or function is touched. Safe to run more than once.
-- Parts 2 and 4 are $$ blocks; if a paste is cut short, run the parts
-- separately, in order.

-- ── Part 1: the draft's two names ──────────────────────────────────────

drop policy if exists "org members read embeddings" on item_photo_embeddings;
drop policy if exists "org members write embeddings" on item_photo_embeddings;

-- ── Part 2: anything else that isn't one of the intended two ───────────

do $sweep$
declare
  stray record;
begin
  for stray in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'item_photo_embeddings'
      and policyname not in (
        'org members can read their item embeddings',
        'org members can manage their item embeddings'
      )
  loop
    raise notice 'Dropping stray policy % on item_photo_embeddings', quote_ident(stray.policyname);
    execute format('drop policy %I on public.item_photo_embeddings', stray.policyname);
  end loop;
end
$sweep$;

-- ── Part 3: the two intended policies, as 006 defines them ─────────────

alter table item_photo_embeddings enable row level security;

drop policy if exists "org members can read their item embeddings" on item_photo_embeddings;
create policy "org members can read their item embeddings" on item_photo_embeddings
  for select using (org_id = auth_org_id());

-- The `exists` check is the point: the item must be the caller's theatre's
-- own, not just the org_id written on the row.
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

-- ── Part 4: prove it ───────────────────────────────────────────────────

do $check$
declare
  found text;
begin
  select string_agg(policyname, ', ' order by policyname) into found
  from pg_policies
  where schemaname = 'public' and tablename = 'item_photo_embeddings';
  if found is distinct from
     'org members can manage their item embeddings, org members can read their item embeddings' then
    raise exception 'item_photo_embeddings should have exactly the two intended policies, but has: %', found;
  end if;
end
$check$;
