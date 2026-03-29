/**
 * analytics.ts — lightweight funnel event logger.
 *
 * All calls are fire-and-forget. Errors are caught silently so they never
 * interrupt the user flow. Inserts go directly into the analytics_events
 * table via the Supabase JS client.
 *
 * ─── EVENT TYPES ────────────────────────────────────────────────────────────
 *
 * Funnel events (in order):
 *   home_package_click        — user taps a featured package card on homepage
 *   package_viewed            — user opens a package detail / packages page card
 *   package_generate_click    — user hits "Generate itinerary" for a package
 *   search_submitted          — user submits the planner form (artist + city + dates)
 *   itinerary_generated       — backend confirms a complete itinerary was built
 *   no_results_shown          — planner returned no usable results
 *
 * Outbound click events (monetizable):
 *   hotel_link_clicked        — user clicks a hotel booking link
 *   ticket_link_clicked       — user clicks a concert ticket link
 *   golf_link_clicked         — user clicks a golf tee-time link
 *
 * Recovery / navigation events:
 *   browse_current_packages_clicked   — user taps "Browse current packages" from no-results
 *   alternative_search_clicked        — user taps "Try another artist" from no-results
 *
 * ─── USEFUL QUERIES ─────────────────────────────────────────────────────────
 *
 * Homepage clicks per package (last 7 days):
 *   SELECT package_id, artist_name, COUNT(*) AS clicks
 *   FROM analytics_events
 *   WHERE event_type = 'home_package_click'
 *     AND created_at > now() - interval '7 days'
 *   GROUP BY package_id, artist_name
 *   ORDER BY clicks DESC;
 *
 * Generate clicks vs completed itineraries per metro:
 *   SELECT metro_slug,
 *     COUNT(*) FILTER (WHERE event_type = 'package_generate_click') AS generate_clicks,
 *     COUNT(*) FILTER (WHERE event_type = 'itinerary_generated')    AS completed
 *   FROM analytics_events
 *   WHERE event_type IN ('package_generate_click','itinerary_generated')
 *   GROUP BY metro_slug
 *   ORDER BY generate_clicks DESC;
 *
 * Outbound click breakdown:
 *   SELECT event_type, extra->>'provider' AS provider, COUNT(*) AS clicks
 *   FROM analytics_events
 *   WHERE event_type IN ('hotel_link_clicked','ticket_link_clicked','golf_link_clicked')
 *     AND created_at > now() - interval '30 days'
 *   GROUP BY event_type, provider
 *   ORDER BY clicks DESC;
 *
 * No-results rate:
 *   SELECT
 *     COUNT(*) FILTER (WHERE event_type = 'search_submitted') AS searches,
 *     COUNT(*) FILTER (WHERE event_type = 'no_results_shown') AS no_results,
 *     ROUND(
 *       COUNT(*) FILTER (WHERE event_type = 'no_results_shown')::numeric /
 *       NULLIF(COUNT(*) FILTER (WHERE event_type = 'search_submitted'),0) * 100, 1
 *     ) AS no_results_pct
 *   FROM analytics_events
 *   WHERE created_at > now() - interval '30 days';
 */

import { supabase } from "@/integrations/supabase/client";
import type { OutboundLinkContext } from "@/lib/outboundLinks";

export type AnalyticsEventType =
  // Funnel
  | "home_package_click"
  | "package_viewed"
  | "package_generate_click"
  | "search_submitted"
  | "itinerary_generated"
  | "no_results_shown"
  // Outbound clicks
  | "hotel_link_clicked"
  | "ticket_link_clicked"
  | "golf_link_clicked"
  // Recovery
  | "browse_current_packages_clicked"
  | "alternative_search_clicked";

export interface AnalyticsEventPayload {
  event_type: AnalyticsEventType | string;
  package_id?: string;
  metro_slug?: string;
  artist_name?: string;
  /** UI placement that triggered the event */
  context?: OutboundLinkContext;
  extra?: Record<string, unknown>;
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

  // Merge context into extra so it reaches the DB without a schema change
  const extra: Record<string, unknown> = { ...(payload.extra ?? {}) };
  if (payload.context) extra.context = payload.context;
  if (Object.keys(extra).length > 0) row.extra = extra;

  supabase.from("analytics_events").insert(row).then(() => {}).catch(() => {});
}
