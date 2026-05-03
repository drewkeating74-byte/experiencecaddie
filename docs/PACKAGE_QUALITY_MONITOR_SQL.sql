-- Package Quality Monitor setup
--
-- Run this manually in the Supabase SQL Editor.
-- Do not run through Supabase CLI migrations unless you intentionally want this
-- tracked as a normal database migration.
--
-- Before running:
-- 1. Replace <PROJECT_REF> with your Supabase project ref, e.g. kxibaydbhquospzoefva.
-- 2. Replace <PACKAGE_QUALITY_MONITOR_SECRET> with the same secret you set on
--    the Edge Function as PACKAGE_QUALITY_MONITOR_SECRET.
--
-- The Edge Function also accepts the service role key, but using a dedicated
-- monitor secret avoids storing the service role key in cron metadata.

create table if not exists public.package_quality_log (
  id uuid primary key default gen_random_uuid(),
  package_id text not null,
  run_date date not null,
  rules_passed text[] not null default '{}',
  rules_failed text[] not null default '{}',
  golf_course_rating text,
  internal_score numeric,
  score_reasoning text,
  email_sent boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.package_quality_log is
  'Daily audit log for generated itinerary package quality checks.';

create index if not exists idx_package_quality_log_run_date
  on public.package_quality_log (run_date desc);

create index if not exists idx_package_quality_log_package_id
  on public.package_quality_log (package_id);

-- Optional but recommended: keep table private to app/service code.
alter table public.package_quality_log enable row level security;

drop policy if exists "Admins read package quality log" on public.package_quality_log;
create policy "Admins read package quality log"
  on public.package_quality_log
  for select
  using (public.has_role(auth.uid(), 'admin'));

-- pg_cron + pg_net are required to invoke Edge Functions from Postgres.
-- If either extension is unavailable on your plan/project, enable it from
-- Supabase Dashboard > Database > Extensions first.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 8:00am Central Time is:
--   14:00 UTC during Central Standard Time
--   13:00 UTC during Central Daylight Time
--
-- May is CDT, so this schedules 8:00am Central for the current operating season.
-- If you want automatic DST adjustment, use GitHub Actions or an external
-- scheduler with America/Chicago timezone support instead of pg_cron.
select cron.unschedule('package-quality-monitor-daily')
where exists (
  select 1 from cron.job where jobname = 'package-quality-monitor-daily'
);

select cron.schedule(
  'package-quality-monitor-daily',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/package-quality-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <PACKAGE_QUALITY_MONITOR_SECRET>'
    ),
    body := jsonb_build_object('scheduled', true),
    timeout_milliseconds := 300000
  );
  $$
);
