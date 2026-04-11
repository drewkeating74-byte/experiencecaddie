/**
 * packages-maintenance — Daily background job for the packages catalog.
 *
 * Does two things per run:
 *
 * 1. DEACTIVATE PAST PACKAGES
 *    Sets active = false on any package whose event date (either from the
 *    joined events table or the denormalized event_date column) has passed.
 *    Rows are kept for historical reference; only hidden from the browse page.
 *
 * 2. AUTO-PROMOTE POPULAR ITINERARIES
 *    When a user-generated itinerary has been saved by 2+ distinct users,
 *    it is promoted to the packages catalog as a "promoted" package. The
 *    event/golf/city data is extracted from result_json and stored in
 *    denormalized columns (event_name, event_date, artist_name, etc.) since
 *    the itinerary doesn't reference the FK tables that curated packages use.
 *
 *    Threshold: PROMOTE_MIN_SAVES distinct user saves per itinerary.
 *    Cap: PROMOTE_MAX_PER_RUN new promotions per run (cost control).
 *
 * Called daily by .github/workflows/packages-maintenance.yml
 * Requires: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROMOTE_MIN_SAVES = 2;
const PROMOTE_MAX_PER_RUN = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function toDateStr(val: unknown): string | null {
  if (!val || typeof val !== "string") return null;
  const iso = val.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** Extract the canonical concert event from a result_json blob.
 *  Prefers GOLD tier; falls back through SILVER → BRONZE. */
function extractEvent(resultJson: unknown): { name: string; date: string | null; artist: string | null } | null {
  const rj = resultJson as { packages?: Array<{ tier?: string; events?: Array<{ name?: string; date_time?: string }> }> } | null;
  if (!rj?.packages?.length) return null;
  const order = ["GOLD", "SILVER", "BRONZE"];
  for (const tier of order) {
    const pkg = rj.packages.find((p) => p.tier === tier);
    const evt = pkg?.events?.find((e) => e.name && !["restaurant", "bar", "experience", "attraction"].includes((e as any).type ?? ""));
    if (evt?.name) {
      return {
        name: evt.name,
        date: toDateStr(evt.date_time),
        artist: evt.name,
      };
    }
  }
  return null;
}

/** Extract the canonical golf course from a result_json blob. */
function extractGolf(resultJson: unknown): string | null {
  const rj = resultJson as { packages?: Array<{ tier?: string; golf?: Array<{ name?: string }> }> } | null;
  if (!rj?.packages?.length) return null;
  for (const tier of ["GOLD", "SILVER", "BRONZE"]) {
    const pkg = rj.packages.find((p) => p.tier === tier);
    const g = pkg?.golf?.[0];
    if (g?.name) return g.name;
  }
  return null;
}

