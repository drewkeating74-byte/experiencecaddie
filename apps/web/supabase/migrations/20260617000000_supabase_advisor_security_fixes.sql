-- Supabase Advisor: resolve RLS + SECURITY DEFINER view warnings.
-- 1) Drop unused deprecated golf verification archive (no app references).
-- 2) Recreate admin analytics views with security_invoker (respect underlying RLS).
-- 3) Revoke API access to those views from anon/authenticated (SQL Editor / service role only).

DROP TABLE IF EXISTS public.golf_course_verifications_deprecated_2026_05;

CREATE OR REPLACE VIEW public.click_events_summary
WITH (security_invoker = true) AS
SELECT
  COALESCE(category, '(no category)') AS category,
  COALESCE(provider, '(no provider)') AS provider,
  COALESCE(link_type, '(no link_type)') AS link_type,
  package_tier,
  COUNT(*) AS click_count,
  MAX(created_at) AS latest_click_at
FROM public.click_events
GROUP BY category, provider, link_type, package_tier
ORDER BY click_count DESC, latest_click_at DESC;

COMMENT ON VIEW public.click_events_summary IS
  'Outbound click summary by category, provider, link_type, and package_tier. Admin/SQL Editor only.';

CREATE OR REPLACE VIEW public.click_events_by_day
WITH (security_invoker = true) AS
SELECT
  DATE(created_at AT TIME ZONE 'UTC') AS click_date,
  COALESCE(category, '(no category)') AS category,
  COALESCE(provider, '(no provider)') AS provider,
  COUNT(*) AS click_count
FROM public.click_events
GROUP BY DATE(created_at AT TIME ZONE 'UTC'), category, provider
ORDER BY click_date DESC, click_count DESC;

COMMENT ON VIEW public.click_events_by_day IS
  'Daily click counts by category and provider. Admin/SQL Editor only.';

CREATE OR REPLACE VIEW public.provider_error_daily_summary
WITH (security_invoker = true) AS
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
  'Aggregated provider error counts by day. Admin/SQL Editor only.';

REVOKE ALL ON public.click_events_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.click_events_by_day FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_error_daily_summary FROM PUBLIC, anon, authenticated;
