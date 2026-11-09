#!/usr/bin/env bash
# Tests migration 019 (costumes on pull lists) against a real Postgres: a
# theatre can only see and make costumes on its own pull lists; a line can
# only join a costume on its own list; deleting a costume keeps its pieces;
# Recently Deleted can hold one; the migration runs twice and matches
# schema.sql.
#
# Usage:  ./costumes_test.sh [port]
#
# Note: run() looks for "ERROR" anywhere on a line. psql prints a file's
# errors as "psql:file:line: ERROR: …", so a check for lines *starting* with
# ERROR would pass whatever happened.
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=costumetest
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
  psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 | grep "ERROR" | head -3
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

echo "── A fresh install from schema.sql"
check "schema.sql applies cleanly" "" "$(run "$HERE/../schema.sql")"
SHAPE="select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by table_name, column_name) from information_schema.columns where table_name in ('pull_list_groups', 'pull_list_items')"
CONS="select string_agg(conname || ':' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint where conrelid in ('pull_list_groups'::regclass, 'pull_list_items'::regclass, 'deleted_records'::regclass)"
FRESH_SHAPE="$(q "$SHAPE")"
FRESH_CONS="$(q "$CONS")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;
SQL

echo ""
echo "── Migration 019 on top"
check "applies cleanly" "" "$(run "$HERE/../migrations/019_costumes.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/019_costumes.sql")"
check "columns match a fresh install" "$FRESH_SHAPE" "$(q "$SHAPE")"
check "constraints match a fresh install" "$FRESH_CONS" "$(q "$CONS")"
check "RLS is on, with one policy" "t|1" \
  "$(q "select relrowsecurity from pg_class where relname = 'pull_list_groups'")|$(q "select count(*) from pg_policies where tablename = 'pull_list_groups'")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Rep A'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Rep B');
insert into profiles (id, full_name, active_org_id) values
  ('11111111-1111-1111-1111-111111111111', 'Ann', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Bea', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into memberships (user_id, org_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');
insert into productions (id, org_id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Brigadoon'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Oliver!');
insert into pull_lists (id, production_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002');
insert into items (id, org_id, name, category) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Long white dress', 'costume'),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Corset', 'costume');
SQL

as_user() { # uid sql
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | grep -v '^SET$' | head -1 | sed 's/^ERROR:  //'
}
ANN=11111111-1111-1111-1111-111111111111
BEA=22222222-2222-2222-2222-222222222222
LIST=cccccccc-0000-0000-0000-000000000001
LIST2=cccccccc-0000-0000-0000-000000000002
BLIST=cccccccc-0000-0000-0000-000000000003
DRESS=dddddddd-0000-0000-0000-000000000001
CORSET=dddddddd-0000-0000-0000-000000000002

echo ""
echo "── Making costumes"
G="$(as_user $ANN "insert into pull_list_groups (pull_list_id, name) values ('$LIST', 'Margaret costume') returning id")"
check "a theatre makes a costume on its own list" "36" "$(printf %s "$G" | wc -c | tr -d ' ')"
check "and puts a piece in it" "1" \
  "$(as_user $ANN "with x as (insert into pull_list_items (pull_list_id, item_id, group_id) values ('$LIST', '$DRESS', '$G') returning 1) select count(*) from x")"
check "a piece can't join a costume on another list" \
  "insert or update on table \"pull_list_items\" violates foreign key constraint \"pull_list_items_group_fk\"" \
  "$(as_user $ANN "insert into pull_list_items (pull_list_id, item_id, group_id) values ('$LIST2', '$CORSET', '$G')")"
check "nor be moved onto another list while in it" \
  "insert or update on table \"pull_list_items\" violates foreign key constraint \"pull_list_items_group_fk\"" \
  "$(as_user $ANN "update pull_list_items set pull_list_id = '$LIST2' where group_id = '$G'")"
check "a blank name is refused" \
  "new row for relation \"pull_list_groups\" violates check constraint \"pull_list_groups_name_check\"" \
  "$(as_user $ANN "insert into pull_list_groups (pull_list_id, name) values ('$LIST', '   ')")"
check "so is one over 80 characters" \
  "new row for relation \"pull_list_groups\" violates check constraint \"pull_list_groups_name_check\"" \
  "$(as_user $ANN "insert into pull_list_groups (pull_list_id, name) values ('$LIST', repeat('x', 81))")"

echo ""
echo "── Another theatre"
check "can't see the costume" "0" "$(as_user $BEA "select count(*) from pull_list_groups")"
check "can't rename it" "0" \
  "$(as_user $BEA "with x as (update pull_list_groups set name = 'Mine now' returning 1) select count(*) from x")"
check "can't delete it" "0" \
  "$(as_user $BEA "with x as (delete from pull_list_groups returning 1) select count(*) from x")"
check "can't make one on Ann's list" \
  "new row violates row-level security policy for table \"pull_list_groups\"" \
  "$(as_user $BEA "insert into pull_list_groups (pull_list_id, name) values ('$LIST', 'Sneaky')")"
check "can't move Ann's costume onto its own list" "0" \
  "$(as_user $BEA "with x as (update pull_list_groups set pull_list_id = '$BLIST' returning 1) select count(*) from x")"
check "makes its own on its own list" "1" \
  "$(as_user $BEA "with x as (insert into pull_list_groups (pull_list_id, name) values ('$BLIST', 'Fagin costume') returning 1) select count(*) from x")"
check "and Ann still sees only hers" "Margaret costume" "$(as_user $ANN "select string_agg(name, ',') from pull_list_groups")"

echo ""
echo "── Deleting"
check "deleting the costume keeps its pieces, loose" "1|0" \
  "$(as_user $ANN "delete from pull_list_groups where id = '$G'" >/dev/null; q "select count(*) from pull_list_items where item_id = '$DRESS'")|$(q "select count(*) from pull_list_items where group_id is not null")"
G2="$(as_user $ANN "insert into pull_list_groups (pull_list_id, name) values ('$LIST', 'Harry costume') returning id")"
as_user $ANN "update pull_list_items set group_id = '$G2' where item_id = '$DRESS'" >/dev/null
check "deleting the pull list takes its costumes and lines with it" "0|0" \
  "$(q "delete from pull_lists where id = '$LIST'" >/dev/null; q "select count(*) from pull_list_groups where id = '$G2'")|$(q "select count(*) from pull_list_items where item_id = '$DRESS'")"
check "Recently Deleted can hold a costume" "1" \
  "$(as_user $ANN "with x as (insert into deleted_records (org_id, kind, label, snapshot, deleted_by) values ('aaaaaaaa-0000-0000-0000-000000000001', 'pull_list_group', 'Margaret costume', '{}', '$ANN') returning 1) select count(*) from x")"
check "but still nothing it doesn't know" \
  "new row for relation \"deleted_records\" violates check constraint \"deleted_records_kind_check\"" \
  "$(as_user $ANN "insert into deleted_records (org_id, kind, label, snapshot, deleted_by) values ('aaaaaaaa-0000-0000-0000-000000000001', 'nonsense', 'x', '{}', '$ANN')")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
