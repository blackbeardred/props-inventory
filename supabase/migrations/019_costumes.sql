-- ═══════════════════════════════════════════════════════════════════════
-- Costumes on pull lists (migration 019)
--
-- Run in the Supabase SQL Editor, after 018. Safe to run more than once.
-- Approved by Arjun on Nov 9, 2026.
--
-- A pull list can hold named groups of lines: "Margaret costume" holding the
-- long white dress, corset, tartan shawl, white socks, clogs, hairnet and
-- gloves. The group is a heading over ordinary pull-list lines, so status,
-- checklists, "not checked" and swipes all keep working on each piece.
-- Called a group in the database so the same thing serves prop sets too
-- ("Tea set"); the app calls it a costume.
--
--   1. pull_list_groups: id, pull_list_id, name, position, created_at.
--      RLS like pull_list_items: the list must belong to your theater.
--   2. pull_list_items.group_id, nullable. A line can only join a group on
--      its own pull list (a two-column foreign key). Deleting a group leaves
--      its pieces on the list as loose lines; the app removes them too when
--      asked to.
--   3. deleted_records may hold a deleted costume ('pull_list_group'), so a
--      costume and its pieces can be restored from Recently Deleted.
--
-- Nothing else changes. "Often pulled with" suggestions need no schema: they
-- are read from past pull lists, under the policies that already exist.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists pull_list_groups (
  id uuid primary key default gen_random_uuid(),
  pull_list_id uuid not null references pull_lists(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Order on the list; new groups go last.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  -- For the two-column foreign key below.
  unique (id, pull_list_id)
);

create index if not exists pull_list_groups_pull_list_idx on pull_list_groups (pull_list_id);

alter table pull_list_groups enable row level security;

drop policy if exists "org members can manage their pull list groups" on pull_list_groups;
create policy "org members can manage their pull list groups" on pull_list_groups
  for all
  using (
    pull_list_id in (
      select pl.id from pull_lists pl
      join productions p on p.id = pl.production_id
      where p.org_id = auth_org_id()
    )
  )
  with check (
    pull_list_id in (
      select pl.id from pull_lists pl
      join productions p on p.id = pl.production_id
      where p.org_id = auth_org_id()
    )
  );

alter table pull_list_items add column if not exists group_id uuid;

-- The line and its group must be on the same pull list. Deleting the group
-- clears group_id only (Postgres 15+), leaving the line on its list.
alter table pull_list_items drop constraint if exists pull_list_items_group_fk;
alter table pull_list_items add constraint pull_list_items_group_fk
  foreign key (group_id, pull_list_id)
  references pull_list_groups (id, pull_list_id)
  on delete set null (group_id);

create index if not exists pull_list_items_group_idx on pull_list_items (group_id)
  where group_id is not null;

alter table deleted_records drop constraint if exists deleted_records_kind_check;
alter table deleted_records add constraint deleted_records_kind_check
  check (kind in ('item', 'location', 'production', 'pull_list', 'pull_list_item', 'pull_list_group'));
