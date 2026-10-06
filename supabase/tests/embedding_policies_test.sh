#!/usr/bin/env bash
# The policies on item_photo_embeddings (migrations 006 and 010), against a
# real Postgres. Fails if the table has any policy but the two intended ones,
# or if a member of one theatre can put a fingerprint on another theatre's
# item. Also rebuilds the state found on the live database (the pre-006
# draft's policies alongside 006's), shows the hole is real there, and shows
# 010 closes it, sweeps any other stray name, and refuses to finish if it
# couldn't.
#
# Usage:  ./embedding_policies_test.sh [port]
set -u
PORT="${1:-5433}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"
PGDATA="${PGDATA:-/var/lib/postgresql/rlstest}"
DB=embedpolicytest
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

INTENDED="org members can manage their item embeddings, org members can read their item embeddings"
policies() { q "select coalesce(string_agg(policyname, ', ' order by policyname), '') from pg_policies where schemaname='public' and tablename='item_photo_embeddings'"; }
apply010() { psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../migrations/010_item_photo_embeddings_policies.sql" 2>&1; }
VEC="array_fill(0.0::real, array[512])::extensions.vector"

ALICE=11111111-1111-1111-1111-111111111111
BOB=22222222-2222-2222-2222-222222222222
ORGA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
ORGB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
GLOBE=cccccccc-0000-0000-0000-00000000000a
BEAR=cccccccc-0000-0000-0000-00000000000b

echo "── schema.sql"
out=$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$HERE/../schema.sql" 2>&1 | grep -i "^ERROR" | head -2)
check "schema.sql loads" "" "$out"
check "exactly the two intended policies, nothing else" "$INTENDED" "$(policies)"
check "read is SELECT, manage is ALL" "ALL,SELECT" \
  "$(q "select string_agg(cmd, ',' order by cmd) from pg_policies where tablename='item_photo_embeddings'")"
check "the write policy checks the item belongs to the caller's theatre" "1" \
  "$(q "select count(*) from pg_policies where tablename='item_photo_embeddings' and policyname='org members can manage their item embeddings' and with_check like '%items%' and with_check like '%auth_org_id()%'")"
check "no policy writes without that check" "0" \
  "$(q "select count(*) from pg_policies where tablename='item_photo_embeddings' and cmd in ('ALL','INSERT','UPDATE') and coalesce(with_check, qual, '') not like '%items%'")"

# The read-only audit for the live database (live_policy_audit.sql). Its
# expected list must match schema.sql exactly, or a policy added later
# would show up live as "unexpected" and a real stray could hide among them.
AUDIT="$HERE/live_policy_audit.sql"
audit_part2() {
  awk '/^-- 2 /{found=1} /^-- 3 /{found=0} found' "$AUDIT" \
    | psql -h /tmp -p "$PORT" -U postgres -d $DB -tA -F'|' -v ON_ERROR_STOP=1 2>&1
}
check "the live audit's list matches schema.sql: no unexpected, nothing missing" "" "$(audit_part2)"
check "the whole audit runs, read-only, without error" "0" \
  "$(psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$AUDIT" 2>&1 | grep -ci '^ERROR')"
q "create policy \"audit canary\" on item_photo_embeddings for select using (true);" >/dev/null
check "a stray policy shows up in the audit as unexpected" "unexpected|public|item_photo_embeddings|audit canary" "$(audit_part2)"
q "drop policy \"audit canary\" on item_photo_embeddings;" >/dev/null

psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
grant usage on schema public, auth, storage, extensions to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;
insert into auth.users (id) values ('$ALICE'), ('$BOB');
insert into organizations (id, name, invite_code) values
  ('$ORGA','Alpha Theatre','ALPHA123'), ('$ORGB','Beta Playhouse','BETA4567');
insert into profiles (id, full_name, active_org_id) values ('$ALICE','Alice','$ORGA'), ('$BOB','Bob','$ORGB');
insert into memberships (user_id, org_id, role) values ('$ALICE','$ORGA','owner'), ('$BOB','$ORGB','owner');
insert into items (id, org_id, name) values ('$GLOBE','$ORGA','Brass globe'), ('$BEAR','$ORGB','Bear head');
SQL

