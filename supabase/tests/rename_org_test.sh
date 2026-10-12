#!/usr/bin/env bash
# Tests migration 012 against a real Postgres: an owner can rename the theatre
# they have open, and nobody else can rename anything; the name is tidied and
# checked; the migration runs twice and matches schema.sql; and members still
# can't update organizations directly.
#
# Usage:  ./rename_org_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=renameorgtest
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
FRESH_SRC="$(q "select md5(prosrc) from pg_proc where proname = 'rename_organization'")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
insert into organizations (id, name, invite_code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha Theatre', 'ALPHA1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Beta Players', 'BETA22');
insert into profiles (id, full_name, active_org_id) values
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Bob', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('33333333-3333-3333-3333-333333333333', 'Carol', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into memberships (user_id, org_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'member'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner'),
  -- Alice also owns Beta, but has Alpha open.
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');
SQL

as_user() { # uid sql
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | grep -v -e '^SET$' -e '^CONTEXT:' | sed 's/^ERROR:  //'
}
ALICE=11111111-1111-1111-1111-111111111111
BOB=22222222-2222-2222-2222-222222222222
CAROL=33333333-3333-3333-3333-333333333333
name_of() { q "select name from organizations where id = 'aaaaaaaa-0000-0000-0000-00000000000$1'"; }

echo ""
echo "── Migration 012"
check "applies cleanly" "" "$(run "$HERE/../migrations/012_rename_organization.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/012_rename_organization.sql")"
check "leaves the same function a fresh install has" "$FRESH_SRC" \
  "$(q "select md5(prosrc) from pg_proc where proname = 'rename_organization'")"
check "is security definer" "t" "$(q "select prosecdef from pg_proc where proname = 'rename_organization'")"

echo ""
echo "── Renaming"
check "an owner renames the theatre they have open" "Alpha Repertory" \
  "$(as_user $ALICE "select rename_organization('Alpha Repertory')")"
check "  and it sticks" "Alpha Repertory" "$(name_of 1)"
check "  their other theatre is untouched" "Beta Players" "$(name_of 2)"
check "spaces are tidied" "The Alpha Company" \
  "$(as_user $ALICE "select rename_organization('   The   Alpha  Company ')")"
check "a blank name is refused" "A theatre needs a name" \
  "$(as_user $ALICE "select rename_organization('   ')")"
check "a null name is refused" "A theatre needs a name" \
  "$(as_user $ALICE "select rename_organization(null)")"
check "101 characters is refused" "That name is too long: 100 characters at most" \
  "$(as_user $ALICE "select rename_organization(repeat('x', 101))")"
check "100 characters is fine" "100" \
  "$(as_user $ALICE "select char_length(rename_organization(repeat('y', 100)))")"
as_user $ALICE "select rename_organization('The Alpha Company')" >/dev/null
check "a member can't rename" "Only an owner can rename the theatre" \
  "$(as_user $BOB "select rename_organization('Bob''s Theatre')")"
check "  and the name is unchanged" "The Alpha Company" "$(name_of 1)"
check "another theatre's owner renames only their own" "Beta Rep" \
  "$(as_user $CAROL "select rename_organization('Beta Rep')")"
check "  Alpha is unchanged" "The Alpha Company" "$(name_of 1)"
check "someone with no theatre open is refused" "You have no active organization" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; select rename_organization('Nope')" 2>&1 | grep -v -e '^SET$' -e '^CONTEXT:' | sed 's/^ERROR:  //')"

echo ""
echo "── Still no direct updates"
as_user $ALICE "update organizations set name = 'Sneaky' where id = 'aaaaaaaa-0000-0000-0000-000000000001'" >/dev/null
check "an owner can't update organizations directly" "The Alpha Company" "$(name_of 1)"
as_user $BOB "update organizations set name = 'Sneaky' where id = 'aaaaaaaa-0000-0000-0000-000000000001'" >/dev/null
check "nor can a member" "The Alpha Company" "$(name_of 1)"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
