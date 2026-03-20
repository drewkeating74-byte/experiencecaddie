-- Lightweight analytics views for outbound click behavior.
-- Run in Supabase SQL editor or apply via migration.
-- RLS: views use underlying table policies; admin/own-itinerary read applies.

-- View 1: Summary by category, provider, link_type, package_tier
-- Use for: Which category/provider/link_type/tier drives the most clicks?
CREATE OR REPLACE VIEW public.click_events_summary AS
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

COMMENT ON VIEW public.click_events_summary IS 'Outbound click summary by category, provider, link_type, and package_tier. Use for affiliate prioritization.';

-- View 2: Clicks by day for time-series and trend analysis
CREATE OR REPLACE VIEW public.click_events_by_day AS
SELECT
  DATE(created_at AT TIME ZONE 'UTC') AS click_date,
  COALESCE(category, '(no category)') AS category,
  COALESCE(provider, '(no provider)') AS provider,
  COUNT(*) AS click_count
FROM public.click_events
GROUP BY DATE(created_at AT TIME ZONE 'UTC'), category, provider
ORDER BY click_date DESC, click_count DESC;

COMMENT ON VIEW public.click_events_by_day IS 'Daily click counts by category and provider. Use for trend analysis and volume over time.';