/** Extract a rough price from a result_json summary. */
function extractPrice(resultJson: unknown): number | null {
  const rj = resultJson as { summary?: { estimated_total_range_usd?: number[] } } | null;
  const range = rj?.summary?.estimated_total_range_usd;
  if (Array.isArray(range) && range.length >= 2) {
    return Math.round((range[0] + range[1]) / 2);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const sb = createClient(supabaseUrl, serviceKey);
  const today = new Date().toISOString().slice(0, 10);

  const result = {
    deactivated_curated: 0,
    deactivated_promoted: 0,
    promoted: 0,
    promotion_errors: [] as string[],
  };

  // ── 1. DEACTIVATE PAST PACKAGES ────────────────────────────────────────────

  // Curated packages: join to events table to read event_date
  const { data: curatedPast, error: curatedErr } = await sb
    .from("packages")
    .select("id, events!inner(event_date)")
    .eq("active", true)
    .eq("source", "curated")
    .lt("events.event_date", today);

  if (curatedErr) {
    console.error("[pkg-maintenance] curated deactivate query error:", curatedErr.message);
  } else if (curatedPast?.length) {
    const ids = curatedPast.map((p) => p.id);
    await sb.from("packages").update({ active: false }).in("id", ids);
    result.deactivated_curated = ids.length;
    console.log(`[pkg-maintenance] deactivated ${ids.length} curated package(s)`);
  }

  // Promoted packages: use denormalized event_date column
  const { data: promotedPast, error: promotedErr } = await sb
    .from("packages")
    .select("id, event_date")
    .eq("active", true)
    .eq("source", "promoted")
    .not("event_date", "is", null)
    .lt("event_date", today);

  if (promotedErr) {
    console.error("[pkg-maintenance] promoted deactivate query error:", promotedErr.message);
  } else if (promotedPast?.length) {
    const ids = promotedPast.map((p) => p.id);
    await sb.from("packages").update({ active: false }).in("id", ids);
    result.deactivated_promoted = ids.length;
    console.log(`[pkg-maintenance] deactivated ${ids.length} promoted package(s)`);
  }

  // ── 2. AUTO-PROMOTE POPULAR ITINERARIES ────────────────────────────────────

  // Find itineraries saved by >= PROMOTE_MIN_SAVES distinct users
  // that haven't already been promoted.
  const { data: savedRows, error: savedErr } = await sb
    .from("user_saved_packages")
    .select("itinerary_id, user_id");

  if (savedErr) {
    console.error("[pkg-maintenance] saved query error:", savedErr.message);
    return json(result);
  }

  // Aggregate: count distinct users per itinerary
  const saveCounts = new Map<string, Set<string>>();
  for (const row of savedRows ?? []) {
    if (!saveCounts.has(row.itinerary_id)) saveCounts.set(row.itinerary_id, new Set());
    saveCounts.get(row.itinerary_id)!.add(row.user_id);
  }
  const qualifying = [...saveCounts.entries()]
    .filter(([, users]) => users.size >= PROMOTE_MIN_SAVES)
    .map(([itinerary_id, users]) => ({ itinerary_id, save_count: users.size }))
    .slice(0, PROMOTE_MAX_PER_RUN);

  if (qualifying.length === 0) {
    console.log("[pkg-maintenance] no itineraries qualify for promotion");
    return json(result);
  }

  // Check which are already promoted
  const qualIds = qualifying.map((q) => q.itinerary_id);
  const { data: alreadyPromoted } = await sb
    .from("packages")
    .select("source_itinerary_id")
    .in("source_itinerary_id", qualIds);
  const alreadyIds = new Set((alreadyPromoted ?? []).map((p) => p.source_itinerary_id));

  const toPromote = qualifying.filter((q) => !alreadyIds.has(q.itinerary_id));
  console.log(`[pkg-maintenance] ${toPromote.length} new itinerary/itineraries eligible for promotion`);

  for (const { itinerary_id, save_count } of toPromote) {
    try {
      const { data: itin, error: itinErr } = await sb
        .from("itineraries")
        .select("id, city, result_json, budget_tier, event_details")
        .eq("id", itinerary_id)
        .single();

      if (itinErr || !itin?.result_json) {
        result.promotion_errors.push(`${itinerary_id}: itinerary not found or no result_json`);
        continue;
      }

      const event = extractEvent(itin.result_json);
      const golfName = extractGolf(itin.result_json);
      const price = extractPrice(itin.result_json);
      const city = itin.city === "flexible" ? null : itin.city;

      // Skip if we can't extract a meaningful event
      if (!event?.name) {
        result.promotion_errors.push(`${itinerary_id}: could not extract event from result_json`);
        continue;
      }

      const artistLabel = event.artist ?? event.name;
      const cityLabel = city ?? "Various";
      const name = `${artistLabel} + Golf – ${cityLabel} Weekend`;
      const description = `Community-picked weekend: ${artistLabel} live${city ? ` in ${city}` : ""}, paired with a round at ${golfName ?? "a great local course"}.`;

      const { error: insertErr } = await sb.from("packages").insert({
        name,
        source: "promoted",
        source_itinerary_id: itinerary_id,
        promoted_at: new Date().toISOString(),
        save_count,
        event_name: event.name,
        event_date: event.date ?? null,
        artist_name: artistLabel,
        golf_course_name: golfName ?? null,
        city: city ?? null,
        description,
        price: price ?? 850,
        category: "Golf + Concert",
        featured: false,
        active: true,
      });

      if (insertErr) {
        result.promotion_errors.push(`${itinerary_id}: insert failed — ${insertErr.message}`);
      } else {
        result.promoted++;
        console.log(`[pkg-maintenance] promoted itinerary ${itinerary_id} → "${name}"`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.promotion_errors.push(`${itinerary_id}: ${msg}`);
    }
  }

  console.log(`[pkg-maintenance] done — deactivated_curated=${result.deactivated_curated} deactivated_promoted=${result.deactivated_promoted} promoted=${result.promoted} errors=${result.promotion_errors.length}`);
  return json(result);
});
