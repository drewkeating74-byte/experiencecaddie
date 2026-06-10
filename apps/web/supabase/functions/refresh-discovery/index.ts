/**
 * refresh-discovery — populate the discovery_shows cache from Ticketmaster.
 *
 * PURPOSE
 * -------
 * The itinerary builder's genre / "best upcoming shows" discovery reads from
 * public.discovery_shows instead of calling Ticketmaster live on every request.
 * This job refreshes that cache on a schedule with a small, quota-friendly set
 * of NATIONWIDE TM calls (a few paginated requests per genre, filtered to our
 * catalog metros client-side), so user-facing discovery is deep, date-spread,
 * instant, and never trips TM's rate/quota limits.
 *
 * HOW TO CALL
 * -----------
 *   POST /functions/v1/refresh-discovery
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   Body (optional): { "dry_run": true, "pages": 4 }
 *
 * CADENCE: daily (GitHub Actions cron → see .github/workflows/refresh-discovery.yml)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { METROS, getMetroByCity } from "../_shared/golfCities.ts";
import {
  fetchNationwideDiscoveryShows,
  isWeekendGetawayYmd,
  type DiscoveryShowRow,
} from "../_shared/ticketmaster.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Genres to keep cached. Golf-audience staples (Country, Rock, Classic Rock,
// Americana) are listed first so they consume more TM quota pages before
// lower-priority genres. Americana and Folk were previously missing entirely.
const REFRESH_GENRES = [
  "Country",
  "Rock",
  "Classic Rock",
  "Americana",
  "Folk",
  "Pop",
  "Alternative",
  "Singer-Songwriter",
  "Dance/Electronic",
  "Hip-Hop/Rap",
  "R&B",
  "Latin",
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, months: number): Date {
  const copy = new Date(d);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json({ error: "Unauthorized — authorization header required" }, 401);

  let body: { dry_run?: boolean; pages?: number; mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body ok
  }
  const dryRun = body.dry_run === true;
  const pagesPerGenre = Math.min(Math.max(body.pages ?? 4, 1), 5);

  const today = new Date();
  const startDate = ymd(today);
  const endDate = ymd(addMonths(today, 6));

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Bootstrap mode: seed the cache from the existing curated events catalog
  // (no Ticketmaster calls). Useful when the TM daily quota is exhausted so the
  // cache still has real, bookable shows to serve until the next TM refresh.
  if (body.mode === "seed_from_events") {
    return await seedFromEvents(createClient(supabaseUrl, serviceRoleKey), startDate, endDate);
  }

  const started = Date.now();
  const stats: Record<string, unknown> = {};
  let rows: DiscoveryShowRow[] = [];
  try {
    rows = await fetchNationwideDiscoveryShows({
      metros: METROS,
      startDate,
      endDate,
      genreTokens: REFRESH_GENRES,
      pagesPerGenre,
      stats,
    });
  } catch (err) {
    return json({ error: `Discovery fetch failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  if (dryRun) {
    return json({
      dry_run: true,
      window: { startDate, endDate },
      fetched: rows.length,
      tm: stats,
      sample: rows.slice(0, 10).map((r) => ({ date: r.event_date, artist: r.artist, city: r.city, genre: r.genre, score: r.score })),
      elapsed_ms: Date.now() - started,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const runIso = new Date().toISOString();
  const errors: string[] = [];
  let upserted = 0;

  // Upsert in chunks (onConflict tm_event_id) so re-seen shows stay active/fresh.
  const payload = rows.map((r) => ({ ...r, active: true, refreshed_at: runIso, updated_at: runIso }));
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const { error } = await supabase
      .from("discovery_shows")
      .upsert(chunk, { onConflict: "tm_event_id", ignoreDuplicates: false });
    if (error) errors.push(error.message);
    else upserted += chunk.length;
  }

  // Prune past shows entirely.
  const { error: delErr, count: deletedPast } = await supabase
    .from("discovery_shows")
    .delete({ count: "exact" })
    .lt("event_date", startDate);
  if (delErr) errors.push(`prune past: ${delErr.message}`);

  // Deactivate stale rows not seen in the last ~3 days (cancelled / sold-out /
  // dropped from TM) so they fall out of discovery without being deleted.
  const staleCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { error: staleErr, count: deactivated } = await supabase
    .from("discovery_shows")
    .update({ active: false, updated_at: runIso }, { count: "exact" })
    .lt("refreshed_at", staleCutoff)
    .eq("active", true);
  if (staleErr) errors.push(`deactivate stale: ${staleErr.message}`);

  return json({
    window: { startDate, endDate },
    fetched: rows.length,
    tm: stats,
    upserted,
    pruned_past: deletedPast ?? 0,
    deactivated_stale: deactivated ?? 0,
    error_count: errors.length,
    errors,
    elapsed_ms: Date.now() - started,
  });
});

/**
 * Seed discovery_shows from the curated public.events catalog (no TM calls).
 * Maps each event's venue city to a catalog metro so it surfaces in discovery,
 * keeps only weekend-eligible dates inside the window, and upserts. tm_event_id
 * is namespaced as `event:<id>` so these bootstrap rows never collide with real
 * Ticketmaster rows and naturally deactivate once a real TM refresh runs.
 */
async function seedFromEvents(supabase: any, startDate: string, endDate: string): Promise<Response> {
  const started = Date.now();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,name,event_date,image_url,ticket_url,min_price,max_price,source_id,artists(name),venues(name,city)",
    )
    .gte("event_date", startDate)
    .lte("event_date", endDate);

  if (error) return json({ mode: "seed_from_events", error: error.message }, 502);

  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  let noMetro = 0;
  let notWeekend = 0;

  for (const e of (data ?? []) as any[]) {
    const ymdDate: string = e.event_date;
    if (!isWeekendGetawayYmd(ymdDate)) {
      notWeekend++;
      continue;
    }
    const city: string = e.venues?.city ?? "";
    const metro = getMetroByCity(city);
    if (!metro) {
      noMetro++;
      continue;
    }
    const tmId = `event:${e.id}`;
    if (seen.has(tmId)) continue;
    seen.add(tmId);
    const artist: string = e.artists?.name || e.name || "Live show";
    rows.push({
      tm_event_id: tmId,
      artist,
      event_name: e.name ?? artist,
      metro_slug: metro.slug,
      city: city || metro.cities?.[0] || metro.label,
      venue: e.venues?.name ?? null,
      event_date: ymdDate,
      genre: null,
      ticket_url: e.ticket_url ?? null,
      image_url: e.image_url ?? null,
      min_price: e.min_price ?? null,
      max_price: e.max_price ?? null,
      score: 55,
    });
  }

  const runIso = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, active: true, refreshed_at: runIso, updated_at: runIso }));
  const errors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const { error: upErr } = await supabase
      .from("discovery_shows")
      .upsert(chunk, { onConflict: "tm_event_id", ignoreDuplicates: false });
    if (upErr) errors.push(upErr.message);
    else upserted += chunk.length;
  }

  return json({
    mode: "seed_from_events",
    window: { startDate, endDate },
    candidates: (data ?? []).length,
    seeded: rows.length,
    skipped_not_weekend: notWeekend,
    skipped_no_metro: noMetro,
    upserted,
    error_count: errors.length,
    errors,
    elapsed_ms: Date.now() - started,
  });
}
