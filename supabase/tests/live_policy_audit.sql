-- Read-only audit of the live database's row-level security policies.
--
-- Paste into the Supabase SQL Editor. It changes nothing. Three result sets:
--
--   1. Every policy on item_photo_embeddings with its full definition. There
--      should be exactly two, and the ALL one's with_check must test
--      `exists (select 1 from items i ...)`.
--   2. Any policy in public or storage that schema.sql doesn't define
--      ("unexpected"), or that schema.sql defines and the database lacks
--      ("missing", e.g. a migration that hasn't been run yet). No rows means
--      the live policies match the repo.
--   3. Fingerprints whose org_id doesn't match their item's org. Only the
--      draft's org-only write policy could have let one in, so a row here is
--      that hole having been used (or a test of it).
--
-- supabase/tests/embedding_policies_test.sh runs part 2 against schema.sql,
-- so a new policy added to schema.sql without being added here fails the
-- test, and this list can't quietly go stale.

-- 1 ────────────────────────────────────────────────────────────────────
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'item_photo_embeddings'
order by policyname;

-- 2 ────────────────────────────────────────────────────────────────────
with expected (schemaname, tablename, policyname) as (
  values
    ('public', 'deleted_records', 'org members can clear their deleted records'),
    ('public', 'deleted_records', 'org members can read their deleted records'),
    ('public', 'deleted_records', 'org members can record their deletions'),
    ('public', 'item_photo_embeddings', 'org members can manage their item embeddings'),
    ('public', 'item_photo_embeddings', 'org members can read their item embeddings'),
    ('public', 'item_reference_photos', 'org members can manage their reference photos'),
    ('public', 'item_reference_photos', 'org members can read their reference photos'),
    ('public', 'item_twins', 'org members can manage their twins'),
    ('public', 'item_twins', 'org members can read their twins'),
    ('public', 'items', 'org members can manage their items'),
    ('public', 'locations', 'org members can manage their locations'),
    ('public', 'memberships', 'members can read memberships in their orgs'),
    ('public', 'organizations', 'org members can read their orgs'),
    ('public', 'productions', 'org members can manage their productions'),
    ('public', 'profiles', 'members can read profiles they share an org with'),
    ('public', 'profiles', 'members can update their own profile'),
    ('public', 'pull_list_items', 'org members can manage their pull list items'),
    ('public', 'pull_lists', 'org members can manage their pull lists'),
    ('storage', 'objects', 'members can read avatars from their orgs'),
    ('storage', 'objects', 'org members can delete their item photos'),
    ('storage', 'objects', 'org members can read their item photos'),
    ('storage', 'objects', 'org members can update their item photos'),
    ('storage', 'objects', 'org members can upload their item photos'),
    ('storage', 'objects', 'users can delete their own avatar'),
    ('storage', 'objects', 'users can update their own avatar'),
    ('storage', 'objects', 'users can upload their own avatar')
),
actual as (
  select schemaname::text, tablename::text, policyname::text
  from pg_policies
  where schemaname in ('public', 'storage')
)
select 'unexpected' as problem, a.schemaname, a.tablename, a.policyname
from actual a
left join expected e using (schemaname, tablename, policyname)
where e.policyname is null
union all
select 'missing', e.schemaname, e.tablename, e.policyname
from expected e
left join actual a using (schemaname, tablename, policyname)
where a.policyname is null
order by 1, 2, 3, 4;

-- 3 ────────────────────────────────────────────────────────────────────
select e.item_id, e.org_id as fingerprint_org, i.org_id as item_org, e.created_at
from item_photo_embeddings e
join items i on i.id = e.item_id
where e.org_id <> i.org_id
order by e.created_at;
