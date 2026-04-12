-- Staging schema for preview deployments and smoke testing.
--
-- PURPOSE
-- -------
-- Provides isolated write targets so that automated smoke tests and preview
-- deployments do not insert junk rows into production tables.
--
-- SCOPE
-- -----
-- Only the tables that smoke tests write to are mirrored here.
-- Edge functions (search, generate-itinerary) still read/write public.* —
-- those writes happen server-side and cannot be schema-switched without
-- modifying the edge function environment. The itinerary smoke test creates
-- one transient row in public.itineraries and deletes it on completion.
--
-- MANUAL STEP REQUIRED AFTER RUNNING THIS MIGRATION
-- --------------------------------------------------
-- Supabase's PostgREST must be told to expose the staging schema so that
-- REST API calls with `Content-Profile: staging` work:
--
--   Dashboard → Settings → API → "Extra search path"
--   Add "staging" to the list alongside "public" and click Save.
--   (This triggers a brief PostgREST reload — no downtime.)
--
-- VERCEL ENV VARS (set in Vercel Dashboard → Project → Settings → Environment Variables)
-- -----------------------------------------------------------------------------------------
--   Environment : Preview  (NOT Production)
--   VITE_APP_ENV = staging

CREATE SCHEMA IF NOT EXISTS staging;

-- ── staging.click_events ──────────────────────────────────────────────────────
-- Mirrors public.click_events.
-- Intentionally NO foreign key on itinerary_id so smoke tests can insert with
-- a synthetic UUID (e.g. 00000000-0000-0000-0000-000000000099) without needing
-- a matching itineraries row in staging.
-- vendor is TEXT here (not the public.vendor_type enum) for the same reason.

CREATE TABLE IF NOT EXISTS staging.click_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id uuid        NOT NULL,
  package_tier text        NOT NULL,
  vendor       text        NOT NULL,
  label        text,
  target_url   text        NOT NULL,
  user_agent   text,
  ip_hash      text,
  provider     text,
  category     text,
  link_type    text,
  page_context text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE staging.click_events IS
  'Smoke-test target for click event writes in preview deployments. '
  'Mirrors public.click_events without FK constraints.';
