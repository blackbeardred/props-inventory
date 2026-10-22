#!/usr/bin/env bash
# Tests migration 014 against a real Postgres: test copies made before it get
# the pictured items' new names and descriptions, an item a tester already
# changed is left alone, the plates move to Shelf B, pull lists follow, running
# it twice changes nothing more, and copies made after it start that way.
#
# Usage:  ./sample_photos_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=samplephotostest
PASS=0; FAIL=0

if ! pg_isready -h /tmp -p "$PORT" >/dev/null 2>&1; then
  mkdir -p "$PGDATA" && chown -R postgres:postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PORT' -l /tmp/pg.log start" >/dev/null 2>&1
  sleep 3
fi

q() { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "$1" 2>&1; }

check() { # label expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1"
  else FAIL=$((FAIL+1)); echo "  FAIL  $1"; echo "        expected: $2"; echo "        actual:   $3"; fi
}

run() { # file
  psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 | grep -i "^ERROR" | head -3
}

psql -h /tmp -p "$PORT" -U postgres -qc "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner uuid
);
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon')
  then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
  then create role authenticated nologin; end if; end $$;
SQL

echo "── Copies made before 014"
check "schema.sql applies cleanly" "" "$(run "$HERE/../schema.sql")"
NEW_SEED="$(q "select md5(prosrc) from pg_proc where proname = 'seed_sample_theatre'")"
check "013 applies (with its old sample theatre)" "" "$(run "$HERE/../migrations/013_tryout_links.sql")"
q "select create_tryout('Tester ' || n) from generate_series(1, 2) n" >/dev/null
ORG1="$(q "select org_id from tryout_links where label = 'Tester 1'")"
ORG2="$(q "select org_id from tryout_links where label = 'Tester 2'")"
check "the old copies have the old names" "2" "$(q "select count(*) from items where org_id = '$ORG1' and name = 'Silver Tray'")"
# Tester 2 has already rewritten the tea set's description.
q "update items set description = 'Our good china' where org_id = '$ORG2' and name = 'Tea set'" >/dev/null

echo ""
echo "── Migration 014"
check "applies cleanly" "" "$(run "$HERE/../migrations/014_sample_photos.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/014_sample_photos.sql")"
check "still not callable from the app" "f" "$(q "select has_function_privilege('authenticated', 'seed_sample_theatre(uuid)', 'execute')")"

echo ""
echo "── What it did to the old copies"
check "still 24 items each" "24|24" "$(q "select count(*) from items where org_id = '$ORG1'")|$(q "select count(*) from items where org_id = '$ORG2'")"
check "the two silver trays are black platters" "2" "$(q "select count(*) from items where org_id = '$ORG1' and name = 'Serving platter, black'")"
check "  keeping their two descriptions" "Oval glazed platter.|Oval glazed platter. Small chip on the underside." \
  "$(q "select string_agg(description, '|' order by description) from items where org_id = '$ORG1' and name = 'Serving platter, black'")"
check "the candlesticks became the violin and the birdcage" "Birdcage, gold|Violin ornament, brass" \
  "$(q "select string_agg(i.name, '|' order by i.name) from items i join locations l on l.id = i.location_id where i.org_id = '$ORG1' and l.name = 'Shelf A' and i.name in ('Birdcage, gold', 'Violin ornament, brass')")"
check "the tankards are plates, moved to Shelf B" "Shelf B|4" \
  "$(q "select l.name || '|' || i.quantity from items i join locations l on l.id = i.location_id where i.org_id = '$ORG1' and i.name = 'Dinner plate, white'")"
check "  and they're still in Twelfth Night" "1" \
  "$(q "select count(*) from pull_list_items pli join items i on i.id = pli.item_id where i.org_id = '$ORG1' and i.name = 'Dinner plate, white'")"
check "the rapier is a stage dagger, inventory number kept" "W-031|2" \
  "$(q "select import_data->>'Inventory No.' || '|' || quantity from items where org_id = '$ORG1' and name = 'Stage dagger'")"
check "the crown's note is updated" "One stud loose" "$(q "select import_data->>'Notes' from items where org_id = '$ORG1' and name = 'Crown, gold'")"
check "the velvet cloak is a fan, still a costume" "costume" "$(q "select category from items where org_id = '$ORG1' and name = 'Fan, lace'")"
check "nothing old is left in Tester 1's copy" "0" \
  "$(q "select count(*) from items where org_id = '$ORG1' and name in ('Silver Tray','Brass candlestick','Pewter tankard','Rug (Persian style)','Bicycle, 1920s','Umbrella, black','Tea set')")"
check "the untouched six are as they were" "6" \
  "$(q "select count(*) from items where org_id = '$ORG1' and name in ('Yorick''s skull','Map (Aged)','Rotary telephone','Travel trunk','Doublet, black','Ruff collar')")"
check "a search for rust still finds something" "Curtains, paisley (pair)" \
  "$(q "select name from items where org_id = '$ORG1' and to_tsvector('english', items_search_document(name, description, auto_tags, import_data)) @@ plainto_tsquery('english', 'rust')")"
check "Tester 2's rewritten tea set is left alone" "Tea set|Our good china" \
  "$(q "select name || '|' || description from items where org_id = '$ORG2' and description = 'Our good china'")"
check "  the rest of Tester 2's copy was updated" "1" "$(q "select count(*) from items where org_id = '$ORG2' and name = 'Anvil'")"
check "a real theatre is never touched" "0" "$(q "select count(*) from items where org_id not in (select org_id from tryout_links)")"

echo ""
echo "── Copies made after 014"
q "select create_tryout('Tester 3')" >/dev/null
ORG3="$(q "select org_id from tryout_links where label = 'Tester 3'")"
check "start with the new names" "Anvil|Mug, monogram A|Umbrella, blue" \
  "$(q "select string_agg(name, '|' order by name) from items where org_id = '$ORG3' and name in ('Anvil','Mug, monogram A','Umbrella, blue')")"
check "  and the same 24 items, 7 pull-list lines" "24|7" \
  "$(q "select count(*) from items where org_id = '$ORG3'")|$(q "select count(*) from pull_list_items pli join pull_lists pl on pl.id = pli.pull_list_id join productions p on p.id = pl.production_id where p.org_id = '$ORG3'")"
check "  matching the updated copies item for item" "" \
  "$(q "select string_agg(x, ',') from ((select name, description, quantity, condition from items where org_id = '$ORG3' except all select name, description, quantity, condition from items where org_id = '$ORG1') ) d(x)")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
