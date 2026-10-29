-- ═══════════════════════════════════════════════════════════════════════
-- Surveys: answers from the public /survey page (migration 017)
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Arjun approved this on Oct 27, 2026. It's for a problem-discovery survey
-- for stage managers, prop curators and directors: people with no account,
-- who open a link and answer.
--
--   survey_responses        one row per submission. RLS is on with no
--                           policies, so nobody using the app can read it,
--                           signed in or not. Read it in the dashboard:
--                           Table Editor → survey_responses (Export to CSV).
--   submit_survey(...)      the only way in, open to anyone. It checks the
--                           answers' size and the email's shape. It allows
--                           5 submissions an hour per connection and 500 a
--                           day in all, to keep spam out.
--
-- To limit repeat submissions, a scrambled form of the sender's network
-- address (client_hash) is kept for about an hour, then cleared. Nothing
-- else about the sender is stored. The email is stored only if they type one.
--
-- No existing table, function or policy changes.
--
-- Reading the answers as columns:
--   select created_at, answers->>'role' as role, answers->>'company' as company,
--          answers->>'frustration' as frustration, email
--   from survey_responses where survey = 'storage-2026' order by created_at;
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey text not null,
  answers jsonb not null,
  email text,
  client_hash text,
  created_at timestamptz not null default now()
);
create index if not exists survey_responses_created_idx on survey_responses (created_at);
create index if not exists survey_responses_client_idx on survey_responses (client_hash, created_at)
  where client_hash is not null;

-- No policies: nothing reads or writes this table except submit_survey.
alter table survey_responses enable row level security;
revoke all on survey_responses from anon, authenticated;

create or replace function submit_survey(p_survey text, p_answers jsonb, p_email text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  headers json := nullif(current_setting('request.headers', true), '')::json;
  client text := btrim(coalesce(headers->>'cf-connecting-ip', split_part(coalesce(headers->>'x-forwarded-for', ''), ',', 1)));
  who text;
  cleaned_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if p_survey is null or p_survey !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'That survey doesn''t exist';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'The answers didn''t come through. Please try again.';
  end if;
  if length(p_answers::text) > 20000 then
    raise exception 'Those answers are too long to save. Please shorten the written ones.';
  end if;
  if cleaned_email is not null
     and (length(cleaned_email) > 254 or cleaned_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'That email address doesn''t look right. Check it, or leave it empty.';
  end if;

  -- Forget network addresses after an hour; they're only for the limit below.
  update survey_responses set client_hash = null
  where client_hash is not null and created_at < now() - interval '1 hour';

  if (select count(*) from survey_responses where created_at > now() - interval '1 day') >= 500 then
    raise exception 'The survey has had too many answers today. Please try again tomorrow.';
  end if;
  if client <> '' then
    who := md5('propolis-survey:' || client);
    if (select count(*) from survey_responses
        where client_hash = who and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'You''ve sent several answers in the last hour. Thank you! Please try again later.';
    end if;
  end if;

  insert into survey_responses (survey, answers, email, client_hash)
  values (p_survey, p_answers, cleaned_email, who);
end;
$$;

revoke all on function submit_survey(text, jsonb, text) from public;
grant execute on function submit_survey(text, jsonb, text) to anon, authenticated;
