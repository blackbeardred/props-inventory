-- ═══════════════════════════════════════════════════════════════════════
-- Tryout links: the sample theatre gets pictures (migration 014)
--
-- Run in the Supabase SQL Editor after 013. Safe to run more than once.
--
-- Seventeen of the sample items become the things in the photos Arjun chose
-- (a mug, a lace fan, a stage dagger, two crowns, an anvil…), with names and
-- descriptions to match. The seed function makes new test copies that way,
-- and the update below brings the copies already made into line, leaving
-- alone anything a tester has changed. The photos themselves are uploaded by
-- scripts/add-sample-photos.mjs (a function can't upload files), from
-- supabase/sample-photos/.
--
-- No table, policy or permission changes: seed_sample_theatre keeps the
-- revoke from 013.
-- ═══════════════════════════════════════════════════════════════════════

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

  -- Photos aren't set here: a function can't upload files. They're added
  -- afterwards by scripts/add-sample-photos.mjs, from supabase/sample-photos/.
  insert into items (org_id, location_id, name, category, description, quantity, condition, import_data)
  select p_org, place, name, category, description, quantity, condition, coalesce(extra, '{}'::jsonb)
  from (values
    (shakespeare, 'Yorick''s skull', 'prop', 'Resin, lightly aged. Lower jaw is loose.', 1, 'good', null::jsonb),
    (shakespeare, 'Stage dagger', 'prop', 'Black double-edged dagger with a ribbed grip. Blunted, for stage use only.', 2, 'good', '{"Inventory No.": "W-031"}'::jsonb),
    (shakespeare, 'Royal crown, blue velvet', 'prop', 'Gold filigree with paste sapphires and pearls, a blue velvet cap and white fur trim.', 1, 'good', null::jsonb),
    (shakespeare, 'Crown, gold', 'prop', 'Aged gold metal crown with fleur-de-lis points, lined in black felt.', 1, 'needs_repair', '{"Notes": "One stud loose"}'::jsonb),
    (shelf_a, 'Violin ornament, brass', 'prop', 'Solid brass violin on a round base, about 30 cm tall.', 1, 'good', null::jsonb),
    (shelf_a, 'Birdcage, gold', 'prop', 'Gold wire birdcage with a hanging hook and a latched door.', 1, 'good', null::jsonb),
    (shelf_a, 'Lantern, black metal', 'prop', 'Square black lantern with glass panes and a ring handle. Battery candle inside.', 1, 'good', null::jsonb),
    (shelf_a, 'Map (Aged)', 'prop', 'Tea-stained parchment of a made-up coastline.', 1, 'good', '{"Inventory No.": "P-014", "Donor": "The Hartley family"}'::jsonb),
    (shelf_b, 'Serving platter, black', 'prop', 'Oval glazed platter.', 1, 'good', null::jsonb),
    (shelf_b, 'Serving platter, black', 'prop', 'Oval glazed platter. Small chip on the underside.', 1, 'fair', null::jsonb),
    (shelf_b, 'Mug, monogram A', 'prop', 'White ceramic with a black rim and a gold-edged letter A.', 1, 'good', null::jsonb),
    (shelf_b, 'Dinner plate, white', 'prop', 'Plain white china with a wide rim.', 4, 'good', null::jsonb),
    (shelf_b, 'Rotary telephone', 'prop', 'Black, 1950s. Bell rings from a battery box.', 1, 'good', null::jsonb),
    (room_b, 'Wooden urn', 'prop', 'Turned wooden vessel, dark and worn smooth.', 1, 'good', null::jsonb),
    (room_b, 'Walking cane, mahogany', 'prop', 'Glossy carved handle with a brass collar.', 1, 'good', null::jsonb),
    (room_b, 'Travel trunk', 'prop', 'Leather straps, brass corners. Holds a body.', 1, 'good', null::jsonb),
    (room_b, 'Curtains, paisley (pair)', 'prop', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', 1, 'fair', null::jsonb),
    (rack, 'Fan, lace', 'costume', 'Folding fan of cream lace on pale bamboo sticks, with a silk tassel.', 1, 'good', null::jsonb),
    (rack, 'Doublet, black', 'costume', 'Slashed sleeves, men''s 40R.', 1, 'good', null::jsonb),
    (rack, 'Ruff collar', 'costume', 'Starched linen.', 3, 'new', null::jsonb),
    (rack, 'Spectacles, black frames', 'costume', 'Thick black frames with clear lenses, no prescription.', 2, 'good', null::jsonb),
    (loft, 'Anvil', 'prop', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', 1, 'good', null::jsonb),
    (loft, 'Wheelbarrow, wooden', 'prop', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', 1, 'needs_repair', null::jsonb),
    (null, 'Umbrella, blue', 'prop', 'Blue canopy with a wooden crook handle. Opens fully.', 1, 'good', null::jsonb)
  ) as seed(place, name, category, description, quantity, condition, extra);

  insert into productions (org_id, name, start_date, end_date, status)
    values (p_org, 'Noises Off!', current_date + 30, current_date + 60, 'planning') returning id into noises;
  insert into productions (org_id, name, start_date, end_date, status)
    values (p_org, 'Twelfth Night', current_date - 7, current_date + 14, 'in_run') returning id into twelfth;
  insert into pull_lists (production_id) values (noises) returning id into list_noises;
  insert into pull_lists (production_id) values (twelfth) returning id into list_twelfth;

  insert into pull_list_items (pull_list_id, item_id, quantity_needed, status, check_state)
  select list_noises, i.id, n, s, 'open'
  from (values ('Rotary telephone', 1, 'pending'), ('Serving platter, black', 1, 'pending'), ('Travel trunk', 1, 'pulled')) as want(name, n, s)
  cross join lateral (select id from items where org_id = p_org and items.name = want.name order by created_at limit 1) i;

  insert into pull_list_items (pull_list_id, item_id, quantity_needed, status, check_state, checked_at)
  select list_twelfth, i.id, n, 'pulled', c, case when c = 'checked' then now() end
  from (values ('Stage dagger', 2, 'checked'), ('Ruff collar', 3, 'checked'), ('Doublet, black', 1, 'open'), ('Dinner plate, white', 2, 'open')) as want(name, n, c)
  cross join lateral (select id from items where org_id = p_org and items.name = want.name order by created_at limit 1) i;
end;
$$;

-- The copies already made: each sample item still exactly as it was seeded
-- (same name and description, no photo yet) becomes its new self. Anything a
-- tester has already changed is left alone. Running this again changes
-- nothing, because the old names are gone.
with map(old_name, old_description, name, description, category, quantity, condition, extra, place) as (values
    ('Rapier, steel-hilt', 'Blunted stage rapier with a swept hilt.', 'Stage dagger', 'Black double-edged dagger with a ribbed grip. Blunted, for stage use only.', 'prop', 2, 'good', '{"Inventory No.": "W-031"}'::jsonb, 'Shakespeare box'),
    ('Quill and inkwell', 'Goose feather quill, pewter inkwell.', 'Royal crown, blue velvet', 'Gold filigree with paste sapphires and pearls, a blue velvet cap and white fur trim.', 'prop', 1, 'good', null::jsonb, 'Shakespeare box'),
    ('Crown (Prop)', 'Gold-painted brass, paste stones.', 'Crown, gold', 'Aged gold metal crown with fleur-de-lis points, lined in black felt.', 'prop', 1, 'needs_repair', '{"Notes": "One stud loose"}'::jsonb, 'Shakespeare box'),
    ('Brass candlestick', 'Tall, with a drip tray.', 'Violin ornament, brass', 'Solid brass violin on a round base, about 30 cm tall.', 'prop', 1, 'good', null::jsonb, 'Shelf A'),
    ('Brass candlestick', 'Short, slightly dented base.', 'Birdcage, gold', 'Gold wire birdcage with a hanging hook and a latched door.', 'prop', 1, 'good', null::jsonb, 'Shelf A'),
    ('Oil lantern', 'Battery LED inside; glass chimney is real.', 'Lantern, black metal', 'Square black lantern with glass panes and a ring handle. Battery candle inside.', 'prop', 1, 'good', null::jsonb, 'Shelf A'),
    ('Silver Tray', 'Oval, with handles.', 'Serving platter, black', 'Oval glazed platter.', 'prop', 1, 'good', null::jsonb, 'Shelf B'),
    ('Silver Tray', 'Oval, with handles. Scratched underneath.', 'Serving platter, black', 'Oval glazed platter. Small chip on the underside.', 'prop', 1, 'fair', null::jsonb, 'Shelf B'),
    ('Tea set', 'Brass-handled teapot and four cups.', 'Mug, monogram A', 'White ceramic with a black rim and a gold-edged letter A.', 'prop', 1, 'good', null::jsonb, 'Shelf B'),
    ('Pewter tankard', null, 'Dinner plate, white', 'Plain white china with a wide rim.', 'prop', 4, 'good', null::jsonb, 'Shelf B'),
    ('Wooden chair', 'Plain kitchen chair, pine.', 'Wooden urn', 'Turned wooden vessel, dark and worn smooth.', 'prop', 1, 'good', null::jsonb, 'Props Room B'),
    ('Ladderback chair, carved oak', null, 'Walking cane, mahogany', 'Glossy carved handle with a brass collar.', 'prop', 1, 'good', null::jsonb, 'Props Room B'),
    ('Rug (Persian style)', 'Red and blue, about 2 by 3 metres. Orange/rust border.', 'Curtains, paisley (pair)', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', 'prop', 1, 'fair', null::jsonb, 'Props Room B'),
    ('Velvet cloak', 'Deep green, full length, with a hood.', 'Fan, lace', 'Folding fan of cream lace on pale bamboo sticks, with a silk tassel.', 'costume', 1, 'good', null::jsonb, 'Rack 1'),
    ('Bowler hat', null, 'Spectacles, black frames', 'Thick black frames with clear lenses, no prescription.', 'costume', 2, 'good', null::jsonb, 'Rack 1'),
    ('Fishing net', 'About 3 metres square, hemp.', 'Anvil', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', 'prop', 1, 'good', null::jsonb, 'Loft'),
    ('Bicycle, 1920s', 'Rides, but the brakes don''t. Walk it on.', 'Wheelbarrow, wooden', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', 'prop', 1, 'needs_repair', null::jsonb, 'Loft'),
    ('Umbrella, black', 'Opens fully.', 'Umbrella, blue', 'Blue canopy with a wooden crook handle. Opens fully.', 'prop', 1, 'good', null::jsonb, null)
)
update items i
set name = m.name,
    description = m.description,
    category = m.category,
    quantity = m.quantity,
    condition = m.condition,
    import_data = coalesce(m.extra, i.import_data),
    location_id = coalesce(
      (select l.id from locations l where l.org_id = i.org_id and l.name = m.place order by l.created_at limit 1),
      i.location_id),
    updated_at = now()
from map m
where i.org_id in (select org_id from tryout_links)
  and i.name = m.old_name
  and i.description is not distinct from m.old_description
  and i.photo_url is null;
