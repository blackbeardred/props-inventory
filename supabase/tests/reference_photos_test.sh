#!/usr/bin/env bash
# Migration 008 (more pictures of each item) against a real Postgres:
# schema.sql loads with it, the migration applies to a database that
# predates it and applies twice, its row-level security keeps each theatre's
# pictures to itself, and match_items scores an item by its closest picture.
#
# Usage:  ./reference_photos_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=refphotostest
PASS=0; FAIL=0

if ! pg_isready -h /tmp -p "$PORT" >/dev/null 2>&1; then
  mkdir -p "$PGDATA" && chown -R postgres:postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PORT' -l /tmp/pg.log start" >/dev/null 2>&1
  sleep 3
fi

q() { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "$1" 2>&1; }
as_user()      { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tail -1; }
as_user_full() { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1; }
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1"
  else FAIL=$((FAIL+1)); echo "  FAIL  $1"; echo "        expected: $2"; echo "        actual:   $3"; fi
}

psql -h /tmp -p "$PORT" -U postgres -qc "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text not null, name text not null, owner uuid);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon')
  then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
  then create role authenticated nologin; end if; end $$;
SQL

echo "── schema.sql, with reference photos in it"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../schema.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "schema.sql loads" "" "$out"
check "the table is there" "1" "$(q "select count(*) from pg_tables where tablename='item_reference_photos'")"

echo ""
echo "── Migration 008 on a database that predates it"
# Put match_items back the way 006 left it, and drop the new table.
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
drop table item_reference_photos;
create or replace function match_items(query_embedding extensions.vector(512), match_count int default 5)
returns table (item_id uuid, similarity float) language sql stable set search_path = public, extensions
as $fn$
  select e.item_id, 1 - (e.embedding <=> query_embedding) as similarity
  from item_photo_embeddings e where e.model = 'clip-vit-base-patch32'
  order by e.embedding <=> query_embedding
  limit least(greatest(coalesce(match_count, 5), 1), 50)
$fn$;
SQL
check "match_items is the 006 version before" "0" \
  "$(q "select count(*) from pg_proc where proname='match_items' and prosrc like '%item_reference_photos%'")"
