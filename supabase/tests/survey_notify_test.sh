#!/usr/bin/env bash
# Tests migration 020 (a phone notification per survey response) against a
# real Postgres. pg_net isn't installed here, so a stand-in net.http_post
# records what would be sent. A response is always saved, whatever happens
# to the notification; only the role, theater and count are sent (never
# the email or any other answer); the channel name can't be
# read by app users; the migration runs twice and matches schema.sql.
#
# Usage:  ./survey_notify_test.sh [port]
#
# Note: run() looks for "ERROR" anywhere on a line. psql prints a file's
# errors as "psql:file:line: ERROR: …", so a check for lines *starting* with
# ERROR would pass whatever happened.
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=notifytest
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
FN="select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('notify_new_survey_response', 'survey_notify_text')"
FRESH="$(q "$FN")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
-- A stand-in for pg_net: records each request instead of sending it.
create schema if not exists net;
create table net.sent (url text, body jsonb, headers jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $f$
begin
  if current_setting('test.fail_send', true) = 'yes' then raise exception 'network down'; end if;
  insert into net.sent (url, body, headers) values (url, body, headers);
  return 1;
end $f$;
grant usage on schema net to anon, authenticated;
grant insert on net.sent to anon, authenticated;
grant execute on function net.http_post(text, jsonb, jsonb, jsonb, int) to anon, authenticated;
SQL

echo ""
echo "── Migration 020 on top"
check "applies cleanly" "" "$(run "$HERE/../migrations/020_survey_notifications.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/020_survey_notifications.sql")"
check "the functions match a fresh install" "$FRESH" "$(q "$FN")"
check "one trigger, not two" "1" "$(q "select count(*) from pg_trigger where tgname = 'survey_response_notify'")"

submit() { # survey
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role anon; select submit_survey('$1', '{\"role\": \"stage-manager\"}'::jsonb, 'someone@example.com')" 2>&1 | grep -v -e '^SET$' -e '^$' | head -1
}
sent() { q "select count(*) from net.sent"; }
saved() { q "select count(*) from survey_responses"; }

echo ""
echo "── Before a channel is set"
check "a response is saved" "|1" "$(submit storage-2026)|$(saved)"
check "and nothing is sent" "0" "$(sent)"
q "insert into notify_settings (key, value) values ('ntfy_topic', 'not a channel!')" >/dev/null
check "a value that isn't a channel name sends nothing" "|0" "$(submit storage-2026)|$(sent)"

echo ""
echo "── With the channel set"
q "insert into notify_settings (key, value) values ('ntfy_topic', 'propolis-testchannel0123456789') on conflict (key) do update set value = excluded.value" >/dev/null
check "a response sends one notification" "|1" "$(submit storage-2026)|$(sent)"
check "to ntfy" "https://ntfy.sh/" "$(q "select url from net.sent order by at desc limit 1")"
check "on the channel, with the role and the count, as JSON" \
  "propolis-testchannel0123456789|New survey response|Stage manager
3 responses so far|application/json" \
  "$(q "select body->>'topic' || '|' || (body->>'title') || '|' || (body->>'message') || '|' || (headers->>'Content-Type') from net.sent order by at desc limit 1")"
check "and not the email" "f" \
  "$(q "select body::text ~* 'someone@example' from net.sent order by at desc limit 1")"
check "another survey counts on its own: its first response" "Stage manager
1 response so far" \
  "$(submit testers-2027 >/dev/null; q "select body->>'message' from net.sent order by at desc limit 1")"

# submit_json survey answers-json: the JSON goes into SQL as a literal, so
# double any single quote in it.
submit_json() {
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role anon; select submit_survey('$1', '$2'::jsonb, 'board@example.com')" 2>&1 | grep -v -e '^SET$' -e '^$' | head -1
}
last() { q "select body->>'message' from net.sent order by at desc limit 1"; }

echo ""
echo "── Who answered"
check "role 'other' uses their own words, then the theater" "|Board president/executive director, Santa Cruz Actors' Theatre
2 responses so far" \
  "$(submit_json testers-2027 '{"role": "other", "role_other": "Board president/executive director", "theater_name": "Santa Cruz Actors'"''"' Theatre", "anything_else": "secret back room", "problems": ["cant-find"]}')|$(last)"
check "no other answer and no email in what's sent" "f" \
  "$(q "select body::text ~* 'secret back room|cant-find|board@example' from net.sent order by at desc limit 1")"
check "a theater with no role" "|Pacific Repertory Theatre
3 responses so far" \
  "$(submit_json testers-2027 '{"theater_name": "  Pacific Repertory Theatre "}')|$(last)"
check "neither role nor theater: just the count" "|4 responses so far" \
  "$(submit_json testers-2027 '{"items": "under-200"}')|$(last)"
check "'other' left blank says Other" "|Other
5 responses so far" \
  "$(submit_json testers-2027 '{"role": "other", "role_other": "   "}')|$(last)"
check "line breaks and tabs become one space" "|Director, The Old Barn Players
6 responses so far" \
  "$(submit_json testers-2027 '{"role": "director", "theater_name": "The Old\n\tBarn   Players"}')|$(last)"
check "long typed text is cut to 60 characters" "60|…" \
  "$(submit_json testers-2027 '{"theater_name": "ABCDEFGHIJ ABCDEFGHIJ ABCDEFGHIJ ABCDEFGHIJ ABCDEFGHIJ ABCDEFGHIJ ABCDEFGHIJ"}' >/dev/null; q "select length(split_part(body->>'message', E'\n', 1)) || '|' || right(split_part(body->>'message', E'\n', 1), 1) from net.sent order by at desc limit 1")"
check "an unknown role value is left out" "|8 responses so far" \
  "$(submit_json testers-2027 '{"role": "<b>hi</b>"}')|$(last)"

echo ""
echo "── When sending fails"
check "the response is still saved" "|12" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set test.fail_send = 'yes'; set role anon; select submit_survey('storage-2026', '{\"role\": \"director\"}'::jsonb, null)" 2>&1 | grep -v -e '^SET$' -e '^$' -e '^WARNING' | head -1)|$(saved)"
q "drop schema net cascade" >/dev/null
check "without pg_net at all, still saved" "|13" "$(submit storage-2026)|$(saved)"

echo ""
echo "── Who can see the channel"
psql -h /tmp -p "$PORT" -U postgres -d $DB -q -c "grant select, insert, update, delete on all tables in schema public to authenticated" >/dev/null 2>&1
as_user() { psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role $1; $2" 2>&1 | grep -v '^SET$' | head -1 | sed 's/^ERROR:  //'; }
check "a signed-in user, even with table grants, reads nothing (RLS, no policies)" "0" \
  "$(as_user authenticated "select count(*) from notify_settings")"
check "and can't change it" "new row violates row-level security policy for table \"notify_settings\"" \
  "$(as_user authenticated "insert into notify_settings (key, value) values ('ntfy_topic', 'propolis-hijackhijackhijack')")"
check "someone signed out can't read it" "permission denied for table notify_settings" \
  "$(as_user anon "select value from notify_settings")"
check "nobody can call the trigger function directly" "f" \
  "$(q "select has_function_privilege('authenticated', 'notify_new_survey_response()', 'execute')")"
check "or the text helper" "false|false" \
  "$(q "select has_function_privilege('authenticated', 'survey_notify_text(text)', 'execute') || '|' || has_function_privilege('anon', 'survey_notify_text(text)', 'execute')")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
