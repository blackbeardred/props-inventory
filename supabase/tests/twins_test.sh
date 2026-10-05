#!/usr/bin/env bash
# Migration 009 (twins) against a real Postgres: schema.sql loads with it,
# the migration applies to a database that predates it and applies twice, its
# row-level security keeps each theatre's twins to itself, and match_items
# shares pictures across a set of twins.
#
# Usage:  ./twins_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=twinstest
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

echo "── schema.sql, with twins in it"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../schema.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "schema.sql loads" "" "$out"
check "the table is there" "1" "$(q "select count(*) from pg_tables where tablename='item_twins'")"

echo ""
echo "── Migration 009 on a database that has 008 but not 009"
q "drop table item_twins cascade;" >/dev/null
psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/008_item_reference_photos.sql" >/dev/null 2>&1
check "match_items is the 008 version before" "0" \
  "$(q "select count(*) from pg_proc where proname='match_items' and prosrc like '%item_twins%'")"
apply() { psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/009_item_twins.sql" 2>&1 | grep -i "^ERROR" | head -2; }
check "applies" "" "$(apply)"
check "applies a second time" "" "$(apply)"
check "row-level security is on" "t" "$(q "select relrowsecurity from pg_class where relname='item_twins'")"
check "two policies, after two runs" "2" "$(q "select count(*) from pg_policies where tablename='item_twins'")"
check "the write policy checks the item belongs to the theatre" "1" \
  "$(q "select count(*) from pg_policies where tablename='item_twins' and with_check like '%items%'")"
check "match_items exists, once, and knows about twins" "1" \
  "$(q "select count(*) from pg_proc where proname='match_items' and prosrc like '%item_twins%'")"
check "…and still isn't security definer" "f" "$(q "select prosecdef from pg_proc where proname='match_items'")"
check "a deleted twin's photo can be kept as a 'twin' picture" "1" \
  "$(q "select count(*) from pg_constraint where conname='item_reference_photos_source_check' and pg_get_constraintdef(oid) like '%twin%'")"
check "…and 'duplicate' is still allowed (008's rows stay valid)" "1" \
  "$(q "select count(*) from pg_constraint where conname='item_reference_photos_source_check' and pg_get_constraintdef(oid) like '%duplicate%'")"
check "no existing table gained a column" "0" \
  "$(q "select count(*) from information_schema.columns where table_schema='public' and column_name='twin_set' and table_name <> 'item_twins'")"

ALICE=11111111-1111-1111-1111-111111111111
AMY=33333333-3333-3333-3333-333333333333
BOB=22222222-2222-2222-2222-222222222222
ORGA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
ORGB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
CANDLE1=cccccccc-0000-0000-0000-000000000001
CANDLE2=cccccccc-0000-0000-0000-000000000002
CANDLE3=cccccccc-0000-0000-0000-000000000003
TANKARD=cccccccc-0000-0000-0000-000000000004
BEAR=cccccccc-0000-0000-0000-00000000000b
SET1=dddddddd-0000-0000-0000-000000000001

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
insert into items (id, org_id, name) values
  ('$CANDLE1','$ORGA','Brass candlestick'), ('$CANDLE2','$ORGA','Brass candlestick'),
  ('$CANDLE3','$ORGA','Brass candlestick, tall'), ('$TANKARD','$ORGA','Pewter tankard'),
  ('$BEAR','$ORGB','Bear head');
-- Only the first candlestick has a fingerprinted photo.
insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values
  ('$CANDLE1','$ORGA','a/c1.jpg', test_vec(1,0)),
  ('$TANKARD','$ORGA','a/t.jpg', test_vec(0,1)),
  ('$BEAR','$ORGB','b/bear.jpg', test_vec(1,0));
SQL

echo ""
echo "── Before they're twins"
check "the candlestick's photo finds only that candlestick" "1" \
  "$(as_user $ALICE "select count(*) from match_items(test_vec(1,0), 5) m join items i on i.id = m.item_id where i.name = 'Brass candlestick';")"

echo ""
echo "── Linking twins"
check "a member links two of their theatre's items" "INSERT 0 2" \
  "$(as_user $AMY "insert into item_twins (item_id, org_id, twin_set) values ('$CANDLE1','$ORGA','$SET1'), ('$CANDLE2','$ORGA','$SET1');")"
check "an item belongs to one set at most" "1" \
  "$(as_user_full $AMY "insert into item_twins (item_id, org_id, twin_set) values ('$CANDLE1','$ORGA',gen_random_uuid());" | grep -c 'duplicate key')"
check "another theatre's item can't join, even under this theatre's org" "1" \
  "$(as_user_full $AMY "insert into item_twins (item_id, org_id, twin_set) values ('$BEAR','$ORGA','$SET1');" | grep -c 'violates row-level security')"
check "…nor under its own" "1" \
  "$(as_user_full $AMY "insert into item_twins (item_id, org_id, twin_set) values ('$BEAR','$ORGB','$SET1');" | grep -c 'violates row-level security')"
check "the theatre sees its twins" "2" "$(as_user $ALICE "select count(*) from item_twins;")"
check "another theatre sees none" "0" "$(as_user $BOB "select count(*) from item_twins;")"
check "…and can't unlink them" "DELETE 0" "$(as_user $BOB "delete from item_twins;")"
check "…or move them" "UPDATE 0" "$(as_user $BOB "update item_twins set twin_set = gen_random_uuid();")"

echo ""
echo "── Pictures are shared across twins"
check "one candlestick's photo now finds both, equally" "2|1.000" \
  "$(as_user $ALICE "select count(*) || '|' || round(min(m.similarity)::numeric, 3) from match_items(test_vec(1,0), 5) m join items i on i.id = m.item_id where i.name = 'Brass candlestick';")"
check "the twin with no photo of its own is found by its twin's" "t" \
  "$(as_user $ALICE "select exists (select 1 from match_items(test_vec(1,0), 5) where item_id = '$CANDLE2');")"
check "each item still appears once" "t" \
  "$(as_user $ALICE "select count(*) = count(distinct item_id) from match_items(test_vec(1,0), 10);")"
check "an item that isn't a twin is unaffected" "1.000" \
  "$(as_user $ALICE "select round(similarity::numeric, 3) from match_items(test_vec(0,1), 5) where item_id = '$TANKARD';")"
check "a similar-named item that isn't linked gains nothing" "f" \
  "$(as_user $ALICE "select exists (select 1 from match_items(test_vec(1,0), 10) where item_id = '$CANDLE3');")"
check "a confirmed picture of either twin counts for both" "2" \
  "$(as_user $ALICE "insert into item_reference_photos (item_id, org_id, photo_path, source, embedding) values ('$CANDLE2','$ORGA','a/c2-ref.jpg','find_by_photo', test_vec(0.6,0.8)); select count(*) from match_items(test_vec(0.6,0.8), 5) where similarity > 0.999;")"
check "another theatre's twins never come back" "$BEAR" \
  "$(as_user $BOB "select string_agg(item_id::text, ',') from match_items(test_vec(1,0), 5);")"
check "a third twin joins the same set" "3" \
  "$(as_user $AMY "insert into item_twins (item_id, org_id, twin_set) values ('$CANDLE3','$ORGA','$SET1'); select count(*) from match_items(test_vec(1,0), 5) where similarity > 0.999;")"
check "…and leaves it again" "2" \
  "$(as_user $AMY "delete from item_twins where item_id='$CANDLE3'; select count(*) from match_items(test_vec(1,0), 5) where similarity > 0.999;")"
check "a deleted twin's photo is accepted as a 'twin' picture of the other" "INSERT 0 1" \
  "$(as_user $AMY "insert into item_reference_photos (item_id, org_id, photo_path, source) values ('$CANDLE2','$ORGA','a/c2-twin.jpg','twin');")"

echo ""
echo "── Deleting"
check "deleting a twin takes its row with it" "0" \
  "$(as_user $ALICE "delete from items where id='$CANDLE1'; select count(*) from item_twins where item_id='$CANDLE1';")"
check "…and leaves the other's" "1" "$(q "select count(*) from item_twins where item_id='$CANDLE2'")"
check "restoring puts it back in the set (the app's upsert)" "INSERT 0 1" \
  "$(as_user $ALICE "insert into items (id, org_id, name) values ('$CANDLE1','$ORGA','Brass candlestick') on conflict (id) do nothing; insert into item_twins (item_id, org_id, twin_set) values ('$CANDLE1','$ORGA','$SET1') on conflict (item_id) do nothing;")"
check "a theatre that's removed takes its twins with it" "0" \
  "$(q "delete from organizations where id='$ORGA'; select count(*) from item_twins;" | tail -1)"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