apply() { psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/008_item_reference_photos.sql" 2>&1 | grep -i "^ERROR" | head -2; }
check "applies" "" "$(apply)"
check "applies a second time" "" "$(apply)"
check "row-level security is on" "t" "$(q "select relrowsecurity from pg_class where relname='item_reference_photos'")"
check "two policies, after two runs" "2" "$(q "select count(*) from pg_policies where tablename='item_reference_photos'")"
check "the write policy checks the item belongs to the theatre" "1" \
  "$(q "select count(*) from pg_policies where tablename='item_reference_photos' and with_check like '%items%'")"
check "match_items exists, once" "1" "$(q "select count(*) from pg_proc where proname='match_items'")"
check "…reads the new table" "1" \
  "$(q "select count(*) from pg_proc where proname='match_items' and prosrc like '%item_reference_photos%'")"
check "…and still isn't security definer" "f" "$(q "select prosecdef from pg_proc where proname='match_items'")"
check "no existing table gained a column" "0" \
  "$(q "select count(*) from information_schema.columns where table_schema = 'public' and column_name in ('photo_path','source') and table_name <> 'item_reference_photos'")"

ALICE=11111111-1111-1111-1111-111111111111
AMY=33333333-3333-3333-3333-333333333333
BOB=22222222-2222-2222-2222-222222222222
ORGA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
ORGB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
GLOBE=cccccccc-0000-0000-0000-000000000001
TANKARD=cccccccc-0000-0000-0000-000000000002
BEAR=cccccccc-0000-0000-0000-00000000000b

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
grant usage on schema public, auth, storage, extensions to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth, storage, extensions to authenticated;
create or replace function test_vec(a float, b float) returns extensions.vector
language sql immutable as \$fn\$
  select ('[' || a || ',' || b || ',' ||
          array_to_string(array_fill(0.0::float, array[510]), ',') || ']')::extensions.vector
\$fn\$;
grant execute on function test_vec(float, float) to authenticated;
insert into auth.users (id) values ('$ALICE'), ('$AMY'), ('$BOB');
insert into organizations (id, name, invite_code) values
  ('$ORGA','Alpha Theatre','ALPHA123'), ('$ORGB','Beta Playhouse','BETA4567');
insert into profiles (id, full_name, active_org_id) values
  ('$ALICE','Alice','$ORGA'), ('$AMY','Amy','$ORGA'), ('$BOB','Bob','$ORGB');
insert into memberships (user_id, org_id, role) values
  ('$ALICE','$ORGA','owner'), ('$AMY','$ORGA','member'), ('$BOB','$ORGB','owner');
insert into items (id, org_id, name, photo_url) values
  ('$GLOBE','$ORGA','Brass globe','$ORGA/$GLOBE/a.jpg'),
  ('$TANKARD','$ORGA','Pewter tankard','$ORGA/$TANKARD/a.jpg'),
  ('$BEAR','$ORGB','Bear head','$ORGB/$BEAR/a.jpg');
-- The globe's own photo points one way, the tankard's another.
insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values
  ('$GLOBE','$ORGA','$ORGA/$GLOBE/a.jpg', test_vec(1,0)),
  ('$TANKARD','$ORGA','$ORGA/$TANKARD/a.jpg', test_vec(0,1)),
  ('$BEAR','$ORGB','$ORGB/$BEAR/a.jpg', test_vec(1,1));
SQL

echo ""
echo "── Who can add and see a picture"
check "a member adds one to their own theatre's item" "INSERT 0 1" \
  "$(as_user $AMY "insert into item_reference_photos (item_id, org_id, photo_path, source, similarity, created_by) values ('$GLOBE','$ORGA','$ORGA/$GLOBE/ref-1.jpg','find_by_photo',0.83,'$AMY');")"
check "…without a fingerprint yet (filled in later)" "t" \
  "$(q "select embedding is null from item_reference_photos where photo_path like '%ref-1.jpg'")"
check "…which a member can then fill in" "UPDATE 1" \
  "$(as_user $AMY "update item_reference_photos set embedding = test_vec(1,0) where photo_path like '%ref-1.jpg';")"
check "another theatre's item can't be given one, even under your own org" "1" \
  "$(as_user_full $AMY "insert into item_reference_photos (item_id, org_id, photo_path, source) values ('$BEAR','$ORGA','x.jpg','prop_table');" | grep -c 'violates row-level security')"
check "…nor under theirs" "1" \
  "$(as_user_full $AMY "insert into item_reference_photos (item_id, org_id, photo_path, source) values ('$BEAR','$ORGB','x.jpg','prop_table');" | grep -c 'violates row-level security')"
check "an unknown source is refused" "1" \
  "$(q "insert into item_reference_photos (item_id, org_id, photo_path, source) values ('$GLOBE','$ORGA','x.jpg','guess');" | grep -c 'violates check constraint')"
check "a wrong-size fingerprint is refused" "1" \
  "$(q "insert into item_reference_photos (item_id, org_id, photo_path, source, embedding) values ('$GLOBE','$ORGA','x.jpg','prop_table','[1,2,3]');" | grep -ci 'expected 512 dimensions')"
check "an item can have several" "INSERT 0 1" \
  "$(as_user $ALICE "insert into item_reference_photos (item_id, org_id, photo_path, source, embedding) values ('$GLOBE','$ORGA','$ORGA/$GLOBE/ref-2.jpg','prop_table', test_vec(0.6,0.8));")"
check "the theatre sees its pictures" "2" "$(as_user $ALICE "select count(*) from item_reference_photos;")"
check "another theatre sees none" "0" "$(as_user $BOB "select count(*) from item_reference_photos;")"
check "…and can't remove them" "DELETE 0" "$(as_user $BOB "delete from item_reference_photos;")"
check "…or change them" "UPDATE 0" "$(as_user $BOB "update item_reference_photos set photo_path='x';")"

echo ""
echo "── Matching against every picture"
# A photo pointing mostly the tankard's way, but exactly along the globe's
# second picture. Before 008 it would be a tankard; with the second picture
# it is the globe.
check "an item scores as its closest picture" "Brass globe" \
  "$(as_user $ALICE "select i.name from match_items(test_vec(0.6,0.8), 1) m join items i on i.id = m.item_id;")"
check "…a perfect match to that picture scores 1" "t" \
  "$(as_user $ALICE "select round(similarity::numeric,3) > 0.999 from match_items(test_vec(0.6,0.8), 1);")"
check "each item appears once, however many pictures it has" "2" \
  "$(as_user $ALICE "select count(distinct item_id) || '' from match_items(test_vec(1,0), 10) having count(*) = count(distinct item_id);")"
check "closest first" "Brass globe,Pewter tankard" \
  "$(as_user $ALICE "select string_agg(i.name, ',' order by m.similarity desc) from match_items(test_vec(1,0.1), 5) m join items i on i.id = m.item_id;")"
check "a picture with no fingerprint yet is skipped, not an error" "INSERT 0 1" \
  "$(as_user $ALICE "insert into item_reference_photos (item_id, org_id, photo_path, source) values ('$TANKARD','$ORGA','$ORGA/$TANKARD/ref-3.jpg','find_by_photo');")"
check "…and matching still works" "2" "$(as_user $ALICE "select count(*) from match_items(test_vec(1,0), 5);")"
check "a picture from a different model isn't mixed in" "Pewter tankard" \
  "$(q "insert into item_reference_photos (item_id, org_id, photo_path, source, model, embedding) values ('$TANKARD','$ORGA','m.jpg','prop_table','other-model', test_vec(1,0)); set role authenticated; set request.jwt.claim.sub='$ALICE'; select i.name from match_items(test_vec(0,1), 1) m join items i on i.id = m.item_id;" | tail -1)"
check "another theatre's pictures never come back" "Bear head" \
  "$(as_user $BOB "select string_agg(i.name, ',') from match_items(test_vec(0.6,0.8), 5) m join items i on i.id = m.item_id;")"

echo ""
echo "── Deleting and restoring"
check "deleting the item takes its pictures with it" "0" \
  "$(as_user $ALICE "delete from items where id='$GLOBE'; select count(*) from item_reference_photos where item_id='$GLOBE';")"
check "restoring puts them back with their ids (the app's upsert)" "INSERT 0 1" \
  "$(as_user $ALICE "insert into items (id, org_id, name) values ('$GLOBE','$ORGA','Brass globe') on conflict (id) do nothing; insert into item_reference_photos (id, item_id, org_id, photo_path, source, embedding) values ('dddddddd-0000-0000-0000-000000000001','$GLOBE','$ORGA','$ORGA/$GLOBE/ref-2.jpg','prop_table', test_vec(0.6,0.8)) on conflict (id) do nothing;")"
check "…and matching finds the item by them again" "Brass globe" \
  "$(as_user $ALICE "select i.name from match_items(test_vec(0.6,0.8), 1) m join items i on i.id = m.item_id;")"
check "a person removed from the theatre leaves their pictures, unnamed" "t" \
  "$(q "update item_reference_photos set created_by='$AMY'; delete from memberships where user_id='$AMY'; delete from profiles where id='$AMY'; select bool_and(created_by is null) from item_reference_photos where org_id='$ORGA';" | tail -1)"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
