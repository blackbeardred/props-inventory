#!/usr/bin/env bash
# Tests migration 018 (school theatres) against a real Postgres. A school has
# exactly one account however a second one tries to arrive: invite code,
# tryout link, handover, a direct insert as a user, or an insert as an admin.
# Switching needs exactly one member. A handover link swaps the teacher in one
# step and works once. The migration runs twice and matches schema.sql.
#
# Usage:  ./school_test.sh [port]
#
# Note: run() looks for "ERROR" anywhere on a line. psql prints a file's
# errors as "psql:file:line: ERROR: …", so a check for lines *starting* with
# ERROR would pass whatever happened.
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=schooltest
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
FRESH="$(q "select string_agg(proname || md5(prosrc), ',' order by proname) from pg_proc where proname in ('enforce_school_single_member','enforce_school_mode_switch','set_school_mode','create_school_handover','cancel_school_handover','school_handover_info','accept_school_handover','create_school_handover_for','create_organization_and_profile','regenerate_invite_code','join_organization_with_code','leave_organization')")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- What Supabase does by default: every new function is executable by
-- anon and authenticated, unless the migration takes it back.
grant execute on all functions in schema public, auth, storage to authenticated;
SQL

echo ""
echo "── Migration 018 on top"
check "applies cleanly" "" "$(run "$HERE/../migrations/018_school_theatres.sql")"
check "applies a second time (re-runnable)" "" "$(run "$HERE/../migrations/018_school_theatres.sql")"
check "leaves the same functions a fresh install has" "$FRESH" \
  "$(q "select string_agg(proname || md5(prosrc), ',' order by proname) from pg_proc where proname in ('enforce_school_single_member','enforce_school_mode_switch','set_school_mode','create_school_handover','cancel_school_handover','school_handover_info','accept_school_handover','create_school_handover_for','create_organization_and_profile','regenerate_invite_code','join_organization_with_code','leave_organization')")"
check "one create_organization_and_profile, not two" "1" \
  "$(q "select count(*) from pg_proc where proname = 'create_organization_and_profile'")"
check "the column is never null and defaults to not a school" "t" "$(q "select column_default = 'false' and is_nullable = 'NO' from information_schema.columns where table_name = 'organizations' and column_name = 'is_school'")"
check "the handover table has RLS on and no policies" "t|0" \
  "$(q "select relrowsecurity from pg_class where relname = 'school_handovers'")|$(q "select count(*) from pg_policies where tablename = 'school_handovers'")"
check "users can't call the admin-only link maker" "f" \
  "$(q "select has_function_privilege('authenticated', 'create_school_handover_for(uuid)', 'execute')")"

psql -h /tmp -p "$PORT" -U postgres -d $DB -q >/dev/null 2>&1 <<'SQL'
insert into auth.users (id, is_anonymous) values
  ('11111111-1111-1111-1111-111111111111', false),  -- Tess, a drama teacher
  ('22222222-2222-2222-2222-222222222222', false),  -- Sam, a student
  ('33333333-3333-3333-3333-333333333333', false),  -- Nina, the next teacher
  ('44444444-4444-4444-4444-444444444444', false),  -- Owen, owns a normal theatre
  ('55555555-5555-5555-5555-555555555555', true),   -- an anonymous tester
  ('66666666-6666-6666-6666-666666666666', false);  -- Pat, a crew member of Owen's
