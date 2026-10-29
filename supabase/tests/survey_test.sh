#!/usr/bin/env bash
# Tests migration 017 against a real Postgres: nobody using the app can read
# or write survey_responses directly; anyone can submit through
# submit_survey; bad emails, unknown surveys and oversized answers are
# refused; one connection gets 5 submissions an hour; 500 a day in all; and
# network-address hashes are cleared after an hour.
#
# Usage:  ./survey_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=surveytest
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
FRESH="$(q "select md5(prosrc) from pg_proc where proname = 'submit_survey'")"

echo ""
echo "── Migration 017"
check "applies cleanly" "" "$(run "$HERE/../migrations/017_survey_responses.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/017_survey_responses.sql")"
check "leaves the function a fresh install has" "$FRESH" "$(q "select md5(prosrc) from pg_proc where proname = 'submit_survey'")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth, storage to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated, anon;
grant execute on all functions in schema public, auth, storage to authenticated, anon;
SQL
# As in Supabase: the migration's revokes run after the platform's broad grants.
run "$HERE/../migrations/017_survey_responses.sql" >/dev/null

as_anon() { # sql, with request headers as PostgREST sets them
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role anon; select set_config('request.headers', '${2:-{\}}', false); $1" 2>&1 \
    | grep -v -e '^SET$' -e '^CONTEXT:' -e '^PL/pgSQL' | sed 's/^ERROR:  //' | sed '1{/^{.*}$/d}' | sed '/^$/d'
}
IP1='{"x-forwarded-for": "203.0.113.7, 10.0.0.1"}'
IP2='{"cf-connecting-ip": "198.51.100.4"}'
ANS="'{\"role\": \"stage-manager\", \"frustration\": \"Nobody knows where the swords are.\"}'::jsonb"

echo ""
echo "── Who can do what"
check "anon can't read the table" "permission denied for table survey_responses" "$(as_anon "select count(*) from survey_responses")"
check "anon can't insert directly" "permission denied for table survey_responses" "$(as_anon "insert into survey_responses (survey, answers) values ('x', '{}')")"
check "a signed-in user can't read it either" "permission denied for table survey_responses" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role authenticated; select count(*) from survey_responses" 2>&1 | grep -v '^SET$' | sed 's/^ERROR:  //')"
check "anon can submit" "" "$(as_anon "select submit_survey('storage-2026', $ANS, null)" "$IP1")"
check "  and it's saved" "1|stage-manager" "$(q "select count(*) || '|' || min(answers->>'role') from survey_responses")"
check "  with a scrambled address, not the address" "t|f" \
  "$(q "select client_hash is not null from survey_responses limit 1")|$(q "select client_hash like '%203.0.113.7%' from survey_responses limit 1")"
check "an email is kept, lowercased" "" "$(as_anon "select submit_survey('storage-2026', $ANS, '  Pat@Example.COM ')" "$IP2")"
check "  as pat@example.com" "pat@example.com" "$(q "select email from survey_responses where email is not null")"

echo ""
echo "── What's refused"
check "a bad email" "That email address doesn't look right. Check it, or leave it empty." "$(as_anon "select submit_survey('storage-2026', $ANS, 'pat at example')" "$IP2")"
check "an unknown survey name" "That survey doesn't exist" "$(as_anon "select submit_survey('Robert''); drop table x;--', $ANS, null)" "$IP2")"
check "answers that aren't an object" "The answers didn't come through. Please try again." "$(as_anon "select submit_survey('storage-2026', '[1,2]'::jsonb, null)" "$IP2")"
check "answers over 20,000 characters" "Those answers are too long to save. Please shorten the written ones." \
  "$(as_anon "select submit_survey('storage-2026', jsonb_build_object('frustration', repeat('a', 20001)), null)" "$IP2")"
check "  none of those were saved" "2" "$(q "select count(*) from survey_responses")"

echo ""
echo "── Limits"
for i in 1 2 3 4; do as_anon "select submit_survey('storage-2026', $ANS, null)" "$IP1" >/dev/null; done
check "a connection's sixth in an hour is refused" "You've sent several answers in the last hour. Thank you! Please try again later." \
  "$(as_anon "select submit_survey('storage-2026', $ANS, null)" "$IP1")"
check "  another connection still gets in" "" "$(as_anon "select submit_survey('storage-2026', $ANS, null)" "$IP2")"
check "  so does one with no address header" "" "$(as_anon "select submit_survey('storage-2026', $ANS, null)")"
q "update survey_responses set created_at = now() - interval '2 hours'" >/dev/null
check "an hour later the first connection is welcome again" "" "$(as_anon "select submit_survey('storage-2026', $ANS, null)" "$IP1")"
check "  and old addresses have been forgotten" "0" "$(q "select count(*) from survey_responses where client_hash is not null and created_at < now() - interval '1 hour'")"
q "insert into survey_responses (survey, answers) select 'storage-2026', '{}' from generate_series(1, 500)" >/dev/null
check "after 500 in a day, everyone waits" "The survey has had too many answers today. Please try again tomorrow." \
  "$(as_anon "select submit_survey('storage-2026', $ANS, null)" "$IP2")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