cross_org_checks() {
  local when="$1"
  check "$when: a member fingerprints their own theatre's item" "INSERT 0 1" \
    "$(as_user $ALICE "insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values ('$GLOBE','$ORGA','a/g.jpg', $VEC) on conflict (item_id) do nothing; select 'INSERT 0 ' || count(*) from item_photo_embeddings where item_id='$GLOBE';")"
  check "$when: org A can't put a fingerprint on org B's item under org A" "1" \
    "$(as_user_full $ALICE "insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values ('$BEAR','$ORGA','x.jpg', $VEC);" | grep -c 'violates row-level security')"
  check "$when: …nor under org B" "1" \
    "$(as_user_full $ALICE "insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values ('$BEAR','$ORGB','x.jpg', $VEC);" | grep -c 'violates row-level security')"
  check "$when: …nor move its own fingerprint onto org B's item" "1" \
    "$(as_user_full $ALICE "update item_photo_embeddings set item_id='$BEAR' where item_id='$GLOBE';" | grep -c 'violates row-level security')"
  check "$when: org B can't see org A's fingerprint" "0" "$(as_user $BOB "select count(*) from item_photo_embeddings;")"
  check "$when: no fingerprint sits on org B's item" "0" "$(q "select count(*) from item_photo_embeddings where item_id='$BEAR'")"
}

echo ""
echo "── Who can write, as schema.sql leaves it"
cross_org_checks "schema.sql"

echo ""
echo "── The live database's state: the pre-006 draft's policies alongside 006's"
# Exactly as the draft wrote them (see embeddings_test.sh): the write policy
# checks org_id and nothing else.
psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create policy "org members read embeddings" on item_photo_embeddings
  for select using (org_id = auth_org_id());
create policy "org members write embeddings" on item_photo_embeddings
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());
SQL
check "four policies, as found live" "4" "$(q "select count(*) from pg_policies where tablename='item_photo_embeddings'")"
check "this test would notice: the policy list is wrong" "f" "$([ "$(policies)" = "$INTENDED" ] && echo t || echo f)"
check "and the hole is real: org A CAN fingerprint org B's item" "INSERT 0 1" \
  "$(as_user $ALICE "insert into item_photo_embeddings (item_id, org_id, photo_url, embedding) values ('$BEAR','$ORGA','smuggled.jpg', $VEC);")"
check "the audit's third query finds the smuggled fingerprint" "$BEAR|$ORGA|$ORGB" \
  "$(awk '/^-- 3 /{found=1} found' "$AUDIT" | psql -h /tmp -p "$PORT" -U postgres -d $DB -tA -F'|' 2>&1 | cut -d'|' -f1-3)"
check "and the draft names show up in its second as unexpected" "2" "$(audit_part2 | grep -c '^unexpected|public|item_photo_embeddings|org members \(read\|write\) embeddings$')"
q "delete from item_photo_embeddings where item_id='$BEAR';" >/dev/null

echo ""
echo "── Migration 010"
out=$(apply010)
check "applies" "" "$(echo "$out" | grep -i "^ERROR" | head -2)"
check "names the policies it swept" "0" "$(echo "$out" | grep -c 'Dropping stray policy')"
check "exactly the two intended policies remain" "$INTENDED" "$(policies)"
cross_org_checks "after 010"
check "applies a second time" "" "$(apply010 | grep -i "^ERROR" | head -2)"
check "…still exactly two" "$INTENDED" "$(policies)"

echo ""
echo "── A stray under any other name is swept too"
q "create policy \"temporary debugging\" on item_photo_embeddings for all using (true) with check (true);" >/dev/null
out=$(apply010)
check "applies" "" "$(echo "$out" | grep -i "^ERROR" | head -2)"
check "and says what it dropped" "1" "$(echo "$out" | grep -c 'Dropping stray policy "temporary debugging"')"
check "exactly two again" "$INTENDED" "$(policies)"
cross_org_checks "after sweeping"

echo ""
echo "── 010's last step refuses to pass a wrong policy list"
q "create policy \"left behind\" on item_photo_embeddings for select using (true);" >/dev/null
part4=$(awk '/Part 4: prove it/{found=1} found' "$HERE/../migrations/010_item_photo_embeddings_policies.sql")
out=$(echo "$part4" | psql -h /tmp -p "$PORT" -U postgres -d $DB -q -v ON_ERROR_STOP=1 2>&1)
check "the check on its own fails, naming what's there" "1" "$(echo "$out" | grep -c 'exactly the two intended policies, but has: .*left behind')"
check "while the whole migration clears it" "$INTENDED" "$(apply010 >/dev/null; policies)"
check "and the intended two are untouched by 010 (same definition as 006)" "1" \
  "$(q "select count(*) from pg_policies where policyname='org members can manage their item embeddings' and with_check like '%items%'")"

echo ""
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ] || exit 1
