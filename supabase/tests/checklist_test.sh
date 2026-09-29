#!/usr/bin/env bash
# Migration 005 against a real Postgres: applies to a database carrying
# 001-004, applies twice, and the check_state values are actually constrained.
#
# Usage:  ./checklist_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=checklisttest
PASS=0; FAIL=0

if ! pg_isready -h /tmp -p "$PORT" >/dev/null 2>&1; then
  mkdir -p "$PGDATA" && chown -R postgres:postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PORT' -l /tmp/pg.log start" >/dev/null 2>&1
  sleep 3
fi

q() { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "$1" 2>&1; }
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1"
  else FAIL=$((FAIL+1)); echo "  FAIL  $1"; echo "        expected: $2"; echo "        actual:   $3"; fi
}

psql -h /tmp -p "$PORT" -U postgres -qc "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
-- schema.sql declares a pgvector column (migration 006), so the extension has
-- to exist before it loads. Supabase provides both; a bare Postgres needs
-- postgresql-<version>-pgvector installed.
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

echo "── Schema and migrations 001-004"
for file in "$HERE/../schema.sql" "$HERE"/../migrations/00[1234]_*.sql; do
  out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$file" 2>&1 | grep -i "^ERROR" | head -2)
  if [ -n "$out" ]; then echo "  FAIL  $(basename "$file"): $out"; FAIL=$((FAIL+1));
  else echo "  ok    $(basename "$file")"; fi
done

# schema.sql already carries the new columns, so drop them to stand in for a
# database built before this migration.
psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
alter table pull_list_items
  drop column if exists check_state,
  drop column if exists checked_at,
  drop column if exists checked_by;
SQL

echo ""
echo "── Migration 005"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/005_checklist.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "applies to a database that predates it" "" "$out"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/005_checklist.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "applies a second time" "" "$out"

check "existing rows would read as open" "open" \
  "$(q "select column_default from information_schema.columns where table_name='pull_list_items' and column_name='check_state'" | sed "s/'::text//;s/'//")"
check "who checked it is recorded" "1" \
  "$(q "select count(*) from information_schema.columns where table_name='pull_list_items' and column_name='checked_by'")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into organizations (id, name, invite_code)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha', 'ALPHA1');
insert into profiles (id, full_name, active_org_id)
  values ('11111111-1111-1111-1111-111111111111', 'Alice', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into memberships (user_id, org_id, role)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner');
insert into items (id, org_id, name)
  values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Skull');
insert into productions (id, org_id, name)
  values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Hamlet');
insert into pull_lists (id, production_id) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001');
insert into pull_list_items (id, pull_list_id, item_id) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001');
SQL

check "a new row starts open" "open" \
  "$(q "select check_state from pull_list_items where id='ffffffff-0000-0000-0000-000000000001'")"
check "checked is allowed" "UPDATE 1" \
  "$(q "update pull_list_items set check_state='checked', checked_at=now(), checked_by='11111111-1111-1111-1111-111111111111' where id='ffffffff-0000-0000-0000-000000000001'")"
check "cleared is allowed" "UPDATE 1" \
  "$(q "update pull_list_items set check_state='cleared' where id='ffffffff-0000-0000-0000-000000000001'")"
check "anything else is refused" "1" \
  "$(q "update pull_list_items set check_state='maybe' where id='ffffffff-0000-0000-0000-000000000001'" | grep -c 'violates check constraint')"
check "status is untouched by all that" "pending" \
  "$(q "select status from pull_list_items where id='ffffffff-0000-0000-0000-000000000001'")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
