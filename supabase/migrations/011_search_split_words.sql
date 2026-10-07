-- ═══════════════════════════════════════════════════════════════════════
-- Find words that punctuation joins together
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Searching "rust" didn't find a water bottle whose description reads
-- "orange/rust top cap". The description was searched all along; the trouble
-- is how Postgres reads it. A word with a slash in it looks like a file path
-- to the full-text parser, so "orange/rust" is kept as one single word, and
-- "rust" is neither that word nor the start of it. The same happens to
-- "black/gold", "red/white", "owala.com" and anything else written with a
-- slash or a dot between words, which is how photo descriptions often put
-- two colours.
--
-- The search document already carried two copies of the text: as written,
-- and with punctuation squeezed out ("P-001" as p001, so an inventory number
-- can be typed back in). This adds a third, with punctuation turned into
-- spaces, so "orange/rust" is also the two words orange and rust. Nothing
-- else changes: the same columns are searched, in the same way.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function items_search_document(
  p_name text,
  p_description text,
  p_auto_tags text[],
  p_import_data jsonb
)
returns text
language sql
immutable
as $$
  -- The document is indexed three times over:
  --   1. as written;
  --   2. with punctuation squeezed out of the middle of words. Search-as-
  --      you-type strips punctuation from what the user types ("P-001"
  --      becomes the term p001), and Postgres reads "P-001" as the two words
  --      p and 001, so without this copy an inventory number could never be
  --      typed back in;
  --   3. with punctuation turned into spaces. Postgres reads "orange/rust" as
  --      a file path, one word, so without this copy "rust" wouldn't find it
  --      (migration 011).
  select base
    || ' ' || regexp_replace(base, '[^[:alnum:][:space:]]+', '', 'g')
    || ' ' || regexp_replace(base, '[^[:alnum:][:space:]]+', ' ', 'g')
  from (
    select coalesce(p_name, '') || ' ' || coalesce(p_description, '') || ' '
      || coalesce(array_to_string(p_auto_tags, ' '), '') || ' '
      || coalesce(
           (select string_agg(entry.value, ' ')
            from jsonb_each_text(coalesce(p_import_data, '{}'::jsonb)) as entry),
           ''
         ) as base
  ) as document
$$;

-- The index is built from what that function returns, and Postgres doesn't
-- notice when a function's body changes, so every item is re-read here.
-- Search-as-you-type reads the document fresh on every search and works the
-- moment the function above is replaced; this brings the index in line for
-- everything else that uses it.
reindex index items_search_idx;

-- PostgREST's schema cache goes stale right after DDL (the Day 9 lesson).
notify pgrst, 'reload schema';
