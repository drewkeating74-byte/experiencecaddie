-- Add nullable outbound link metadata columns to click_events for analytics and affiliate/referral work.
-- Backward compatible: older track-click calls without these fields continue to work.

ALTER TABLE public.click_events
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS link_type text;

COMMENT ON COLUMN public.click_events.provider IS 'Outbound link provider (e.g. Ticketmaster, Booking.com, GolfNow) when available from frontend metadata';
COMMENT ON COLUMN public.click_events.category IS 'Outbound link category (concert, hotel, golf) when available from frontend metadata';
COMMENT ON COLUMN public.click_events.link_type IS 'Outbound link type (direct_event, provider_search, manual_fallback, etc.) when available from frontend metadata';
