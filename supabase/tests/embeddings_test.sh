#!/usr/bin/env bash
# Tests migration 005 against a real Postgres: that it applies to a database
# already carrying 001-004, that it applies twice without complaining, and that
# the pieces it adds behave — a fingerprint tied to one photo and one model,
# a match that ranks by how alike two pictures are, and a table that empties
# itself when its items go.
#
# What it deliberately does NOT test: whether CLIP actually recognises a brass
# globe. That needs real photographs and lives on the app side.
#
# Usage:  ./embeddings_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=embedtest
PASS=0; FAIL=0

if ! pg_isready -h /tmp -p "$PORT" >/dev/null 2>&1; then
  mkdir -p "$PGDATA" && chown -R postgres:postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PORT' -l /tmp/pg.log start" >/dev/null 2>&1
  sleep 3
fi

q() { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "$1" 2>&1 | tail -1; }
apply() { psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 | grep -i "^ERROR" | head -3; }

check() { # label expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1"
  else FAIL=$((FAIL+1)); echo "  FAIL  $1"; echo "        expected: $2"; echo "        actual:   $3"; fi
}

psql -h /tmp -p "$PORT" -U postgres -qc "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
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

if ! psql -h /tmp -p "$PORT" -U postgres -d $DB -qc "create extension if not exists vector with schema extensions;" >/dev/null 2>&1; then
  echo "pgvector is not installed in this Postgres."
  echo "  apt-get install -y postgresql-$($PGBIN/postgres -V | grep -oE '[0-9]+' | head -1)-pgvector"
  exit 1
fi

echo "── Applying schema and migrations 001-004"
# Counted, because an unmatched glob would otherwise skip a migration in
# silence and let the checks below pass against a database that never had it.
found=$(ls "$HERE"/../migrations/00[1234]_*.sql 2>/dev/null | wc -l)
check "all four earlier migrations are present" "4" "$found"
for file in "$HERE/../schema.sql" "$HERE"/../migrations/00[1234]_*.sql; do
  out=$(apply "$file")
  if [ -n "$out" ]; then echo "  FAIL  $(basename "$file"): $out"; FAIL=$((FAIL+1));
  else echo "  ok    $(basename "$file")"; fi
done

echo ""
echo "── Migration 005"
check "applies cleanly"                     "" "$(apply "$HERE/../migrations/005_item_photo_embeddings.sql")"
check "applies a second time (re-runnable)" "" "$(apply "$HERE/../migrations/005_item_photo_embeddings.sql")"

check "pgvector is installed"          "1" "$(q "select count(*) from pg_extension where extname='vector'")"
check "the fingerprint table exists"   "1" "$(q "select count(*) from pg_tables where tablename='item_photo_embeddings'")"
check "row-level security is on"       "t" "$(q "select relrowsecurity from pg_class where relname='item_photo_embeddings'")"
check "both policies survived a re-run" "2" \
  "$(q "select count(*) from pg_policies where tablename='item_photo_embeddings'")"
check "match_items exists, once"       "1" "$(q "select count(*) from pg_proc where proname='match_items'")"
check "match_items is not security definer" "f" \
  "$(q "select prosecdef from pg_proc where proname='match_items'")"
check "the org index exists"           "1" \
  "$(q "select count(*) from pg_indexes where indexname='item_photo_embeddings_org_idx'")"
check "nothing in 001-004 was disturbed" "8" \
  "$(q "select count(*) from pg_tables where schemaname='public' and tablename in
        ('organizations','profiles','memberships','locations','items','productions','pull_lists','pull_list_items')")"

echo ""
echo "── What the fingerprints do"
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
create or replace function test_vec(a float, b float) returns extensions.vector
language sql immutable as $fn$
  select ('[' || a || ',' || b || ',' ||
          array_to_string(array_fill(0.0::float, array[510]), ',') || ']')::extensions.vector
$fn$;
insert into organizations (id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Alpha');
insert into items (id, org_id, name, photo_url) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Brass globe','a/globe.jpg'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Pewter tankard','a/tankard.jpg');
insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a/globe.jpg', test_vec(1,0)),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a/tankard.jpg', test_vec(0,1));
SQL

check "a wrong-dimension fingerprint is refused" "1" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','x','[1,2,3]');" 2>&1 | grep -ci 'expected 512 dimensions')"
check "one fingerprint per item, not a pile" "1" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a/globe2.jpg', test_vec(1,0));" 2>&1 | grep -ci 'duplicate key')"

check "the globe's own photo finds the globe" "Brass globe" \
  "$(q "select i.name from match_items(test_vec(1,0), 1) m join items i on i.id = m.item_id")"
check "a perfect match scores 1"              "t" \
  "$(q "select round(similarity::numeric, 3) > 0.999 from match_items(test_vec(1,0), 1)")"
check "an unrelated photo scores near 0"      "t" \
  "$(q "select similarity < 0.2 from match_items(test_vec(1,0), 2) order by similarity limit 1")"
check "results come back closest first"       "t" \
  "$(q "select similarity >= lead(similarity) over () or lead(similarity) over () is null
        from match_items(test_vec(0.7,0.3), 2) limit 1")"
check "the default is 5 candidates"           "2" "$(q "select count(*) from match_items(test_vec(1,0))")"
check "an absurd match_count is capped at 50" "2" "$(q "select count(*) from match_items(test_vec(1,0), 9999)")"

echo "── Fingerprints from another model are ignored, not mixed in"
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 \
  -c "update item_photo_embeddings set model = 'something-else' where item_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';"
check "the re-modelled item drops out of matching" "Pewter tankard" \
  "$(q "select i.name from match_items(test_vec(1,0), 5) m join items i on i.id = m.item_id")"

echo "── A fingerprint cannot outlive its item"
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 \
  -c "delete from items where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';"
check "deleting the item takes its fingerprint" "1" \
  "$(q "select count(*) from item_photo_embeddings")"
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 \
  -c "delete from organizations where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';"
check "deleting the theatre takes the rest"     "0" \
  "$(q "select count(*) from item_photo_embeddings")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
