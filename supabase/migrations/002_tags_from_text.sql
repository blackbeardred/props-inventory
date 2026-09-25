-- ═══════════════════════════════════════════════════════════════════════
-- Tags become purely generated, and search goes back to one tag column
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Day 11 split hand-typed tags (manual_tags) from AI ones (auto_tags),
-- because regenerating wiped the hand-typed ones. Typing tags by hand turns
-- out to be redundant: everything worth tagging is already implied by the
-- item's name and description, and a person shouldn't have to think of the
-- word "wood" themselves. So manual_tags goes, and auto_tags is generated
-- from the item's words as well as its photo (see src/lib/ai/tag-item.ts).
-- ═══════════════════════════════════════════════════════════════════════

-- The index is built on the four-argument document function, so it has to
-- go before that function can be replaced.
drop index if exists items_search_idx;
drop function if exists items_search_document(text, text, text[], text[]);

create or replace function items_search_document(
  p_name text,
  p_description text,
  p_auto_tags text[]
)
returns text
language sql
immutable
as $$
  select coalesce(p_name, '') || ' ' || coalesce(p_description, '') || ' '
    || coalesce(array_to_string(p_auto_tags, ' '), '')
$$;

-- Both search functions have to stop referencing manual_tags before the
-- column can be dropped out from under them.
create or replace function search_items(search_query text)
returns setof items
language sql
stable
as $$
  select *
  from items
  where to_tsvector('english', items_search_document(name, description, auto_tags))
        @@ websearch_to_tsquery('english', search_query)
  order by name
$$;

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

  return query
  select *
  from items
  where
    (prefix_query is null or to_tsvector('english', items_search_document(name, description, auto_tags)) @@ prefix_query)
    and (location_ids is null or location_id = any(location_ids))
  order by name;
end;
$$;

alter table items drop column if exists manual_tags;

create index if not exists items_search_idx on items using gin (
  to_tsvector('english', items_search_document(name, description, auto_tags))
);

-- PostgREST's schema cache goes stale right after DDL (the Day 9 lesson).
notify pgrst, 'reload schema';
