/**
 * analytics.ts — lightweight funnel event logger.
 *
 * All calls are fire-and-forget. Errors are caught silently so they never
 * interrupt the user flow. Inserts go directly into the analytics_events
 * table via the Supabase JS client (service-role anon key is fine here
 * because RLS on analytics_events has no public read policy).
 *
 * Usage:
 *   logEvent({ event_type: "home_package_click", package_id: pkg.id, metro_slug: "austin", artist_name: "Luke Combs" })
 */

import { supabase } from "@/integrations/supabase/client";

export interface AnalyticsEventPayload {
  event_type: string;
  package_id?: string;
  metro_slug?: string;
  artist_name?: string;
  extra?: Record<string, unknown>;
}

export function logEvent(payload: AnalyticsEventPayload): void {
  const row: Record<string, unknown> = {
    event_type: payload.event_type,
    user_agent: typeof navigator !== "undefined"
      ? navigator.userAgent.slice(0, 512)
      : null,
  };
  if (payload.package_id) row.package_id = payload.package_id;
  if (payload.metro_slug) row.metro_slug = payload.metro_slug;
  if (payload.artist_name) row.artist_name = payload.artist_name;
  if (payload.extra) row.extra = payload.extra;

  // Non-blocking — intentionally not awaited
  supabase.from("analytics_events").insert(row).then(() => {}).catch(() => {});
}
