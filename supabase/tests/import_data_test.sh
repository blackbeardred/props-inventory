#!/usr/bin/env bash
# Tests migration 004 against a real Postgres: that it applies to a database
# already carrying 001-003, that it applies twice without complaining, and
# that a value living only in a leftover spreadsheet column is findable.
#
# Usage:  ./import_data_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=importtest
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

psql -h /tmp -p "$PORT" -U postgres -qc "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
-- schema.sql declares a pgvector column (migration 005), so the extension
-- has to exist before it loads. Supabase provides both; a bare Postgres needs
-- postgresql-<version>-pgvector installed.
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

echo "── Applying schema and migrations 001-003"
for file in "$HERE/../schema.sql" "$HERE"/../migrations/00[123]_*.sql; do
  out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$file" 2>&1 | grep -i "^ERROR" | head -3)
  if [ -n "$out" ]; then echo "  FAIL  $(basename "$file"): $out"; FAIL=$((FAIL+1));
  else echo "  ok    $(basename "$file")"; fi
done

echo ""
echo "── Migration 004"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/004_import_data.sql" 2>&1 | grep -i "^ERROR" | head -3)
check "applies cleanly" "" "$out"

out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/004_import_data.sql" 2>&1 | grep -i "^ERROR" | head -3)
check "applies a second time (re-runnable)" "" "$out"

check "the old 3-argument search document is gone" "0" \
  "$(q "select count(*) from pg_proc where proname = 'items_search_document' and pronargs = 3")"
check "the index was rebuilt over the new expression" "1" \
  "$(q "select count(*) from pg_indexes where indexname = 'items_search_idx' and indexdef like '%import_data%'")"
check "import_data defaults to an empty object" "{}" \
  "$(q "select column_default from information_schema.columns where table_name='items' and column_name='import_data'" | sed "s/'::jsonb//;s/'//")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;
SQL

echo ""
echo "── Searching what the import kept"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into organizations (id, name, invite_code)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha Theatre', 'ALPHA1');
insert into profiles (id, full_name, active_org_id)
  values ('11111111-1111-1111-1111-111111111111', 'Alice', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into memberships (user_id, org_id, role)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner');
insert into locations (id, org_id, name)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Shelf B');

insert into items (org_id, location_id, name, description, auto_tags, import_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'Yorick''s skull', 'Cast resin', '{bone,prop}',
   '{"Item #": "P-001", "Donor": "Jane Pemberton", "Acquired": "2026-01-05"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'Brass candlestick', 'Single taper', '{brass,lighting}',
   '{"Item #": "P-002", "Donor": "Ravenscroft Estate"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000001', null,
   'Hand-typed chair', 'Added through the form', '{wood,furniture}', '{}'::jsonb);
SQL

as_user() { # sql
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; $1" 2>&1 | grep -v '^SET$'
}

check "an inventory number finds its item" "Yorick's skull" \
  "$(as_user "select name from search_items_prefix('P-001')")"
check "a donor's name finds it too" "Yorick's skull" \
  "$(as_user "select name from search_items_prefix('Pemberton')")"
check "a shared donor finds only the right one" "Brass candlestick" \
  "$(as_user "select name from search_items_prefix('Ravenscroft')")"
check "the heading itself is not searchable" "" \
  "$(as_user "select name from search_items_prefix('donor')")"
check "ordinary search still works" "Yorick's skull" \
  "$(as_user "select name from search_items_prefix('skull')")"
check "location search still works" "Brass candlestick
Yorick's skull" \
  "$(as_user "select name from search_items_prefix('shelf')")"
check "an item with no leftover data is unaffected" "Hand-typed chair" \
  "$(as_user "select name from search_items_prefix('chair')")"
check "websearch variant reads it as well" "Yorick's skull" \
  "$(as_user "select name from search_items('Pemberton')")"
check "leftover data is still org-scoped by RLS" "3" \
  "$(as_user "select count(*) from items")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
