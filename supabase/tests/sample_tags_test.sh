#!/usr/bin/env bash
# Tests migration 016 against a real Postgres: copies made under 015 get
# search tags on every sample item and lose their invite codes; an item a
# tester rewrote keeps its own tags; a real theatre is untouched; running it
# twice changes nothing more; and copies made after it come tagged, with no
# invite code, the same as a fresh install's.
#
# Usage:  ./sample_tags_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=sampletagstest
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

finds() { # org word → how many items a search for that word matches
  q "select count(*) from items where org_id = '$1' and to_tsvector('english', items_search_document(name, description, auto_tags, import_data)) @@ to_tsquery('english', '$2')"
}
FN_SRC="select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('create_tryout','tag_sample_theatre')"

echo "── Copies made under 015"
check "schema.sql applies cleanly" "" "$(run "$HERE/../schema.sql")"
FRESH="$(q "$FN_SRC")"
q "insert into organizations (id, name, invite_code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha Theatre', 'ALPHA1')" >/dev/null
q "insert into items (org_id, name, description) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Anvil', 'Cast iron, black, with a bright working face. Heavy: lift with two people.')" >/dev/null
for m in 013_tryout_links 014_sample_photos 015_sample_places; do run "$HERE/../migrations/$m.sql" >/dev/null; done
q "select create_tryout('Tester ' || n) from generate_series(1, 3) n" >/dev/null
ORG1="$(q "select org_id from tryout_links where label = 'Tester 1'")"
ORG2="$(q "select org_id from tryout_links where label = 'Tester 2'")"
ORG3="$(q "select org_id from tryout_links where label = 'Tester 3'")"
check "they start untagged" "0" "$(q "select count(*) from items where org_id = '$ORG1' and auto_tags <> '{}'")"
check "  so a search for wood finds only the map, which says wood" "1" "$(finds $ORG1 wood)"
check "  and they have invite codes" "3" "$(q "select count(invite_code) from organizations where id in (select org_id from tryout_links)")"
# Tester 2 rewrote the ruff (saving it tagged it); Tester 3's anvil had old AI tags.
q "update items set description = 'Ours is yellowed', auto_tags = '{ruff,yellowed}' where org_id = '$ORG2' and name = 'Ruff collar'" >/dev/null
q "update items set auto_tags = '{prop,stage,anvil}' where org_id = '$ORG3' and name = 'Anvil'" >/dev/null

echo ""
echo "── Migration 016"
check "applies cleanly" "" "$(run "$HERE/../migrations/016_sample_tags.sql")"
SNAPSHOT="$(q "select md5(string_agg(id::text || array_to_string(auto_tags, ','), '|' order by id)) from items")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/016_sample_tags.sql")"
check "  and the second time changes nothing" "$SNAPSHOT" "$(q "select md5(string_agg(id::text || array_to_string(auto_tags, ','), '|' order by id)) from items")"
check "leaves the functions a fresh install has" "$FRESH" "$(q "$FN_SRC")"
check "tag_sample_theatre isn't callable from the app" "f|f" \
  "$(q "select has_function_privilege('authenticated', 'tag_sample_theatre(uuid)', 'execute')")|$(q "select has_function_privilege('anon', 'tag_sample_theatre(uuid)', 'execute')")"
check "create_tryout still isn't either" "f" "$(q "select has_function_privilege('authenticated', 'create_tryout(text)', 'execute')")"

echo ""
echo "── What it did"
check "every sample item in Tester 1's copy is tagged" "24|0" \
  "$(q "select count(*) from items where org_id = '$ORG1'")|$(q "select count(*) from items where org_id = '$ORG1' and auto_tags = '{}'")"
check "search finds all seven wooden things" "7" "$(finds $ORG1 wood)"
check "  the mahogany cane among them" "t" "$(q "select 'wood' = any(auto_tags) from items where org_id = '$ORG1' and name = 'Walking cane, mahogany'")"
check "  gold finds the crowns, cage, violin and more" "t" "$([ "$(finds $ORG1 gold)" -ge 6 ] && echo t || echo f)"
check "  fabric finds the costumes and curtains" "t" "$([ "$(finds $ORG1 fabric)" -ge 6 ] && echo t || echo f)"
check "  elizabethan finds the Shakespeare things" "t" "$([ "$(finds $ORG1 elizabethan)" -ge 4 ] && echo t || echo f)"
check "  the two platters are tagged alike" "1" "$(q "select count(distinct auto_tags) from items where org_id = '$ORG1' and name = 'Serving platter, black'")"
check "Tester 2's rewritten ruff keeps its own tags" "{ruff,yellowed}" "$(q "select auto_tags from items where org_id = '$ORG2' and name = 'Ruff collar'")"
check "  the rest of Tester 2's copy is tagged" "0" "$(q "select count(*) from items where org_id = '$ORG2' and name <> 'Ruff collar' and auto_tags = '{}'")"
check "Tester 3's old anvil tags are replaced" "f|t" \
  "$(q "select 'prop' = any(auto_tags) from items where org_id = '$ORG3' and name = 'Anvil'")|$(q "select 'iron' = any(auto_tags) from items where org_id = '$ORG3' and name = 'Anvil'")"
check "a real theatre's anvil is left alone" "{}" "$(q "select auto_tags from items where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'")"
check "test copies have no invite code now" "0" "$(q "select count(invite_code) from organizations where id in (select org_id from tryout_links)")"
check "  a real theatre keeps its own" "ALPHA1" "$(q "select invite_code from organizations where name = 'Alpha Theatre'")"

echo ""
echo "── Copies made after 016"
q "select create_tryout('Tester 4')" >/dev/null
ORG4="$(q "select org_id from tryout_links where label = 'Tester 4'")"
check "come tagged, item for item as the updated copy" "0|0" \
  "$(q "select count(*) from (select name, auto_tags from items where org_id = '$ORG4' except all select name, auto_tags from items where org_id = '$ORG1') d")|$(q "select count(*) from (select name, auto_tags from items where org_id = '$ORG1' except all select name, auto_tags from items where org_id = '$ORG4') d")"
check "  with no invite code" "" "$(q "select invite_code from organizations where id = '$ORG4'")"
check "  and still a name" "Tester 4's test theatre" "$(q "select name from organizations where id = '$ORG4'")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
