-- ═══════════════════════════════════════════════════════════════════════
-- Tryout links: sample items come tagged for search, and no invite codes
-- (migration 016)
--
-- Run in the Supabase SQL Editor after 015. Safe to run more than once.
--
-- Search tags. Every sample item gets the hidden search tags for what it
-- is, what it's made of and its colours, written from its photo, so a
-- tester's search for "wood", "gold" or "elizabethan" works from the first
-- minute, with no AI call per copy. The copies already made get them now,
-- except an item a tester has renamed or rewritten (saving it tagged it
-- afresh); new copies get them as they're made. Anything a tester adds is
-- tagged as it's saved, as everywhere else.
--
-- Invite codes. A test copy is one tester's own, so it has none: the
-- Theatre page no longer shows testers a code to pass on, and the copies
-- already made lose theirs (a join with no code matches nothing). Opening a
-- link while signed in as yourself still adds that copy to your theatres.
--
-- No table, policy or permission changes. tag_sample_theatre is SQL-editor
-- only, like seed_sample_theatre.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function tag_sample_theatre(p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  -- The values are printed by scripts/sample-tags.mjs, from supabase/sample-photos/tags.json.
  update items i
  set auto_tags = t.tags
  from (values
    ('Yorick''s skull', 'Life-size plastic skull. The lower jaw hinges open.', array['skull', 'head', 'skeleton', 'bones', 'anatomy', 'plastic', 'white', 'ivory', 'hamlet', 'shakespeare', 'elizabethan', 'gothic', 'halloween', 'death', 'graveyard', 'macabre', 'memento mori']),
    ('Stage dagger', 'Black double-edged dagger with a ribbed grip. Blunted, for stage use only.', array['dagger', 'knife', 'blade', 'weapon', 'steel', 'metal', 'black', 'silver', 'medieval', 'renaissance', 'elizabethan', 'combat', 'stage fight', 'assassin', 'macbeth', 'grey', 'gray']),
    ('Royal crown, blue velvet', 'Gold filigree with paste sapphires and pearls, a blue velvet cap and white fur trim.', array['crown', 'headwear', 'regalia', 'jewellery', 'jewels', 'pearls', 'velvet', 'fabric', 'faux fur', 'fur', 'metal', 'blue', 'navy', 'sapphire', 'gold', 'white', 'royal', 'ornate', 'medieval', 'tudor', 'king', 'queen', 'coronation', 'monarch', 'yellow']),
    ('Crown, gold', 'Aged gold metal crown with fleur-de-lis points, lined in black felt.', array['crown', 'headwear', 'regalia', 'metal', 'felt', 'fabric', 'gold', 'black', 'fleur-de-lis', 'medieval', 'gothic', 'aged', 'king', 'queen', 'monarch', 'royalty', 'yellow']),
    ('Violin ornament, brass', 'Solid brass violin on a round base, about 30 cm tall.', array['violin', 'fiddle', 'musical instrument', 'instrument', 'music', 'ornament', 'figurine', 'statue', 'brass', 'metal', 'gold', 'decorative', 'classical', 'set dressing', 'mantelpiece', 'yellow']),
    ('Birdcage, gold', 'Gold wire birdcage with a hanging hook and a latched door.', array['birdcage', 'cage', 'bird', 'wire', 'metal', 'gold', 'victorian', 'ornate', 'decorative', 'hanging', 'parlour', 'set dressing', 'pet', 'yellow']),
    ('Lantern, black metal', 'Square black lantern with glass panes and a ring handle. Battery candle inside.', array['lantern', 'lamp', 'light', 'candle', 'lighting', 'metal', 'glass', 'black', 'cream', 'victorian', 'rustic', 'night', 'street', 'outdoor', 'white']),
    ('Map, framed', 'Fantasy map, "The Realms of Derabor", in a dark wood frame carved "Rusty Hook Inn".', array['map', 'chart', 'picture', 'frame', 'framed', 'wall art', 'artwork', 'wood', 'paper', 'glass', 'brown', 'green', 'blue', 'fantasy', 'pirate', 'nautical', 'tavern', 'inn', 'rustic', 'treasure', 'adventure', 'set dressing']),
    ('Serving platter, black', 'Oval glazed platter.', array['platter', 'plate', 'dish', 'tray', 'serving dish', 'tableware', 'crockery', 'dinnerware', 'ceramic', 'glazed', 'black', 'dinner', 'banquet', 'feast', 'food', 'kitchen']),
    ('Serving platter, black', 'Oval glazed platter. Small chip on the underside.', array['platter', 'plate', 'dish', 'tray', 'serving dish', 'tableware', 'crockery', 'dinnerware', 'ceramic', 'glazed', 'black', 'dinner', 'banquet', 'feast', 'food', 'kitchen']),
    ('Mug, monogram A', 'White ceramic with a black rim and a gold-edged letter A.', array['mug', 'cup', 'drinkware', 'tableware', 'crockery', 'ceramic', 'white', 'black', 'gold', 'letter', 'monogram', 'initial', 'coffee', 'tea', 'breakfast', 'kitchen', 'office', 'yellow']),
    ('Dinner plate, white', 'Plain white china with a wide rim.', array['plate', 'dish', 'tableware', 'crockery', 'dinnerware', 'china', 'porcelain', 'ceramic', 'white', 'dinner', 'meal', 'food', 'banquet', 'kitchen']),
    ('Rotary telephone', 'Black with gold trim and a coiled cord. Bell rings from a battery box.', array['telephone', 'phone', 'rotary', 'dial', 'handset', 'plastic', 'metal', 'black', 'gold', 'vintage', 'retro', '1950s', 'antique', 'office', 'call', 'ringing', 'noir', 'yellow']),
    ('Wooden urn', 'Turned wooden vessel, dark and worn smooth.', array['urn', 'vase', 'pot', 'vessel', 'jar', 'wood', 'brown', 'dark brown', 'rustic', 'antique', 'turned', 'decoration', 'set dressing', 'ashes']),
    ('Walking cane, mahogany', 'Glossy carved handle with a brass collar.', array['cane', 'walking stick', 'stick', 'accessory', 'mahogany', 'wood', 'brass', 'metal', 'brown', 'red', 'gold', 'victorian', 'edwardian', 'gentleman', 'character', 'elderly', 'yellow']),
    ('Travel trunk', 'Black steamer trunk with studded straps and brass latches. Well travelled; holds a body.', array['trunk', 'steamer trunk', 'chest', 'box', 'luggage', 'suitcase', 'storage', 'metal', 'wood', 'leather', 'black', 'grey', 'brass', 'vintage', 'antique', 'victorian', '1920s', 'travel', 'journey', 'hiding place', 'treasure', 'gray', 'gold']),
    ('Curtains, paisley (pair)', 'Sheer tab-top curtains, yellow and purple paisley with an orange/rust edge.', array['curtains', 'drapes', 'window', 'textile', 'soft furnishing', 'fabric', 'cotton', 'sheer', 'yellow', 'mustard', 'orange', 'rust', 'purple', 'gold', 'paisley', 'pattern', 'bohemian', '1970s', 'window dressing', 'set dressing']),
    ('Fan, lace', 'Folding fan of cream lace on pale bamboo sticks, with a silk tassel.', array['fan', 'folding fan', 'hand fan', 'accessory', 'lace', 'silk', 'fabric', 'bamboo', 'wood', 'cream', 'white', 'ivory', 'beige', 'victorian', 'regency', 'spanish', 'elegant', 'lady', 'ballroom', 'brown']),
    ('Doublet, black and red', 'Black wool with red trim, a row of buttons and shoulder wings. Men''s 40R.', array['doublet', 'jacket', 'coat', 'top', 'menswear', 'wool', 'fabric', 'buttons', 'metal', 'black', 'red', 'elizabethan', 'tudor', 'renaissance', 'shakespeare', 'period', 'nobleman', 'courtier']),
    ('Ruff collar', 'Wide white pleated ruff with lace at the neck.', array['ruff', 'collar', 'neckwear', 'accessory', 'linen', 'cotton', 'lace', 'fabric', 'white', 'pleated', 'elizabethan', 'tudor', 'renaissance', 'shakespeare', 'period', 'nobility']),
    ('Spectacles, black frames', 'Thick black frames with clear lenses, no prescription.', array['spectacles', 'glasses', 'eyeglasses', 'eyewear', 'accessory', 'plastic', 'glass', 'black', 'clear', 'retro', 'geek', 'reading', 'disguise', 'character']),
    ('Anvil', 'Cast iron, black, with a bright working face. Heavy: lift with two people.', array['anvil', 'blacksmith', 'forge', 'smithy', 'tool', 'cast iron', 'iron', 'metal', 'steel', 'black', 'silver', 'grey', 'rustic', 'industrial', 'medieval', 'western', 'workshop', 'heavy', 'cartoon', 'gray']),
    ('Wheelbarrow, wooden', 'Old-style wooden barrow with a spoked wheel. The wheel wobbles: carry it on, don''t push it.', array['wheelbarrow', 'barrow', 'cart', 'wheel', 'garden', 'wood', 'metal', 'brown', 'red', 'rustic', 'antique', 'farm', 'country', 'village', 'outdoor']),
    ('Umbrella, blue', 'Blue canopy with a wooden crook handle. Opens fully.', array['umbrella', 'brolly', 'parasol', 'accessory', 'rain', 'fabric', 'nylon', 'metal', 'wood', 'blue', 'brown', 'classic', 'weather', 'outdoor', 'character', 'plastic'])
  ) as t(name, description, tags)
  where i.org_id = p_org
    and i.name = t.name
    and i.description is not distinct from t.description
    and i.auto_tags is distinct from t.tags
$$;

create or replace function create_tryout(p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  new_org uuid;
  new_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if cleaned = '' then
    raise exception 'A tryout link needs a name';
  end if;

  -- No invite code: a test copy is one tester's own (migration 016).
  insert into organizations (name, invite_code)
  values (cleaned || '''s test theatre', null)
  returning id into new_org;

  perform seed_sample_theatre(new_org);
  perform tag_sample_theatre(new_org);

  insert into tryout_links (token, org_id, label) values (new_token, new_org, cleaned);
  return new_token;
end;
$$;

revoke all on function tag_sample_theatre(uuid) from public, anon, authenticated;
revoke all on function create_tryout(text) from public, anon, authenticated;

-- The copies already made.
select tag_sample_theatre(org_id) from tryout_links;
update organizations set invite_code = null
where id in (select org_id from tryout_links) and invite_code is not null;
