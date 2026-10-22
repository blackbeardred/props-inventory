#!/usr/bin/env bash
# Tests migration 015 against a real Postgres: copies made under 014 get the
# last six descriptions and the five moves; something a tester moved or
# rewrote stays put; running it twice changes nothing more; and copies made
# after it match a fresh install's sample theatre.
#
# Usage:  ./sample_places_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=sampleplacestest
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

echo "── Copies made under 014"
check "schema.sql applies cleanly" "" "$(run "$HERE/../schema.sql")"
NEW_SEED="$(q "select md5(prosrc) from pg_proc where proname = 'seed_sample_theatre'")"
check "013 applies" "" "$(run "$HERE/../migrations/013_tryout_links.sql")"
check "014 applies" "" "$(run "$HERE/../migrations/014_sample_photos.sql")"
q "select create_tryout('Tester ' || n) from generate_series(1, 2) n" >/dev/null
ORG1="$(q "select org_id from tryout_links where label = 'Tester 1'")"
ORG2="$(q "select org_id from tryout_links where label = 'Tester 2'")"
place_of() { q "select coalesce(l.name, 'Not filed') from items i left join locations l on l.id = i.location_id where i.org_id = '$1' and i.name = '$2' limit 1"; }
check "the anvil starts in the Loft" "Loft" "$(place_of $ORG1 Anvil)"
# Tester 2 has already moved the anvil to Shelf B, and rewritten the ruff.
q "update items set location_id = (select id from locations where org_id = '$ORG2' and name = 'Shelf B') where org_id = '$ORG2' and name = 'Anvil'" >/dev/null
q "update items set description = 'Ours is yellowed' where org_id = '$ORG2' and name = 'Ruff collar'" >/dev/null

echo ""
echo "── Migration 015"
check "applies cleanly" "" "$(run "$HERE/../migrations/015_sample_places.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/015_sample_places.sql")"
check "leaves the seed function a fresh install has" "$NEW_SEED" "$(q "select md5(prosrc) from pg_proc where proname = 'seed_sample_theatre'")"
check "still not callable from the app" "f" "$(q "select has_function_privilege('authenticated', 'seed_sample_theatre(uuid)', 'execute')")"

echo ""
echo "── What it did"
check "the anvil goes down to Props Room B" "Props Room B" "$(place_of $ORG1 Anvil)"
check "the wheelbarrow too" "Props Room B" "$(place_of $ORG1 'Wheelbarrow, wooden')"
check "the curtains go up to the Loft" "Loft" "$(place_of $ORG1 'Curtains, paisley (pair)')"
check "the birdcage too" "Loft" "$(place_of $ORG1 'Birdcage, gold')"
check "the cane goes to Costume Storage" "Costume Storage" "$(place_of $ORG1 'Walking cane, mahogany')"
check "the map is framed, inventory number kept" "Map, framed|P-014|Shelf A" \
  "$(q "select i.name || '|' || (i.import_data->>'Inventory No.') || '|' || l.name from items i join locations l on l.id = i.location_id where i.org_id = '$ORG1' and i.name like 'Map%'")"
check "the doublet is renamed, and still in Twelfth Night" "1" \
  "$(q "select count(*) from pull_list_items pli join items i on i.id = pli.item_id where i.org_id = '$ORG1' and i.name = 'Doublet, black and red'")"
check "the skull matches its picture" "Life-size plastic skull. The lower jaw hinges open." \
  "$(q "select description from items where org_id = '$ORG1' and name = 'Yorick''s skull'")"
check "the trunk, telephone and ruff do too" "3" \
  "$(q "select count(*) from items where org_id = '$ORG1' and description in ('Black steamer trunk with studded straps and brass latches. Well travelled; holds a body.', 'Black with gold trim and a coiled cord. Bell rings from a battery box.', 'Wide white pleated ruff with lace at the neck.')")"
check "the platters are still together on Shelf B" "2|Shelf B" \
  "$(q "select count(*) || '|' || min(l.name) from items i join locations l on l.id = i.location_id where i.org_id = '$ORG1' and i.name = 'Serving platter, black'")"
check "Tester 2's anvil stays where they put it" "Shelf B" "$(place_of $ORG2 Anvil)"
check "  and their ruff keeps their words" "Ours is yellowed" "$(q "select description from items where org_id = '$ORG2' and name = 'Ruff collar'")"
check "  the rest of Tester 2's copy was updated" "Loft" "$(place_of $ORG2 'Curtains, paisley (pair)')"

echo ""
echo "── Copies made after 015"
q "select create_tryout('Tester 3')" >/dev/null
ORG3="$(q "select org_id from tryout_links where label = 'Tester 3'")"
check "match the updated copy item for item, places included" "0|0" \
  "$(q "select count(*) from (select i.name, i.description, l.name from items i left join locations l on l.id = i.location_id where i.org_id = '$ORG3' except all select i.name, i.description, l.name from items i left join locations l on l.id = i.location_id where i.org_id = '$ORG1') d")|$(q "select count(*) from (select i.name, i.description, l.name from items i left join locations l on l.id = i.location_id where i.org_id = '$ORG1' except all select i.name, i.description, l.name from items i left join locations l on l.id = i.location_id where i.org_id = '$ORG3') d")"
check "  still 24 items and 7 pull-list lines" "24|7" \
  "$(q "select count(*) from items where org_id = '$ORG3'")|$(q "select count(*) from pull_list_items pli join pull_lists pl on pl.id = pli.pull_list_id join productions p on p.id = pl.production_id where p.org_id = '$ORG3'")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
