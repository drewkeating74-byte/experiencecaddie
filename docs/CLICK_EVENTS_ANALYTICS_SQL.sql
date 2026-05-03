-- Click events analytics field expansion
-- Run manually in Supabase SQL Editor. Do not run with the Supabase CLI.
--
-- Purpose:
--   Consolidate marketing, package engagement, and outbound affiliate click
--   tracking into public.click_events.

alter table public.click_events
  alter column itinerary_id drop not null,
  alter column package_tier drop not null,
  alter column target_url drop not null;

alter table public.click_events
  add column if not exists event_type text not null default 'affiliate_click',
  add column if not exists original_event_type text,
  add column if not exists package_id text,
  add column if not exists destination text,
  add column if not exists metro_slug text,
  add column if not exists artist_name text,
  add column if not exists metadata jsonb,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

comment on column public.click_events.event_type is
  'Normalized analytics event name, e.g. affiliate_click, package_viewed, package_emailed.';
comment on column public.click_events.original_event_type is
  'Original app event before normalization, e.g. ticket_link_clicked or golf_link_clicked.';
comment on column public.click_events.package_id is
  'Package id or generated itinerary id associated with the event when available.';
comment on column public.click_events.destination is
  'Outbound destination/provider or engagement destination, e.g. Ticketmaster, GolfNow, email.';
comment on column public.click_events.metadata is
  'Additional non-PII event metadata from the app.';
comment on column public.click_events.utm_source is 'Landing-page utm_source persisted for this browser session.';
comment on column public.click_events.utm_medium is 'Landing-page utm_medium persisted for this browser session.';
comment on column public.click_events.utm_campaign is 'Landing-page utm_campaign persisted for this browser session.';
comment on column public.click_events.utm_content is 'Landing-page utm_content persisted for this browser session.';
comment on column public.click_events.utm_term is 'Landing-page utm_term persisted for this browser session.';

create index if not exists click_events_event_type_created_at_idx
  on public.click_events (event_type, created_at desc);

create index if not exists click_events_utm_campaign_created_at_idx
  on public.click_events (utm_campaign, created_at desc);

create index if not exists click_events_package_id_created_at_idx
  on public.click_events (package_id, created_at desc);
