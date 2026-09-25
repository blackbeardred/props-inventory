-- ═══════════════════════════════════════════════════════════════════════
-- Where a thing is kept becomes part of what you can search for
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Two changes, both about nesting:
--
-- 1. A location's full path is folded into what a search matches, so typing
--    "shakespeare" finds everything in any box called Shakespeare, and
--    "shed shakespeare" narrows to the one in the shed — while "garage
--    shakespeare" finds the other. Location names behave like any other
--    search word, and stack the same way.
--
-- 2. Filtering by a location now includes everything inside it. Picking
--    "Shed" previously matched only items filed directly against the shed
--    and missed anything in a box within it, which is not what anyone means.
-- ═══════════════════════════════════════════════════════════════════════

-- Each location paired with its own name plus all its ancestors', so
-- "Shakespeare box" inside "Shed" searches as "shakespeare box shed".
-- Plain (not security definer): RLS on locations still applies, so this only
-- ever walks the caller's own organization.
create or replace function location_search_paths()
returns table (location_id uuid, path text)
language sql
stable
as $$
  with recursive chain as (
    select id as leaf_id, id as node_id, name, parent_location_id
    from locations
    union all
    select c.leaf_id, parent.id, parent.name, parent.parent_location_id
    from chain c
    join locations parent on parent.id = c.parent_location_id
  )
  select leaf_id, string_agg(name, ' ')
  from chain
  group by leaf_id
$$;

-- A location and everything nested underneath it.
create or replace function location_descendants(p_ids uuid[])
returns setof uuid
language sql
stable
as $$
  with recursive tree as (
    select id from locations where id = any(p_ids)
    union
    select child.id
    from locations child
    join tree on child.parent_location_id = tree.id
  )
  select id from tree
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
           items_search_document(i.name, i.description, i.auto_tags)
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
          items_search_document(i.name, i.description, i.auto_tags)
            || ' ' || coalesce(p.path, '')
        ) @@ websearch_to_tsquery('english', search_query)
  order by i.name
$$;

notify pgrst, 'reload schema';
