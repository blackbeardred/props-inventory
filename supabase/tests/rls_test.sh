#!/usr/bin/env bash
# Row-level-security tests for the multi-organization model.
#
# Loads schema.sql into a throwaway local Postgres, then queries it as the
# `authenticated` role with RLS genuinely enforced — the same way Supabase
# runs it. Stubs only what Supabase itself provides: auth.uid() (reads a GUC
# instead of a JWT), auth.users, storage.buckets/objects and
# storage.foldername(). Every policy and function under test is the real one.
#
# Usage:  ./rls_test.sh [port]      (needs postgres installed locally)
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=rlstest
PASS=0; FAIL=0

if ! pg_isready -h /tmp -p "$PORT" >/dev/null 2>&1; then
  mkdir -p "$PGDATA" && chown -R postgres:postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PORT' -l /tmp/pg.log start" >/dev/null 2>&1
  sleep 3
fi

psql -h /tmp -p "$PORT" -U postgres -qc "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1

# ── Stubs for the pieces Supabase provides ────────────────────────────────
psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$fn$;
SQL

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../schema.sql" 2>&1 | grep -i error && { echo "schema.sql failed to load"; exit 1; }

ALICE=11111111-1111-1111-1111-111111111111
BOB=22222222-2222-2222-2222-222222222222
ORGA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
ORGB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
  then create role authenticated nologin; end if; end \$\$;
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema storage to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;

insert into auth.users (id) values ('$ALICE'), ('$BOB');
insert into organizations (id, name, invite_code) values
  ('$ORGA','Alpha Theatre','ALPHA123'), ('$ORGB','Beta Playhouse','BETA4567');
insert into profiles (id, full_name, active_org_id) values
  ('$ALICE','Alice','$ORGA'), ('$BOB','Bob','$ORGB');
insert into memberships (user_id, org_id, role) values
  ('$ALICE','$ORGA','owner'), ('$BOB','$ORGB','owner');
insert into items (org_id, name) values
  ('$ORGA','Yorick skull'), ('$ORGA','Brass candlestick'), ('$ORGB','Beta bear head');
insert into storage.objects (bucket_id, name) values
  ('avatars','$ALICE/alice.png'), ('avatars','$BOB/bob.png');
SQL

as_user()      { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tail -1; }
as_user_full() { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1; }
root()         { psql -h /tmp -p "$PORT" -U postgres -d $DB -qtAc "$1" >/dev/null 2>&1; }
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1 — expected '$2', got '$3'"; FAIL=$((FAIL+1)); fi; }

echo "── Each theatre sees its own inventory"
check "Alice sees Alpha's 2 items" "2" "$(as_user $ALICE 'select count(*) from items;')"
check "Bob sees Beta's 1 item"     "1" "$(as_user $BOB   'select count(*) from items;')"

echo "── Cross-organization isolation"
check "Bob cannot see Alpha's item"         "0" "$(as_user $BOB "select count(*) from items where name='Yorick skull';")"
check "Bob cannot see the Alpha org row"    "0" "$(as_user $BOB "select count(*) from organizations where id='$ORGA';")"
check "Bob cannot see Alice's profile"      "0" "$(as_user $BOB "select count(*) from profiles where id='$ALICE';")"
check "Bob cannot see Alpha memberships"    "0" "$(as_user $BOB "select count(*) from memberships where org_id='$ORGA';")"
check "Bob cannot insert into Alpha"        "1" "$(as_user_full $BOB "insert into items (org_id,name) values ('$ORGA','smuggled');" | grep -c 'violates row-level security')"
check "Bob cannot grant himself membership" "1" "$(as_user_full $BOB "insert into memberships (user_id,org_id,role) values ('$BOB','$ORGA','owner');" | grep -c 'violates row-level security')"

echo "── A forged active_org_id grants nothing"
as_user $ALICE "update profiles set active_org_id='$ORGB' where id='$ALICE';" >/dev/null
check "Pointed at Beta without membership: 0 items" "0" "$(as_user $ALICE 'select count(*) from items;')"
check "auth_org_id() resolves to null"              ""  "$(as_user $ALICE 'select auth_org_id();')"
as_user $ALICE "update profiles set active_org_id='$ORGA' where id='$ALICE';" >/dev/null

echo "── Belonging to two, and switching"
root "insert into memberships (user_id, org_id, role) values ('$ALICE','$ORGB','member');"
check "Still scoped to Alpha until she switches" "2" "$(as_user $ALICE 'select count(*) from items;')"
as_user $ALICE "select switch_organization('$ORGB');" >/dev/null
check "After switching she sees Beta's 1 item"   "1" "$(as_user $ALICE 'select count(*) from items;')"
check "Alpha's inventory now hidden from her"    "0" "$(as_user $ALICE "select count(*) from items where name='Yorick skull';")"
check "Both orgs listed on her account"          "2" "$(as_user $ALICE 'select count(*) from organizations;')"

echo "── Revoked membership cuts access on the next query"
root "delete from memberships where user_id='$ALICE' and org_id='$ORGB';"
check "Still pointed at Beta, sees nothing" "0" "$(as_user $ALICE 'select count(*) from items;')"

echo "── Last-owner guard"
as_user $ALICE "update profiles set active_org_id='$ORGA' where id='$ALICE';" >/dev/null
check "Sole owner refused permission to leave" "1" "$(as_user_full $ALICE "select leave_organization('$ORGA');" | grep -c 'only owner')"

echo "── Avatar privacy"
check "Bob cannot read Alice's avatar"     "0" "$(as_user $BOB "select count(*) from storage.objects where name like '$ALICE/%';")"
check "Alice can read her own"             "1" "$(as_user $ALICE "select count(*) from storage.objects where name like '$ALICE/%';")"
root "insert into memberships (user_id, org_id, role) values ('$BOB','$ORGA','member');"
check "Sharing Alpha, Bob can read it"     "1" "$(as_user $BOB "select count(*) from storage.objects where name like '$ALICE/%';")"
root "delete from memberships where user_id='$BOB' and org_id='$ORGA';"
check "Removed again, he loses it at once" "0" "$(as_user $BOB "select count(*) from storage.objects where name like '$ALICE/%';")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
