-- Add page_context to click_events so every row records which page/component
-- triggered the outbound click. Nullable for backward compatibility with
-- older track-click calls that did not include this field.

ALTER TABLE public.click_events
  ADD COLUMN IF NOT EXISTS page_context text;

COMMENT ON COLUMN public.click_events.page_context IS
  'Page or component that triggered the click (e.g. itinerary, package_card, homepage). '
  'Matches OutboundLinkContext values in outboundLinks.ts.';
