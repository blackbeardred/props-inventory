#!/usr/bin/env bash
# Tests migration 021 (survey results in the app, for one reader) against a
# real Postgres. Only the account named in notify_settings 'survey_reader'
# can read responses; everyone else is refused by the database. The
# notification's tap link uses a custom site address only when it's a plain
# https one. The migration runs twice and matches schema.sql.
#
# Usage:  ./survey_results_test.sh [port]
#
# Note: run() looks for "ERROR" anywhere on a line. psql prints a file's
# errors as "psql:file:line: ERROR: …", so a check for lines *starting* with
# ERROR would pass whatever happened.
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=resultstest
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

# as ROLE USER-ID SQL: one statement as an app user, as PostgREST runs it.
as() {
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role $1; set request.jwt.claim.sub = '$2'; $3" 2>&1 | grep -v -e '^SET$' -e '^$' | head -1 | sed 's/^ERROR:  //'
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
FN="select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('is_survey_reader', 'survey_results', 'notify_new_survey_response')"
FRESH="$(q "$FN")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth to anon, authenticated;
-- A stand-in for pg_net: records each request instead of sending it.
create schema if not exists net;
create table net.sent (url text, body jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $f$
begin
  insert into net.sent (url, body) values (url, body);
  return 1;
end $f$;
grant usage on schema net to anon, authenticated;
grant insert on net.sent to anon, authenticated;
grant execute on function net.http_post(text, jsonb, jsonb, jsonb, int) to anon, authenticated;
SQL

echo ""
echo "── Migration 021 on top"
check "applies cleanly" "" "$(run "$HERE/../migrations/021_survey_results.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/021_survey_results.sql")"
check "the functions match a fresh install" "$FRESH" "$(q "$FN")"
check "the notification trigger is still there, once" "1" "$(q "select count(*) from pg_trigger where tgname = 'survey_response_notify'")"

ARJUN=11111111-1111-1111-1111-111111111111
OTHER=22222222-2222-2222-2222-222222222222
q "insert into auth.users (id) values ('$ARJUN'), ('$OTHER')" >/dev/null
submit() { # survey answers-json
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role anon; select submit_survey('$1', '$2'::jsonb, null)" >/dev/null 2>&1
}
submit storage-2026 '{"role": "director", "theater_name": "First"}'
sleep 0.05
submit storage-2026 '{"role": "props", "theater_name": "Second", "phone": "831-555-0100"}'
sleep 0.05
submit testers-2027 '{"role": "asm"}'

echo ""
echo "── Before a reader is set"
check "nobody is the reader" "f|f" "$(as authenticated $ARJUN "select is_survey_reader()")|$(as authenticated $OTHER "select is_survey_reader()")"
check "and nobody can read the responses" "Only the survey's reader can see its responses." \
  "$(as authenticated $ARJUN "select count(*) from survey_results()")"

q "insert into notify_settings (key, value) values ('survey_reader', '$ARJUN') on conflict (key) do update set value = excluded.value" >/dev/null

echo ""
echo "── With Arjun as the reader"
check "he's the reader" "t" "$(as authenticated $ARJUN "select is_survey_reader()")"
check "he reads every response" "3" "$(as authenticated $ARJUN "select count(*) from survey_results()")"
check "newest first" "testers-2027,storage-2026,storage-2026" \
  "$(as authenticated $ARJUN "select string_agg(survey, ',') from (select survey from survey_results()) r")"
check "one survey on its own" "Second,First" \
  "$(as authenticated $ARJUN "select string_agg(answers->>'theater_name', ',') from (select answers from survey_results('storage-2026')) r")"
check "answers come back whole, phone number included" "831-555-0100" \
  "$(as authenticated $ARJUN "select answers->>'phone' from survey_results('storage-2026') limit 1")"

echo ""
echo "── Everyone else"
check "another signed-in account isn't the reader" "f" "$(as authenticated $OTHER "select is_survey_reader()")"
check "and is refused" "Only the survey's reader can see its responses." \
  "$(as authenticated $OTHER "select count(*) from survey_results()")"
check "signed out: can't call it at all" "permission denied for function survey_results" \
  "$(as anon "" "select count(*) from survey_results()")"
check "signed out: can't ask who the reader is either" "permission denied for function is_survey_reader" \
  "$(as anon "" "select is_survey_reader()")"
check "no session at all, as authenticated: refused" "Only the survey's reader can see its responses." \
  "$(as authenticated "" "select count(*) from survey_results()")"
check "an app user can't make themselves the reader" "new row violates row-level security policy for table \"notify_settings\"" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -c "grant select, insert, update on notify_settings to authenticated" >/dev/null 2>&1; as authenticated $OTHER "insert into notify_settings (key, value) values ('survey_reader2', '$OTHER')")"
check "or change who it is" "0" \
  "$(as authenticated $OTHER "with u as (update notify_settings set value = '$OTHER' where key = 'survey_reader' returning 1) select count(*) from u")"
check "the reader is still Arjun" "$ARJUN" "$(q "select value from notify_settings where key = 'survey_reader'")"

echo ""
echo "── The notification's tap link"
q "insert into notify_settings (key, value) values ('ntfy_topic', 'propolis-testchannel0123456789') on conflict (key) do update set value = excluded.value" >/dev/null
link() { submit storage-2026 '{"role": "director"}'; q "select body->>'click' from net.sent order by at desc limit 1"; }
newest() { q "select id from survey_responses order by created_at desc limit 1"; }
L="$(link)"; check "opens the newest response on the live site" "https://props-inventory-xi.vercel.app/survey-results#r-$(newest)" "$L"
q "insert into notify_settings (key, value) values ('site_url', 'https://propolis.app') on conflict (key) do update set value = excluded.value" >/dev/null
L="$(link)"; check "a custom domain, once set, is used" "https://propolis.app/survey-results#r-$(newest)" "$L"
q "update notify_settings set value = 'javascript:alert(1)//' where key = 'site_url'" >/dev/null
L="$(link)"; check "anything but a plain https address falls back to the live site" "https://props-inventory-xi.vercel.app/survey-results#r-$(newest)" "$L"
q "update notify_settings set value = 'https://evil.example/phish?x=' where key = 'site_url'" >/dev/null
L="$(link)"; check "an address with a path or query falls back too" "https://props-inventory-xi.vercel.app/survey-results#r-$(newest)" "$L"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
