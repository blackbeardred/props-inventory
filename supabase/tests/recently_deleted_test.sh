#!/usr/bin/env bash
# Migration 007 (Recently Deleted) against a real Postgres: schema.sql loads
# with it, the migration applies to a database that predates it and applies
# twice, and its row-level security keeps each theatre's snapshots to itself.
#
# Usage:  ./recently_deleted_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=deletedtest
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

echo "── schema.sql, with Recently Deleted in it"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../schema.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "schema.sql loads" "" "$out"
check "the table is there" "1" "$(q "select count(*) from information_schema.tables where table_name='deleted_records'")"

echo ""
echo "── Migration 007 on a database that predates it"
q "drop table deleted_records;" >/dev/null
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/007_recently_deleted.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "applies" "" "$out"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/007_recently_deleted.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "applies a second time" "" "$out"
check "row-level security is on" "t" "$(q "select relrowsecurity from pg_class where relname='deleted_records'")"
check "three policies, none for update" "delete,insert,select" \
  "$(q "select string_agg(lower(cmd), ',' order by cmd) from pg_policies where tablename='deleted_records'")"
check "no existing table gained a column" "0" \
  "$(q "select count(*) from information_schema.columns where column_name in ('deleted_at','deleted_by') and table_name <> 'deleted_records'")"

ALICE=11111111-1111-1111-1111-111111111111
AMY=33333333-3333-3333-3333-333333333333
BOB=22222222-2222-2222-2222-222222222222
ORGA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
ORGB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
grant usage on schema public, auth, storage, extensions to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;
insert into auth.users (id) values ('$ALICE'), ('$AMY'), ('$BOB');
insert into organizations (id, name, invite_code) values
  ('$ORGA','Alpha Theatre','ALPHA123'), ('$ORGB','Beta Playhouse','BETA4567');
insert into profiles (id, full_name, active_org_id) values
  ('$ALICE','Alice','$ORGA'), ('$AMY','Amy','$ORGA'), ('$BOB','Bob','$ORGB');
insert into memberships (user_id, org_id, role) values
  ('$ALICE','$ORGA','owner'), ('$AMY','$ORGA','member'), ('$BOB','$ORGB','owner');
insert into deleted_records (id, org_id, kind, label, snapshot, deleted_by) values
  ('dddddddd-0000-0000-0000-00000000000b', '$ORGB', 'item', 'Beta bear head', '{}', '$BOB');
SQL

echo ""
echo "── Who can see and touch a snapshot"
check "a member records a deletion in their own theatre" "INSERT 0 1" \
  "$(as_user $AMY "insert into deleted_records (id, org_id, kind, label, snapshot, deleted_by) values ('dddddddd-0000-0000-0000-00000000000a', '$ORGA', 'item', 'Yorick skull', '{\"item\":{}}', '$AMY');")"
check "…but not under someone else's name" "1" \
  "$(as_user_full $AMY "insert into deleted_records (org_id, kind, label, snapshot, deleted_by) values ('$ORGA', 'item', 'x', '{}', '$ALICE');" | grep -c 'violates row-level security')"
check "…and not into another theatre" "1" \
  "$(as_user_full $AMY "insert into deleted_records (org_id, kind, label, snapshot, deleted_by) values ('$ORGB', 'item', 'x', '{}', '$AMY');" | grep -c 'violates row-level security')"
check "an unknown kind is refused" "1" \
  "$(q "insert into deleted_records (org_id, kind, label, snapshot) values ('$ORGA', 'organization', 'x', '{}');" | grep -c 'violates check constraint')"
check "the theatre's owner sees it" "Yorick skull" "$(as_user $ALICE "select label from deleted_records;")"
check "another theatre doesn't" "Beta bear head" "$(as_user $BOB "select string_agg(label, ',') from deleted_records;")"
check "…and can't clear it" "DELETE 0" "$(as_user $BOB "delete from deleted_records where label='Yorick skull';")"
check "a snapshot can't be edited, even in its own theatre" "UPDATE 0" \
  "$(as_user $AMY "update deleted_records set label='changed';")"
check "a member can clear one (that's how restoring works)" "DELETE 1" \
  "$(as_user $AMY "delete from deleted_records where label='Yorick skull';")"
check "a person deleted from the theatre leaves the snapshot, unnamed" "t" \
  "$(q "insert into deleted_records (org_id, kind, label, snapshot, deleted_by) values ('$ORGA','item','Crown','{}','$AMY'); delete from memberships where user_id='$AMY'; delete from profiles where id='$AMY'; select deleted_by is null from deleted_records where label='Crown';" | tail -1)"
check "a theatre that's removed takes its snapshots with it" "0" \
  "$(q "delete from organizations where id='$ORGB'; select count(*) from deleted_records where org_id='$ORGB';" | tail -1)"

echo ""
echo "── Restoring, the way the app does it: insert ... on conflict (id) do nothing, under RLS"
ITEM=cccccccc-0000-0000-0000-000000000001
PROD=eeeeeeee-0000-0000-0000-000000000001
LIST=ffffffff-0000-0000-0000-000000000001
LINE=99999999-0000-0000-0000-000000000001
psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into organizations (id, name, invite_code) values ('$ORGB','Beta Playhouse','BETA4567');
insert into memberships (user_id, org_id, role) values ('$BOB','$ORGB','owner');
update profiles set active_org_id='$ORGB' where id='$BOB';
insert into items (id, org_id, name) values ('$ITEM', '$ORGA', 'Yorick skull');
insert into productions (id, org_id, name) values ('$PROD', '$ORGA', 'Hamlet');
insert into pull_lists (id, production_id) values ('$LIST', '$PROD');
insert into pull_list_items (id, pull_list_id, item_id, status) values ('$LINE', '$LIST', '$ITEM', 'pulled');
SQL
check "deleting the item takes its line with it (the cascade the snapshot records)" "0" \
  "$(as_user $ALICE "delete from items where id='$ITEM'; select count(*) from pull_list_items where id='$LINE';")"
check "the owner puts the item back with its original id" "INSERT 0 1" \
  "$(as_user $ALICE "insert into items (id, org_id, name) values ('$ITEM', '$ORGA', 'Yorick skull') on conflict (id) do nothing;")"
check "…and its line, status and all" "pulled" \
  "$(as_user $ALICE "insert into pull_list_items (id, pull_list_id, item_id, status) values ('$LINE', '$LIST', '$ITEM', 'pulled') on conflict (id) do nothing; select status from pull_list_items where id='$LINE';")"
check "running the same restore again changes nothing" "INSERT 0 0" \
  "$(as_user $ALICE "insert into items (id, org_id, name) values ('$ITEM', '$ORGA', 'Changed') on conflict (id) do nothing;")"
check "…and leaves the row as it was" "Yorick skull" "$(q "select name from items where id='$ITEM'")"
check "another theatre can't restore a line into this one's list" "1" \
  "$(as_user_full $BOB "insert into pull_list_items (id, pull_list_id, item_id) values (gen_random_uuid(), '$LIST', '$ITEM');" | grep -c 'violates row-level security')"
check "…nor an item into this theatre" "1" \
  "$(as_user_full $BOB "insert into items (id, org_id, name) values (gen_random_uuid(), '$ORGA', 'smuggled');" | grep -c 'violates row-level security')"
check "a fingerprint goes back only once its item is back (the embeddings policy)" "INSERT 0 1" \
  "$(as_user $ALICE "insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values ('$ITEM', '$ORGA', 'a/b.jpg', array_fill(0.0::real, array[512])::extensions.vector) on conflict (item_id) do nothing;")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
