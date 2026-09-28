-- ═══════════════════════════════════════════════════════════════════════
-- Keep the columns an import didn't use
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- A real inventory spreadsheet carries more than this app has fields for:
-- an inventory number, who donated it, what it cost, which show it was made
-- for, a note about the drawer it actually lives in. Until now the importer
-- read the columns it understood and dropped the rest on the floor, which
-- quietly loses the very details that make an old list worth keeping.
--
-- Those columns now travel with the item in `import_data`, keyed by the
-- heading they came from, and their values are folded into what a search
-- matches. Searching an inventory number or a donor's name finds the item,
-- even though neither appears anywhere in the interface.
--
-- Values only are searched, not headings: a "Donor" column would otherwise
-- make every donated item match the word "donor", which is noise.
--
-- Deliberately a separate column from auto_tags. The AI tags are replaced
-- wholesale each time an item is retagged, and anything kept alongside them
-- would vanish the first time someone edited a description — which is the
-- exact trap the old manual_tags column fell into.
-- ═══════════════════════════════════════════════════════════════════════

alter table items
  add column if not exists import_data jsonb not null default '{}'::jsonb;

comment on column items.import_data is
  'Columns from the spreadsheet this item was imported from that no field '
  'matched, keyed by their heading. Searchable, shown only on the item''s '
  'own page, never in lists. Empty for items typed in by hand.';

-- ── The search document gains a fourth part ───────────────────────────────
-- A new signature rather than a replacement, so the old three-argument
-- version stays valid until everything that calls it has been rebuilt below.
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
  -- The document is indexed twice: once as written, and once with
  -- punctuation squeezed out of the middle of words. Search-as-you-type
  -- strips punctuation from what the user types ("P-001" becomes the term
  -- p001), and Postgres reads "P-001" as the two words p and 001, so without
  -- the second copy an inventory number could never be typed back in.
  select base || ' ' || regexp_replace(base, '[^[:alnum:][:space:]]+', '', 'g')
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

-- ── Both search functions, now reading the new column ─────────────────────
create or replace function search_items_prefix(search_query text, location_ids uuid[] default null)
returns setof items
language plpgsql
stable
as $$
declare
  prefix_text text;
  prefix_query tsquery;
begin
  if search_query is not null and btrim(search_query) <> '' then
    select nullif(string_agg(cleaned, ' & '), '')
    into prefix_text
    from (
      select regexp_replace(raw_word, '[^[:alnum:]]+', '', 'g') || ':*' as cleaned
      from unnest(regexp_split_to_array(btrim(search_query), '\s+')) as raw_word
    ) as words
    where cleaned <> ':*';

    if prefix_text is not null then
      prefix_query := to_tsquery('english', prefix_text);
    end if;
  end if;

  -- The location path is joined in rather than stored on the item, which
  -- means this can't use the items_search_idx expression index and scans
  -- instead. At a theatre's scale (thousands of items at the very most)
  -- that is a few milliseconds; the alternative is denormalising the path
  -- onto every item and keeping it correct through triggers whenever a
  -- location is renamed or moved, which is a lot of machinery to maintain
  -- for a table this size.
  return query
  with paths as (
    select * from location_search_paths()
  )
  select i.*
  from items i
  left join paths p on p.location_id = i.location_id
  where
    (
      prefix_query is null
      or to_tsvector(
           'english',
           items_search_document(i.name, i.description, i.auto_tags, i.import_data)
             || ' ' || coalesce(p.path, '')
         ) @@ prefix_query
    )
    and (
      location_ids is null
      or i.location_id in (select location_descendants(location_ids))
    )
  order by i.name;
end;
$$;

-- Kept in step with the prefix version, though nothing in the app calls it.
create or replace function search_items(search_query text)
returns setof items
language sql
stable
as $$
  with paths as (
    select * from location_search_paths()
  )
  select i.*
  from items i
  left join paths p on p.location_id = i.location_id
  where to_tsvector(
          'english',
          items_search_document(i.name, i.description, i.auto_tags, i.import_data)
            || ' ' || coalesce(p.path, '')
        ) @@ websearch_to_tsquery('english', search_query)
  order by i.name
$$;

-- ── Rebuild the index over the new document ───────────────────────────────
-- An expression index only helps a query whose expression matches it exactly,
-- so the old one is no longer usable and has to be replaced rather than kept.
drop index if exists items_search_idx;

create index if not exists items_search_idx on items using gin (
  to_tsvector('english', items_search_document(name, description, auto_tags, import_data))
);

-- Safe only now that nothing above refers to it.
drop function if exists items_search_document(text, text, text[]);

-- PostgREST's schema cache goes stale right after DDL (the Day 9 lesson).
notify pgrst, 'reload schema';
