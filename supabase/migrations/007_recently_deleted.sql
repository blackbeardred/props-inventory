-- Migration 007: Recently Deleted.
--
-- Deleting an item, a place, a production, a pull list or a line from one
-- now keeps a snapshot here first: the row itself and everything the delete
-- takes with it (a place's shelves and the items that were kept there, a
-- production's lists and their lines, an item's pull-list lines and its
-- fingerprint). Restoring puts the rows back with their original ids and
-- removes the snapshot. Snapshots older than 30 days are cleared by the app
-- the next time anyone opens Recently Deleted, along with any photos only
-- they still pointed at.
--
-- One new table. Nothing existing changes: no new columns, and no existing
-- policy is touched. Every other table, query and search function goes on
-- exactly as before, which is why this is a snapshot table rather than a
-- deleted_at column every query would have to learn to skip.
--
-- Safe to run more than once. No $$ blocks, so it pastes into the Supabase
-- SQL editor cleanly; if a paste is cut short, run the two halves below
-- separately.

-- ── Part 1: the table ──────────────────────────────────────────────────

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
