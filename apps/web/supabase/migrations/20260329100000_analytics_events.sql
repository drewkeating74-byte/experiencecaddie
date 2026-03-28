-- analytics_events: lightweight funnel tracking for homepage → itinerary flow.
-- Kept deliberately thin — no PII, no auth required to insert (service role only).
-- UI analytics dashboards should query this table directly from Supabase Studio.
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text        NOT NULL,          -- e.g. home_package_click | package_generate_click | itinerary_generated
  package_id uuid,                           -- packages.id if applicable
  metro_slug text,                           -- e.g. 'austin', 'nashville'
  artist_name text,                          -- artist string from the package or search
  user_agent text,                           -- browser UA, sliced to 512 chars
  extra      jsonb                           -- catch-all for future metadata (golf_source, tier, etc.)
);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
-- Inserts are performed via the service-role key only (Edge Functions + server-side helpers).
-- No public read or write needed from the browser.

-- ─── Useful queries ────────────────────────────────────────────────────────────
--
-- Homepage clicks per package — last 7 days:
--   SELECT package_id, metro_slug, artist_name, COUNT(*) AS clicks
--   FROM public.analytics_events
--   WHERE event_type = 'home_package_click'
--     AND created_at > now() - interval '7 days'
--   GROUP BY package_id, metro_slug, artist_name
--   ORDER BY clicks DESC;
--
-- Generate clicks vs completed itineraries per metro — last 30 days:
--   SELECT
--     metro_slug,
--     COUNT(*) FILTER (WHERE event_type = 'package_generate_click') AS generate_clicks,
--     COUNT(*) FILTER (WHERE event_type = 'itinerary_generated')    AS completions,
--     ROUND(
--       COUNT(*) FILTER (WHERE event_type = 'itinerary_generated')::numeric /
--       NULLIF(COUNT(*) FILTER (WHERE event_type = 'package_generate_click'), 0) * 100, 1
--     ) AS completion_pct
--   FROM public.analytics_events
--   WHERE created_at > now() - interval '30 days'
--   GROUP BY metro_slug
--   ORDER BY completions DESC;
--
-- ───────────────────────────────────────────────────────────────────────────────
