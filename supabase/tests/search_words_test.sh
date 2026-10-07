#!/usr/bin/env bash
# Tests migration 011 against a real Postgres: that a word joined to another
# by punctuation ("orange/rust", "black/gold") is found on its own, from the
# description, the tags and leftover import columns alike; that nothing the
# search found before is lost; that the migration runs twice; and that the
# rebuilt index answers the same as a fresh read.
#
# Usage:  ./search_words_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=searchwordstest
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
create table auth.users (id uuid primary key);
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

echo "── A fresh install from schema.sql"
check "schema.sql applies cleanly" "" "$(run "$HERE/../schema.sql")"
FRESH_SRC="$(q "select md5(prosrc) from pg_proc where proname = 'items_search_document'")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;

insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'),
                                   ('22222222-2222-2222-2222-222222222222');
insert into organizations (id, name, invite_code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha Theatre', 'ALPHA1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Beta Players', 'BETA22');
insert into profiles (id, full_name, active_org_id) values
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Bob', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into memberships (user_id, org_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');
insert into locations (id, org_id, name)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Shelf B');

insert into items (org_id, location_id, name, description, auto_tags, import_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'Green water bottle',
   'Modern insulated water bottle with sage green body, orange/rust top cap, and dark green carrying handle loop. Brand name ''owala'' visible on the band.',
   '{bottle,green,orange}', '{}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000001', null,
   'Tasselled cushion', 'Velvet, tassels on each corner', '{cushion,"black/gold"}', '{}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000001', null,
   'Yorick''s skull', 'Cast resin', '{bone,prop}',
   '{"Item #": "P-001", "Colour": "ivory/grey"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000001', null,
   'Rusty lantern', 'Tin, with a hinged door', '{lantern,metal}', '{}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000002', null,
   'Other theatre''s flask', 'Steel with a red/rust lid', '{flask}', '{}'::jsonb);
SQL

as_user() { # sql
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; $1" 2>&1 | grep -v '^SET$'
}

echo ""
echo "── Before: the search document as migration 004 left it"
check "migration 004 re-applies" "" "$(run "$HERE/../migrations/004_import_data.sql")"
check "\"rust\" misses the bottle (the reported bug)" "Rusty lantern" \
  "$(as_user "select name from search_items_prefix('rust')")"

echo ""
echo "── Migration 011"
check "applies cleanly" "" "$(run "$HERE/../migrations/011_search_split_words.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/011_search_split_words.sql")"
check "leaves the same function a fresh install has" "$FRESH_SRC" \
  "$(q "select md5(prosrc) from pg_proc where proname = 'items_search_document'")"
check "the index is still there and valid" "t" \
  "$(q "select indisvalid from pg_index where indexrelid = 'items_search_idx'::regclass")"

echo ""
echo "── After"
check "\"rust\" finds the bottle from its description" "Green water bottle
Rusty lantern" \
  "$(as_user "select name from search_items_prefix('rust')")"
check "so does \"rus\", as you type" "Green water bottle
Rusty lantern" \
  "$(as_user "select name from search_items_prefix('rus')")"
check "\"orange\" still finds it" "Green water bottle" \
  "$(as_user "select name from search_items_prefix('orange')")"
check "\"orange rust\" finds it (both words)" "Green water bottle" \
  "$(as_user "select name from search_items_prefix('orange rust')")"
check "\"orange/rust\" as typed finds it" "Green water bottle" \
  "$(as_user "select name from search_items_prefix('orange/rust')")"
check "\"rust cap\" finds it" "Green water bottle" \
  "$(as_user "select name from search_items_prefix('rust cap')")"
check "a dotted word splits too (\"owala\" was in quotes)" "Green water bottle" \
  "$(as_user "select name from search_items_prefix('owala')")"
check "a joined tag splits (\"gold\" in black/gold)" "Tasselled cushion" \
  "$(as_user "select name from search_items_prefix('gold')")"
check "a joined import value splits (\"grey\" in ivory/grey)" "Yorick's skull" \
  "$(as_user "select name from search_items_prefix('grey')")"
check "an inventory number still types back in (P-001)" "Yorick's skull" \
  "$(as_user "select name from search_items_prefix('P-001')")"
check "and as p001" "Yorick's skull" \
  "$(as_user "select name from search_items_prefix('p001')")"
check "location search still works" "Green water bottle" \
  "$(as_user "select name from search_items_prefix('shelf')")"
check "another theatre's red/rust flask stays out (RLS)" "0" \
  "$(as_user "select count(*) from search_items_prefix('flask')")"
# Whole words here, not prefixes: "rust" isn't "rusty" to this one.
check "the websearch variant finds the bottle" "Green water bottle" \
  "$(as_user "select name from search_items('rust') order by name")"
check "the rebuilt index answers the same (sequential scans off)" "Green water bottle" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set enable_seqscan = off; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; select name from items where to_tsvector('english', items_search_document(name, description, auto_tags, import_data)) @@ websearch_to_tsquery('english', 'rust') order by name" 2>&1 | grep -v '^SET$')"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
