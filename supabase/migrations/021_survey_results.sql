-- ═══════════════════════════════════════════════════════════════════════
-- Survey results in the app, for one reader (migration 021)
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
-- Approved by Arjun on Nov 13, 2026.
--
-- The survey's answers (migration 017) can only be read in the dashboard.
-- This lets one Propolis account, Arjun's, read them on a private page,
-- /survey-results, written out in plain English with totals and a
-- spreadsheet download. Everyone else is refused by the database, not just
-- by the page.
--
--   notify_settings 'survey_reader'   the one account allowed to read, as
--                             its user id. Set from the SQL editor (the
--                             page shows the exact line to run, with your
--                             own id in it). Same private table as the
--                             ntfy channel (migration 020).
--   is_survey_reader()        true for that account, false for anyone else.
--                             Used to show the link on Your account.
--   survey_results(p_survey)  every response, newest first, to the reader
--                             only. Anyone else gets an error.
--   notify_new_survey_response()  (from 020) the notification now opens
--                             that response on the page when tapped. The
--                             site's address is notify_settings 'site_url'
--                             if set (for a custom domain later), else
--                             https://props-inventory-xi.vercel.app.
--
-- After running it, open /survey-results while logged in: it shows the one
-- line to run to make that account the reader.
--
-- No existing table or policy changes.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function is_survey_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from notify_settings
    where key = 'survey_reader' and value = auth.uid()::text
  )
$$;

revoke all on function is_survey_reader() from public, anon;
grant execute on function is_survey_reader() to authenticated;

create or replace function survey_results(p_survey text default null)
returns table (id uuid, survey text, answers jsonb, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_survey_reader() then
    raise exception 'Only the survey''s reader can see its responses.'
      using errcode = '42501';
  end if;
  return query
    select r.id, r.survey, r.answers, r.email, r.created_at
    from survey_responses r
    where p_survey is null or r.survey = p_survey
    order by r.created_at desc, r.id;
end;
$$;

revoke all on function survey_results(text) from public, anon;
grant execute on function survey_results(text) to authenticated;

create or replace function notify_new_survey_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  topic text;
  site text;
  total bigint;
  who text;
  theater text;
  line text;
begin
  select value into topic from notify_settings where key = 'ntfy_topic';
  -- Nothing set, or not a channel name: no notification.
  if topic is null or topic !~ '^[A-Za-z0-9_-]{16,64}$' then
    return new;
  end if;
  -- pg_net not switched on yet: nothing to send with.
  if to_regproc('net.http_post') is null then
    return new;
  end if;

  -- Where a tap on the notification goes. Only a plain https address is
  -- used; anything else falls back to the live site.
  select value into site from notify_settings where key = 'site_url';
  if site is null or site !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' then
    site := 'https://props-inventory-xi.vercel.app';
  end if;

  select count(*) into total from survey_responses where survey = new.survey;

  -- Who answered: their role and their theater, and nothing else. Never
  -- the email, the phone number or any other answer.
  who := case new.answers->>'role'
    when 'stage-manager' then 'Stage manager'
    when 'asm' then 'Assistant stage manager'
    when 'props' then 'Props master or prop curator'
    when 'costumes' then 'Costume designer or wardrobe'
    when 'director' then 'Director'
    when 'production-manager' then 'Production manager or technical director'
    when 'other' then coalesce(nullif(survey_notify_text(new.answers->>'role_other'), ''), 'Other')
  end;
  theater := nullif(survey_notify_text(new.answers->>'theater_name'), '');
  line := concat_ws(', ', who, theater);

  begin
    -- pg_net queues the request and returns at once; it's sent after the
    -- response is saved, so a slow or failed send can't hold it up.
    perform net.http_post(
      url := 'https://ntfy.sh/',
      body := jsonb_build_object(
        'topic', topic,
        'title', 'New survey response',
        'message', case when line = '' then '' else line || E'\n' end
          || total || case when total = 1 then ' response so far' else ' responses so far' end,
        'tags', jsonb_build_array('tada'),
        'click', site || '/survey-results#r-' || new.id
      ),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    raise warning 'Survey notification not sent: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function notify_new_survey_response() from public, anon, authenticated;
