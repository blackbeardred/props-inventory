#!/usr/bin/env bash
# Tests migration 013 against a real Postgres: tryout links make a seeded test
# theatre each; only the SQL editor can make or rename them; a link's label can
# be read by anyone holding the token, and joining makes the caller an owner of
# that theatre and nothing else; switched-off links stop working; RLS keeps
# each test theatre apart; and deleting them takes everything with them.
#
# Usage:  ./tryout_links_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=tryouttest
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

echo "── A fresh install from schema.sql"
check "schema.sql applies cleanly" "" "$(run "$HERE/../schema.sql")"
FRESH_SRC="$(q "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('create_tryout','join_tryout','rename_tryout','tryout_label')")"

echo ""
echo "── Migration 013"
check "applies cleanly" "" "$(run "$HERE/../migrations/013_tryout_links.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/013_tryout_links.sql")"
check "leaves the same functions a fresh install has" "$FRESH_SRC" \
  "$(q "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('create_tryout','join_tryout','rename_tryout','tryout_label')")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth, storage to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- As Supabase does: new functions are executable by anon and authenticated
-- unless taken back, so re-run the migration's revokes after this grant.
grant execute on all functions in schema public, auth, storage to authenticated, anon;
SQL
run "$HERE/../migrations/013_tryout_links.sql" >/dev/null
q "revoke all on tryout_links from anon, authenticated" >/dev/null
# 014 replaces the sample theatre 013 seeds (sample_photos_test.sh covers it).
run "$HERE/../migrations/014_sample_photos.sql" >/dev/null
run "$HERE/../migrations/015_sample_places.sql" >/dev/null

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
insert into auth.users (id, is_anonymous) values
  ('11111111-1111-1111-1111-111111111111', false),   -- Alice, a real theatre's owner
  ('22222222-2222-2222-2222-222222222222', true),    -- a tester, no account
  ('33333333-3333-3333-3333-333333333333', true);    -- another tester
