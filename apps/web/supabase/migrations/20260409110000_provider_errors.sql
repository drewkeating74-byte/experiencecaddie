-- provider_errors: structured log of external API failures and rate-limit events.
-- Written by edge functions when Ticketmaster or Google Places returns an error.
-- Used for daily dependency health checks — see query in docs or SQL Editor.

CREATE TABLE IF NOT EXISTS public.provider_errors (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which external provider failed (e.g. 'ticketmaster', 'google_places')
  provider      TEXT        NOT NULL,

  -- HTTP status code returned by the provider, if available (null for network errors)
  status_code   INTEGER,

  -- true when the provider returned HTTP 429 (rate limited)
  rate_limited  BOOLEAN     NOT NULL DEFAULT false,

  -- Short description of the error (first 500 chars of the response body or exception message)
  error_message TEXT,

  -- Which edge function was running when the error occurred
  function_name TEXT,

  -- ISO timestamp of when the error happened (default: now)
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.provider_errors IS 'Structured log of external API failures from Ticketmaster and Google Places. Populated by edge functions; used for daily dependency health checks.';
COMMENT ON COLUMN public.provider_errors.rate_limited  IS 'True when HTTP 429 was returned. Useful for filtering rate-limit spikes separately from hard errors.';
COMMENT ON COLUMN public.provider_errors.function_name IS 'Which Supabase edge function logged this error (e.g. search, refresh-catalog).';

-- RLS: edge functions write via service role key (bypasses RLS).
-- Authenticated users (admins) can read; no public read.
ALTER TABLE public.provider_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read provider_errors"
  ON public.provider_errors FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Index for the daily health-check query (filter by date and provider)
CREATE INDEX IF NOT EXISTS idx_provider_errors_occurred
  ON public.provider_errors (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_errors_provider_day
  ON public.provider_errors (provider, (occurred_at::date) DESC);


-- =============================================================================
-- Daily health-check view
-- Run this in the Supabase SQL Editor each morning to see overnight errors.
-- =============================================================================
CREATE OR REPLACE VIEW public.provider_error_daily_summary AS
SELECT
  occurred_at::date                         AS day,
  provider,
  COUNT(*)                                  AS total_errors,
  COUNT(*) FILTER (WHERE rate_limited)      AS rate_limit_hits,
  COUNT(*) FILTER (WHERE NOT rate_limited)  AS hard_errors,
  MIN(status_code)                          AS min_status,
  MAX(status_code)                          AS max_status,
  MAX(occurred_at)                          AS last_error_at
FROM public.provider_errors
GROUP BY occurred_at::date, provider
ORDER BY day DESC, total_errors DESC;

COMMENT ON VIEW public.provider_error_daily_summary IS
  'Aggregated provider error counts by day. Run in SQL Editor for a daily health check.';
