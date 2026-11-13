-- ═══════════════════════════════════════════════════════════════════════
-- A phone notification for each new survey response (migration 020)
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
-- Approved by Arjun on Nov 12, 2026.
--
-- When someone submits the survey, Supabase sends a push notification
-- through ntfy (https://ntfy.sh, free, no account) to a private channel
-- Arjun follows in the ntfy app. The message says who answered (their
-- role and theater) and how many responses there are, for example
-- "Stage manager, Pacific Repertory Theatre / 3 responses so far". No other
-- answer and no email address leaves the database. (Nov 13: Arjun chose
-- role and theater over the count alone.)
--
--   notify_settings           private settings: the ntfy channel name. RLS
--                             on, no policies, revoked from users. The
--                             channel name is set from the SQL editor and is
--                             never in the code, because the repository is
--                             public and anyone who knows a channel name can
--                             read it.
--   survey_notify_text(t)     flattens typed text to one line of at most
--                             60 characters, for the message.
--   notify_new_survey_response()  the trigger. It never stops a response
--                             being saved: with no channel set, without
--                             pg_net, or if sending fails, it does nothing
--                             (a failure is only logged as a warning).
--
-- pg_net is Supabase's extension for web requests from the database. The
-- block below switches it on; or use Database → Extensions → pg_net.
--
-- After running it, set the channel (the name is in your ntfy app):
--   insert into notify_settings (key, value) values ('ntfy_topic', 'your-channel-name')
--   on conflict (key) do update set value = excluded.value;
-- To stop the notifications: delete from notify_settings where key = 'ntfy_topic';
--
-- No existing table, function or policy changes.
-- ═══════════════════════════════════════════════════════════════════════

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net isn''t available here (%), so no notifications will be sent.', sqlerrm;
end;
$$;

create table if not exists notify_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table notify_settings enable row level security;
revoke all on notify_settings from anon, authenticated;

-- Typed text for a notification: one line, at most 60 characters.
create or replace function survey_notify_text(t text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when length(c) > 60 then left(c, 59) || '…' else c end
  from (select btrim(regexp_replace(coalesce(t, ''), '[[:space:][:cntrl:]]+', ' ', 'g')) as c) s
$$;

revoke all on function survey_notify_text(text) from public, anon, authenticated;

create or replace function notify_new_survey_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  topic text;
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

  select count(*) into total from survey_responses where survey = new.survey;

  -- Who answered: their role and their theater, and nothing else. Never
  -- the email or any other answer.
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
        'tags', jsonb_build_array('tada')
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

drop trigger if exists survey_response_notify on survey_responses;
create trigger survey_response_notify
  after insert on survey_responses
  for each row execute function notify_new_survey_response();