insert into organizations (id, name, invite_code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha Theatre', 'ALPHA1');
insert into profiles (id, full_name, active_org_id) values
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into memberships (user_id, org_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner');
insert into items (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha''s own lamp');
SQL

as_user() { # uid sql
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | grep -v -e '^SET$' -e '^CONTEXT:' | sed 's/^ERROR:  //'
}
as_anon() { # sql
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role anon; $1" 2>&1 | grep -v -e '^SET$' -e '^CONTEXT:' | sed 's/^ERROR:  //'
}
ALICE=11111111-1111-1111-1111-111111111111
T1=22222222-2222-2222-2222-222222222222
T2=33333333-3333-3333-3333-333333333333

echo ""
echo "── Making links (SQL editor)"
q "select create_tryout('Tester ' || n) from generate_series(1, 3) n" >/dev/null
check "three links, three test theatres" "3|3" \
  "$(q "select count(*) || '|' || count(distinct org_id) from tryout_links")"
check "  each named for its person" "Tester 1's test theatre" \
  "$(q "select o.name from tryout_links l join organizations o on o.id = l.org_id where l.label = 'Tester 1'")"
check "  tokens are 32 hex characters" "3" "$(q "select count(*) from tryout_links where token ~ '^[0-9a-f]{32}$'")"
check "  each has its own invite code" "3" "$(q "select count(distinct o.invite_code) from tryout_links l join organizations o on o.id = l.org_id")"
TOK1="$(q "select token from tryout_links where label = 'Tester 1'")"
TOK2="$(q "select token from tryout_links where label = 'Tester 2'")"
TOK3="$(q "select token from tryout_links where label = 'Tester 3'")"
ORG1="$(q "select org_id from tryout_links where label = 'Tester 1'")"
check "a test theatre is seeded: 8 places" "8" "$(q "select count(*) from locations where org_id = '$ORG1'")"
check "  24 items" "24" "$(q "select count(*) from items where org_id = '$ORG1'")"
check "  every item's place is in the same theatre" "0" \
  "$(q "select count(*) from items i join locations l on l.id = i.location_id where i.org_id = '$ORG1' and l.org_id <> i.org_id")"
check "  two productions, each with a pull list" "2|2" \
  "$(q "select (select count(*) from productions where org_id = '$ORG1') || '|' || (select count(*) from pull_lists pl join productions p on p.id = pl.production_id where p.org_id = '$ORG1')")"
check "  seven pull-list lines" "7" \
  "$(q "select count(*) from pull_list_items pli join pull_lists pl on pl.id = pli.pull_list_id join productions p on p.id = pl.production_id where p.org_id = '$ORG1'")"
check "  a search for rust finds the curtains" "Curtains, paisley (pair)" \
  "$(q "select name from items where org_id = '$ORG1' and to_tsvector('english', items_search_document(name, description, auto_tags, import_data)) @@ plainto_tsquery('english', 'rust')")"
check "a blank name is refused" "A tryout link needs a name" "$(q "select create_tryout('  ')" | grep -v '^CONTEXT:' | sed 's/^ERROR:  //')"
check "a signed-in user can't make links" "permission denied for function create_tryout" \
  "$(as_user $ALICE "select create_tryout('Sneaky')")"
check "nor can anon" "permission denied for function create_tryout" "$(as_anon "select create_tryout('Sneaky')")"
check "nor seed a theatre" "permission denied for function seed_sample_theatre" \
  "$(as_user $ALICE "select seed_sample_theatre('aaaaaaaa-0000-0000-0000-000000000001')")"
check "the links table can't be read directly" "permission denied for table tryout_links" \
  "$(as_user $ALICE "select token from tryout_links limit 1")"
check "  not even by anon" "permission denied for table tryout_links" "$(as_anon "select token from tryout_links limit 1")"

echo ""
echo "── Reading a link's name"
check "anon can read the name on a link" "Tester 1" "$(as_anon "select tryout_label('$TOK1')")"
check "a wrong token reads nothing" "" "$(as_anon "select tryout_label('nope')")"

echo ""
echo "── Joining"
check "a tester joins their link's theatre" "$ORG1" "$(as_user $T1 "select join_tryout('$TOK1')")"
check "  as its owner" "owner" "$(q "select role from memberships where user_id = '$T1' and org_id = '$ORG1'")"
check "  with that theatre open" "$ORG1" "$(q "select active_org_id from profiles where id = '$T1'")"
check "  named for the link" "Tester 1" "$(q "select full_name from profiles where id = '$T1'")"
check "  and sees its 24 items" "24" "$(as_user $T1 "select count(*) from items")"
check "  and none of Alpha's" "0" "$(as_user $T1 "select count(*) from items where name = 'Alpha''s own lamp'")"
check "opening the link again is harmless" "1" \
  "$(as_user $T1 "select join_tryout('$TOK1')" >/dev/null; q "select count(*) from memberships where user_id = '$T1'")"
check "anon can't join without signing in" "permission denied for function join_tryout" "$(as_anon "select join_tryout('$TOK1')")"
check "a wrong token is refused" "That test link isn't working any more" "$(as_user $T2 "select join_tryout('nope')")"
check "  and joins nothing" "0" "$(q "select count(*) from memberships where user_id = '$T2'")"
as_user $T2 "select join_tryout('$TOK2')" >/dev/null
check "a second tester's copy is separate" "24|0" \
  "$(as_user $T2 "select count(*) from items")|$(as_user $T2 "select count(*) from items where org_id = '$ORG1'")"
check "  changes in one don't reach the other" "24" \
  "$(as_user $T2 "delete from items where name = 'Serving platter, black'" >/dev/null; as_user $T1 "select count(*) from items")"
check "a real account can open a link too, and keeps its name" "Alice|owner" \
  "$(as_user $ALICE "select join_tryout('$TOK3')" >/dev/null; q "select p.full_name || '|' || m.role from profiles p join memberships m on m.user_id = p.id join tryout_links l on l.org_id = m.org_id where p.id = '$ALICE' and l.label = 'Tester 3'")"
check "  and still belongs to Alpha" "1" "$(q "select count(*) from memberships where user_id = '$ALICE' and org_id = 'aaaaaaaa-0000-0000-0000-000000000001'")"

echo ""
echo "── Renaming and switching off"
check "a link is renamed in the SQL editor" "Gregg" "$(q "select rename_tryout('$TOK1', ' Gregg ')")"
check "  its theatre follows" "Gregg's test theatre" "$(q "select name from organizations where id = '$ORG1'")"
check "  and so does the tester who opened it" "Gregg" "$(q "select full_name from profiles where id = '$T1'")"
check "  but a real account keeps its own name" "Alice" \
  "$(q "select rename_tryout('$TOK3', 'Patty')" >/dev/null; q "select full_name from profiles where id = '$ALICE'")"
check "a signed-in user can't rename links" "permission denied for function rename_tryout" \
  "$(as_user $T1 "select rename_tryout('$TOK1', 'Me')")"
q "update tryout_links set disabled_at = now() where token = '$TOK2'" >/dev/null
check "a switched-off link reads nothing" "" "$(as_anon "select tryout_label('$TOK2')")"
check "  and can't be joined" "That test link isn't working any more" "$(as_user $T1 "select join_tryout('$TOK2')")"

echo ""
echo "── Clearing up"
q "delete from organizations where id in (select org_id from tryout_links)" >/dev/null
check "deleting the test theatres removes their links" "0" "$(q "select count(*) from tryout_links")"
check "  their items" "1" "$(q "select count(*) from items")"
check "  and the testers' memberships, leaving Alpha alone" "1" "$(q "select count(*) from memberships")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
