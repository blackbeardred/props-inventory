-- ═══════════════════════════════════════════════════════════════════════
-- Tryout links: the last six pictures, and things put where they belong
-- (migration 015)
--
-- Run in the Supabase SQL Editor after 014. Safe to run more than once.
--
-- The six sample items that had no picture (skull, map, telephone, trunk,
-- doublet, ruff) get descriptions to match the ones Arjun chose, and five
-- things move to a place that suits them: the anvil and the wheelbarrow down
-- to Props Room B, the curtains and the birdcage up to the Loft, the cane to
-- Costume Storage. The seed function makes new test copies that way; the
-- update below brings the copies already made into line, leaving alone
-- anything a tester has changed or moved. The photos are uploaded by
-- scripts/add-sample-photos.mjs.
--
-- No table, policy or permission changes.
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
    (shakespeare, 'Yorick''s skull', 'prop', 'Life-size plastic skull. The lower jaw hinges open.', 1, 'good', null::jsonb),
    (shakespeare, 'Stage dagger', 'prop', 'Black double-edged dagger with a ribbed grip. Blunted, for stage use only.', 2, 'good', '{"Inventory No.": "W-031"}'::jsonb),
    (shakespeare, 'Royal crown, blue velvet', 'prop', 'Gold filigree with paste sapphires and pearls, a blue velvet cap and white fur trim.', 1, 'good', null::jsonb),
    (shakespeare, 'Crown, gold', 'prop', 'Aged gold metal crown with fleur-de-lis points, lined in black felt.', 1, 'needs_repair', '{"Notes": "One stud loose"}'::jsonb),
    (shelf_a, 'Violin ornament, brass', 'prop', 'Solid brass violin on a round base, about 30 cm tall.', 1, 'good', null::jsonb),
    (loft, 'Birdcage, gold', 'prop', 'Gold wire birdcage with a hanging hook and a latched door.', 1, 'good', null::jsonb),
    (shelf_a, 'Lantern, black metal', 'prop', 'Square black lantern with glass panes and a ring handle. Battery candle inside.', 1, 'good', null::jsonb),
    (shelf_a, 'Map, framed', 'prop', 'Fantasy map, "The Realms of Derabor", in a dark wood frame carved "Rusty Hook Inn".', 1, 'good', '{"Inventory No.": "P-014", "Donor": "The Hartley family"}'::jsonb),
    (shelf_b, 'Serving platter, black', 'prop', 'Oval glazed platter.', 1, 'good', null::jsonb),
    (shelf_b, 'Serving platter, black', 'prop', 'Oval glazed platter. Small chip on the underside.', 1, 'fair', null::jsonb),
    (shelf_b, 'Mug, monogram A', 'prop', 'White ceramic with a black rim and a gold-edged letter A.', 1, 'good', null::jsonb),
    (shelf_b, 'Dinner plate, white', 'prop', 'Plain white china with a wide rim.', 4, 'good', null::jsonb),
    (shelf_b, 'Rotary telephone', 'prop', 'Black with gold trim and a coiled cord. Bell rings from a battery box.', 1, 'good', null::jsonb),
    (room_b, 'Wooden urn', 'prop', 'Turned wooden vessel, dark and worn smooth.', 1, 'good', null::jsonb),
    (costumes, 'Walking cane, mahogany', 'prop', 'Glossy carved handle with a brass collar.', 1, 'good', null::jsonb),
    (room_b, 'Travel trunk', 'prop', 'Black steamer trunk with studded straps and brass latches. Well travelled; holds a body.', 1, 'good', null::jsonb),
    (loft, 'Curtains, paisley (pair)', 'prop', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', 1, 'fair', null::jsonb),
    (rack, 'Fan, lace', 'costume', 'Folding fan of cream lace on pale bamboo sticks, with a silk tassel.', 1, 'good', null::jsonb),
    (rack, 'Doublet, black and red', 'costume', 'Black wool with red trim, a row of buttons and shoulder wings. Men''s 40R.', 1, 'good', null::jsonb),
    (rack, 'Ruff collar', 'costume', 'Wide white pleated ruff with lace at the neck.', 3, 'new', null::jsonb),
    (rack, 'Spectacles, black frames', 'costume', 'Thick black frames with clear lenses, no prescription.', 2, 'good', null::jsonb),
    (room_b, 'Anvil', 'prop', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', 1, 'good', null::jsonb),
    (room_b, 'Wheelbarrow, wooden', 'prop', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', 1, 'needs_repair', null::jsonb),
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
  from (values ('Stage dagger', 2, 'checked'), ('Ruff collar', 3, 'checked'), ('Doublet, black and red', 1, 'open'), ('Dinner plate, white', 2, 'open')) as want(name, n, c)
  cross join lateral (select id from items where org_id = p_org and items.name = want.name order by created_at limit 1) i;
end;
$$;

-- The copies already made: an item still exactly as 014 left it (same name,
-- description and place) takes its new description and place. Anything a
-- tester has changed or moved is left alone. Photos aren't touched here: the
-- six new ones are added by scripts/add-sample-photos.mjs, to items with none.
with map(old_name, old_description, old_place, name, description, place) as (values
    ('Yorick''s skull', 'Resin, lightly aged. Lower jaw is loose.', 'Shakespeare box', 'Yorick''s skull', 'Life-size plastic skull. The lower jaw hinges open.', 'Shakespeare box'),
    ('Birdcage, gold', 'Gold wire birdcage with a hanging hook and a latched door.', 'Shelf A', 'Birdcage, gold', 'Gold wire birdcage with a hanging hook and a latched door.', 'Loft'),
    ('Map (Aged)', 'Tea-stained parchment of a made-up coastline.', 'Shelf A', 'Map, framed', 'Fantasy map, "The Realms of Derabor", in a dark wood frame carved "Rusty Hook Inn".', 'Shelf A'),
    ('Rotary telephone', 'Black, 1950s. Bell rings from a battery box.', 'Shelf B', 'Rotary telephone', 'Black with gold trim and a coiled cord. Bell rings from a battery box.', 'Shelf B'),
    ('Walking cane, mahogany', 'Glossy carved handle with a brass collar.', 'Props Room B', 'Walking cane, mahogany', 'Glossy carved handle with a brass collar.', 'Costume Storage'),
    ('Travel trunk', 'Leather straps, brass corners. Holds a body.', 'Props Room B', 'Travel trunk', 'Black steamer trunk with studded straps and brass latches. Well travelled; holds a body.', 'Props Room B'),
    ('Curtains, paisley (pair)', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', 'Props Room B', 'Curtains, paisley (pair)', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', 'Loft'),
    ('Doublet, black', 'Slashed sleeves, men''s 40R.', 'Rack 1', 'Doublet, black and red', 'Black wool with red trim, a row of buttons and shoulder wings. Men''s 40R.', 'Rack 1'),
    ('Ruff collar', 'Starched linen.', 'Rack 1', 'Ruff collar', 'Wide white pleated ruff with lace at the neck.', 'Rack 1'),
    ('Anvil', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', 'Loft', 'Anvil', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', 'Props Room B'),
    ('Wheelbarrow, wooden', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', 'Loft', 'Wheelbarrow, wooden', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', 'Props Room B')
)
update items i
set name = m.name,
    description = m.description,
    location_id = (select l.id from locations l where l.org_id = i.org_id and l.name = m.place order by l.created_at limit 1),
    updated_at = now()
from map m
where i.org_id in (select org_id from tryout_links)
  and i.name = m.old_name
  and i.description is not distinct from m.old_description
  and i.location_id = (select l.id from locations l where l.org_id = i.org_id and l.name = m.old_place order by l.created_at limit 1)
  and exists (select 1 from locations l where l.org_id = i.org_id and l.name = m.place);
