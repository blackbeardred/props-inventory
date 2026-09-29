-- ═══════════════════════════════════════════════════════════════════════
-- Checking a pull list off, box by box
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- A pull-list row already says whether the prop is out of storage. It can't
-- say whether anybody stood in front of the shelf and confirmed it — someone
-- can mark a whole list pulled from a desk in ten seconds. Those two facts
-- come apart constantly, and keeping them in one column is what makes an
-- inventory quietly wrong.
--
-- So: a row is `open` until someone walks the checklist. `checked` means a
-- person confirmed it, with a note of who and when. `cleared` means someone
-- decided it isn't wanted after all — it silences the warning without
-- pretending the prop was pulled.
--
-- Everything already on a list becomes `open`, which is true: nobody has
-- walked a checklist yet.
-- ═══════════════════════════════════════════════════════════════════════

alter table pull_list_items
  add column if not exists check_state text not null default 'open',
  add column if not exists checked_at timestamptz,
  add column if not exists checked_by uuid references profiles(id) on delete set null;

-- Added separately and guarded, so a second run doesn't fail on a constraint
-- that already exists (the Day 14 lesson: migrations get run twice).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pull_list_items_check_state_check'
  ) then
    alter table pull_list_items
      add constraint pull_list_items_check_state_check
      check (check_state in ('open', 'checked', 'cleared'));
  end if;
end
$$;

comment on column pull_list_items.check_state is
  'open until someone walks the checklist; checked when a person confirmed '
  'the prop in front of them; cleared when it is no longer wanted. Separate '
  'from status, which says whether the prop has left storage.';

-- No RLS change: pull_list_items is already scoped to the organization
-- through its pull list, and these columns ride on that.

notify pgrst, 'reload schema';