insert into organizations (id, name, invite_code) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Owen''s Rep', 'OWEN22');
insert into profiles (id, full_name, active_org_id) values
  ('44444444-4444-4444-4444-444444444444', 'Owen', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('66666666-6666-6666-6666-666666666666', 'Pat', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into memberships (user_id, org_id, role) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner'),
  ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-000000000002', 'member');
SQL

as_user() { # uid sql
  psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc \
    "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | grep -v '^SET$' | head -1 | sed 's/^ERROR:  //'
}
TESS=11111111-1111-1111-1111-111111111111
SAM=22222222-2222-2222-2222-222222222222
NINA=33333333-3333-3333-3333-333333333333
OWEN=44444444-4444-4444-4444-444444444444
ANON=55555555-5555-5555-5555-555555555555
PAT=66666666-6666-6666-6666-666666666666
REPS=aaaaaaaa-0000-0000-0000-000000000002
MSG="School theatres have one account, the teacher's."
members_of() { q "select coalesce(string_agg(p.full_name || ':' || m.role, ',' order by p.full_name), '') from memberships m join profiles p on p.id = m.user_id where m.org_id = '$1'"; }

echo ""
echo "── Setting up a school"
SCHOOL="$(as_user $TESS "select create_organization_and_profile('Hillside High Drama', 'Tess', true)")"
check "a teacher creates a school theatre" "t" "$(q "select is_school from organizations where id = '$SCHOOL'")"
check "  with no invite code" "" "$(q "select invite_code from organizations where id = '$SCHOOL'")"
check "  and the teacher as its owner" "Tess:owner" "$(members_of $SCHOOL)"
NORMAL="$(as_user $SAM "select create_organization_and_profile('Sam''s Garage Theatre', 'Sam')")"
check "two named arguments still make a normal theatre (the app as deployed now)" "f|t" \
  "$(q "select is_school from organizations where id = '$NORMAL'")|$(q "select invite_code is not null from organizations where id = '$NORMAL'")"
check "an anonymous tester can't make a school" "Sign up with your own email to set up a school." \
  "$(as_user $ANON "select create_organization_and_profile('Test', 'T', true)")"

echo ""
echo "── Nobody else gets in"
check "no invite code can be made for it" "$MSG" "$(as_user $TESS "select regenerate_invite_code()")"
q "update organizations set invite_code = 'HILL99' where id = '$SCHOOL'" >/dev/null
check "a code set by hand still can't be used to join" "$MSG" \
  "$(as_user $SAM "select join_organization_with_code('hill99', 'Sam')")"
q "update organizations set invite_code = null where id = '$SCHOOL'" >/dev/null
check "a direct insert as a user is refused" "$MSG" \
  "$(as_user $SAM "insert into memberships (user_id, org_id, role) values ('$SAM', '$SCHOOL', 'member')")"
check "  (and into a normal theatre too: there's no insert policy at all)" "new row violates row-level security policy for table \"memberships\"" \
  "$(as_user $SAM "insert into memberships (user_id, org_id, role) values ('$SAM', '$REPS', 'member')")"
check "an insert as an admin is refused by the trigger" "$MSG" \
  "$(q "insert into memberships (user_id, org_id, role) values ('$SAM', '$SCHOOL', 'member')" | sed 's/^ERROR:  //' | head -1)"
check "moving someone's membership into the school is refused" "$MSG" \
  "$(q "update memberships set org_id = '$SCHOOL' where user_id = '$SAM' and org_id = '$NORMAL'" | sed 's/^ERROR:  //' | head -1)"
q "insert into tryout_links (token, org_id, label) values ('schooltok', '$SCHOOL', 'Sneaky')" >/dev/null
check "a tryout link pointing at the school can't add anyone" "$MSG" \
  "$(as_user $SAM "select join_tryout('schooltok')")"
q "delete from tryout_links where token = 'schooltok'" >/dev/null
check "still just the teacher" "Tess:owner" "$(members_of $SCHOOL)"
check "the teacher re-joining their own school is harmless (no second row)" "1" \
  "$(q "insert into memberships (user_id, org_id, role) values ('$TESS', '$SCHOOL', 'owner') on conflict do nothing" >/dev/null; q "select count(*) from memberships where org_id = '$SCHOOL'")"

echo ""
echo "── Leaving and roles"
check "the teacher can't leave and strand it" "You're the teacher for this school theatre. Hand it over to the new teacher first, from the Theatre page." \
  "$(as_user $TESS "select leave_organization('$SCHOOL')")"
check "  or demote themselves" "An organization must keep at least one owner" \
  "$(as_user $TESS "select set_member_role('$TESS', 'member')")"

echo ""
echo "── Switching an existing theatre"
check "a member (not owner) can't switch" "Only an owner can change this setting." \
  "$(as_user $PAT "select set_school_mode(true)")"
check "with two people in it, the owner is told who to remove" \
  "Remove everyone else first: Pat. A school theatre has one account, the teacher's." \
  "$(as_user $OWEN "select set_school_mode(true)")"
check "  and nothing changed" "false|OWEN22" "$(q "select is_school || '|' || invite_code from organizations where id = '$REPS'")"
check "a direct update can't sneak past either" "$MSG" \
  "$(q "update organizations set is_school = true where id = '$REPS'" | sed 's/^ERROR:  //' | head -1)"
as_user $OWEN "select remove_member('$PAT')" >/dev/null
check "once alone, the owner can switch" "" "$(as_user $OWEN "select set_school_mode(true)")"
check "  the invite code is gone at once" "true|" "$(q "select is_school || '|' || coalesce(invite_code, '') from organizations where id = '$REPS'")"
check "  so the old code no longer works" "Invite code not found" \
  "$(as_user $PAT "select join_organization_with_code('OWEN22', 'Pat')")"
check "switching back works" "false|" \
  "$(as_user $OWEN "select set_school_mode(false)" >/dev/null; q "select is_school || '|' || coalesce(invite_code, '') from organizations where id = '$REPS'")"
check "  the owner makes a new code when they want one" "8" "$(as_user $OWEN "select char_length(regenerate_invite_code())")"
CODE="$(q "select invite_code from organizations where id = '$REPS'")"
check "  and people can join again" "Owen:owner,Pat:member" \
  "$(as_user $PAT "select join_organization_with_code('$CODE', 'Pat')" >/dev/null; members_of $REPS)"
# Tess also helps out at Owen's theatre, which matters when she hands over.
as_user $TESS "select join_organization_with_code('$CODE', 'Tess')" >/dev/null
as_user $TESS "select switch_organization('$SCHOOL')" >/dev/null
q "insert into tryout_links (token, org_id, label) values ('tok2', '$NORMAL', 'Sam')" >/dev/null
check "a test copy can't be made a school" "A test copy can't be made a school." \
  "$(as_user $SAM "select switch_organization('$NORMAL')" >/dev/null; as_user $SAM "select set_school_mode(true)")"

echo ""
echo "── Handing over"
check "a normal theatre can't make a handover link" "Handover links are for school theatres." \
  "$(as_user $OWEN "select create_school_handover()")"
TOK="$(as_user $TESS "select create_school_handover()")"
check "the teacher makes a link" "32" "$(printf %s "$TOK" | wc -c | tr -d ' ')"
check "anyone with it sees the theatre and who's handing it over" "Hillside High Drama|Tess" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role anon; select theatre_name || '|' || from_name from school_handover_info('$TOK')" 2>&1 | grep -v '^SET$')"
check "  it lasts 7 days" "t" "$(q "select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute' from school_handovers where token = '$TOK'")"
check "a wrong token shows nothing" "0" "$(as_user $NINA "select count(*) from school_handover_info('nope')")"
check "users can't read the links table" "permission denied for table school_handovers" \
  "$(as_user $NINA "select token from school_handovers")"
TOK_OLD="$TOK"
TOK="$(as_user $TESS "select create_school_handover()")"
check "making a new link replaces the old one" "1|0" \
  "$(q "select count(*) from school_handovers where org_id = '$SCHOOL'")|$(q "select count(*) from school_handovers where token = '$TOK_OLD'")"
check "an anonymous tester can't accept" "Sign up with your own email first." \
  "$(as_user $ANON "select accept_school_handover('$TOK', 'Tester')")"
check "the teacher can't accept their own link" "You're already the teacher for this theatre." \
  "$(as_user $TESS "select accept_school_handover('$TOK', 'Tess')")"
check "the new teacher accepts" "$SCHOOL" "$(as_user $NINA "select accept_school_handover('$TOK', '  Nina   Park ')")"
check "  and is now the one account, as owner" "Nina Park:owner" "$(members_of $SCHOOL)"
check "  with the school open" "$SCHOOL" "$(q "select active_org_id from profiles where id = '$NINA'")"
check "  the old teacher is out, and lands on their other theatre" "$REPS" \
  "$(q "select active_org_id from profiles where id = '$TESS'")"
check "  and can no longer see the school" "0" "$(as_user $TESS "select count(*) from organizations where id = '$SCHOOL'")"
check "  the link is used up" "This handover link isn't working. Ask the teacher for a new one." \
  "$(as_user $SAM "select accept_school_handover('$TOK', 'Sam')")"
check "  and shows nothing any more" "0" "$(as_user $SAM "select count(*) from school_handover_info('$TOK')")"
TOK="$(as_user $NINA "select create_school_handover()")"
check "the teacher can cancel a link" "0" \
  "$(as_user $NINA "select cancel_school_handover()" >/dev/null; q "select count(*) from school_handovers where org_id = '$SCHOOL'")"
TOK="$(as_user $NINA "select create_school_handover()")"
q "update school_handovers set expires_at = now() - interval '1 minute' where token = '$TOK'" >/dev/null
check "an expired link is refused" "This handover link isn't working. Ask the teacher for a new one." \
  "$(as_user $SAM "select accept_school_handover('$TOK', 'Sam')")"
TOK="$(as_user $NINA "select create_school_handover()")"
check "switching back to normal cancels a pending link" "0" \
  "$(as_user $NINA "select set_school_mode(false)" >/dev/null; q "select count(*) from school_handovers where org_id = '$SCHOOL'")"
as_user $NINA "select set_school_mode(true)" >/dev/null

echo ""
echo "── When the teacher's account is gone"
q "delete from auth.users where id = '$NINA'" >/dev/null
check "deleting the teacher's account leaves the school with no one" "0" "$(q "select count(*) from memberships where org_id = '$SCHOOL'")"
check "  and its inventory is still there to recover" "t" "$(q "select count(*) = 1 from organizations where id = '$SCHOOL'")"
ADMIN_TOK="$(q "select create_school_handover_for('$SCHOOL')")"
check "Arjun makes a link for it from the SQL editor" "32" "$(printf %s "$ADMIN_TOK" | wc -c | tr -d ' ')"
check "  which says who's handing over as nobody" "Hillside High Drama|" \
  "$(as_user $SAM "select theatre_name || '|' || coalesce(from_name, '') from school_handover_info('$ADMIN_TOK')")"
check "  and a new teacher takes the empty school" "$SCHOOL" "$(as_user $SAM "select accept_school_handover('$ADMIN_TOK', 'Mr Sam')")"
check "  as its one account (keeping the name on their account)" "Sam:owner" "$(members_of $SCHOOL)"
check "the admin link maker refuses a normal theatre" "That theatre isn't a school." \
  "$(q "select create_school_handover_for('$REPS')" | sed 's/^ERROR:  //' | head -1)"

echo ""
echo "── Two at once"
TOK="$(as_user $SAM "select create_school_handover()")"
psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "set role authenticated; set request.jwt.claim.sub = '$OWEN'; begin; select accept_school_handover('$TOK', 'Owen'); select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
sleep 0.4
SECOND="$(as_user $PAT "select accept_school_handover('$TOK', 'Pat')")"
wait
check "two people accepting one link at once: the second is refused" "This handover link isn't working. Ask the teacher for a new one." "$SECOND"
check "  and the school has exactly one account" "Owen:owner" "$(members_of $SCHOOL)"
psql -h /tmp -p "$PORT" -U postgres -d $DB -tAc "begin; update organizations set is_school = true where id = '$NORMAL'; select pg_sleep(1.5); commit;" >/dev/null 2>&1 &
sleep 0.4
RACE="$(q "insert into memberships (user_id, org_id, role) values ('$PAT', '$NORMAL', 'member')" | sed 's/^ERROR:  //' | head -1)"
wait
check "a join racing the switch to school waits, then is refused" "$MSG" "$RACE"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
