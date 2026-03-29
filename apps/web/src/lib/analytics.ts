/**
 * analytics.ts — lightweight funnel event logger.
 *
 * All calls are fire-and-forget. Errors are caught silently so they never
 * interrupt the user flow. Inserts go directly into the analytics_events
 * table via the Supabase JS client.
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
 * Example queries:
 *   Ticket clicks by artist / city:
 *     SELECT artist_name, extra->>'city' AS city, COUNT(*) AS clicks
 *     FROM analytics_events WHERE event_type = 'ticket_link_clicked'
 *       AND created_at > now() - interval '30 days' GROUP BY 1, 2 ORDER BY clicks DESC;
 *   Hotel clicks by placement (extra.context):
 *     SELECT extra->>'context' AS placement, COUNT(*) FROM analytics_events
 *     WHERE event_type = 'hotel_link_clicked' AND created_at > now() - interval '30 days'
 *     GROUP BY 1;
 *   Override vs Google Hotels:
 *     SELECT extra->>'hotel_link_source' AS src, COUNT(*) FROM analytics_events
 *     WHERE event_type = 'hotel_link_clicked' GROUP BY 1;
 */

import { supabase } from "@/integrations/supabase/client";
import type { OutboundLinkContext } from "@/lib/outboundLinks";

export type AnalyticsEventType =
  | "home_package_click"
  | "package_viewed"
  | "package_generate_click"
  | "search_submitted"
  | "itinerary_generated"
  | "no_results_shown"
  | "hotel_link_clicked"
  | "ticket_link_clicked"
  | "golf_link_clicked"
  | "browse_current_packages_clicked"
  | "alternative_search_clicked";

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
};

export interface AnalyticsEventPayload {
  event_type: AnalyticsEventType | string;
  package_id?: string;
  metro_slug?: string;
  artist_name?: string;
  context?: OutboundLinkContext;
  extra?: AnalyticsExtra;
}

export function logEvent(payload: AnalyticsEventPayload): void {
  const row: Record<string, unknown> = {
    event_type: payload.event_type,
    user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : null,
  };
  if (payload.package_id) row.package_id = payload.package_id;
  if (payload.metro_slug) row.metro_slug = payload.metro_slug;
  if (payload.artist_name) row.artist_name = payload.artist_name;

  const extra: AnalyticsExtra = { ...(payload.extra ?? {}) };
  if (payload.context) extra.context = payload.context;
  if (Object.keys(extra).length > 0) row.extra = extra;

  supabase.from("analytics_events").insert(row).then(() => {}).catch(() => {});
}
