/**
 * analytics.ts — lightweight funnel and click event logger.
 *
 * All calls are fire-and-forget. Errors are caught silently so they never
 * interrupt the user flow. Events route through the track-click Edge Function
 * and land in click_events.
 *
 * Outbound clicks (hotel_link_clicked, ticket_link_clicked, golf_link_clicked):
 * Prefer passing rich `extra` so you can segment by surface and intent:
 *   - context (in extra): OutboundLinkContext — homepage | package_card | packages_page | itinerary | planner_result
 *   - category: "hotel" | "ticket" | "golf"
 *   - provider: e.g. Ticketmaster, Google Hotels
 *   - city, event_date: trip context when available
 *   - artist_name: from itinerary or package (may duplicate top-level artist_name)
 *   - hotel_link_source: "override" | "google_hotels" (hotels only) — compare override vs search
 *
 * Top-level columns: package_id, metro_slug, artist_name (indexed for common queries).
 * Everything else should live in `extra` (jsonb) for flexibility.
 *
 * Example query:
 *   SELECT destination, utm_source, COUNT(*) AS clicks
 *   FROM click_events
 *   WHERE event_type = 'affiliate_click' AND created_at > now() - interval '30 days'
 *   GROUP BY 1, 2 ORDER BY clicks DESC;
 */

import type { OutboundLinkContext } from "@/lib/outboundLinks";
import { getStoredUtmParams } from "@/lib/utm";

export type AnalyticsEventType =
  | "affiliate_click"
  | "home_package_click"
  | "package_viewed"
  | "package_emailed"
  | "package_generate_click"
  | "search_submitted"
  | "itinerary_generated"
  | "no_results_shown"
  | "hotel_link_clicked"
  | "ticket_link_clicked"
  | "golf_link_clicked"
  | "browse_current_packages_clicked"
  | "alternative_search_clicked"
  | "weekend_ideas_signup";

/** Optional jsonb payload; merge with context for outbound clicks. */
export type AnalyticsExtra = Record<string, unknown> & {
  context?: OutboundLinkContext;
  category?: "hotel" | "ticket" | "golf";
  provider?: string;
  city?: string;
  event_date?: string;
  hotel_link_source?: "override" | "google_hotels";
  tier?: string;
  link_type?: string;
  label?: string;
  destination?: string;
  itinerary_id?: string;
  package_tier?: string;
  target_url?: string;
};

export interface AnalyticsEventPayload {
  event_type: AnalyticsEventType | string;
  package_id?: string;
  metro_slug?: string;
  artist_name?: string;
  context?: OutboundLinkContext;
  extra?: AnalyticsExtra;
}

const OUTBOUND_EVENT_TYPES = new Set(["hotel_link_clicked", "ticket_link_clicked", "golf_link_clicked"]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function inferVendor(payload: AnalyticsEventPayload, extra: AnalyticsExtra): string {
  if (extra.category === "ticket" || payload.event_type === "ticket_link_clicked") return "ticket";
  if (extra.category === "hotel" || payload.event_type === "hotel_link_clicked") return "hotel";
  if (extra.category === "golf" || payload.event_type === "golf_link_clicked") return "golf";
  return "experience";
}

export function logEvent(payload: AnalyticsEventPayload): void {
  const extra: AnalyticsExtra = { ...(payload.extra ?? {}) };
  if (payload.context) extra.context = payload.context;

  const eventType = OUTBOUND_EVENT_TYPES.has(payload.event_type)
    ? "affiliate_click"
    : payload.event_type;
  const body = {
    event_type: eventType,
    original_event_type: payload.event_type,
    itinerary_id: typeof extra.itinerary_id === "string" && UUID_REGEX.test(extra.itinerary_id) ? extra.itinerary_id : undefined,
    package_id: payload.package_id,
    package_tier: typeof extra.package_tier === "string" ? extra.package_tier : undefined,
    vendor: inferVendor(payload, extra),
    label: typeof extra.label === "string" ? extra.label : payload.artist_name,
    target_url: typeof extra.target_url === "string" ? extra.target_url : undefined,
    provider: typeof extra.provider === "string" ? extra.provider : undefined,
    category: typeof extra.category === "string" ? extra.category : undefined,
    link_type: typeof extra.link_type === "string" ? extra.link_type : undefined,
    page_context: payload.context ?? extra.context,
    destination: typeof extra.destination === "string"
      ? extra.destination
      : typeof extra.city === "string"
        ? extra.city
        : payload.metro_slug,
    metro_slug: payload.metro_slug,
    artist_name: payload.artist_name,
    metadata: extra,
    ...getStoredUtmParams(),
  };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  fetch(`${supabaseUrl}/functions/v1/track-click`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
