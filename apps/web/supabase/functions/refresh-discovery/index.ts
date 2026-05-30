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
import { METROS } from "../_shared/golfCities.ts";
import {
  fetchNationwideDiscoveryShows,
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

// Genres to keep cached. Covers the signup genre chips plus golf-audience
// staples. classificationName values use Ticketmaster's genre vocabulary.
const REFRESH_GENRES = [
  "Country",
  "Rock",
  "Pop",
  "Hip-Hop/Rap",
  "R&B",
  "Latin",
  "Dance/Electronic",
  "Alternative",
  "Classic Rock",
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

  let body: { dry_run?: boolean; pages?: number } = {};
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

  const started = Date.now();
  let rows: DiscoveryShowRow[] = [];
  try {
    rows = await fetchNationwideDiscoveryShows({
      metros: METROS,
      startDate,
      endDate,
      genreTokens: REFRESH_GENRES,
      pagesPerGenre,
    });
  } catch (err) {
    return json({ error: `Discovery fetch failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  if (dryRun) {
    return json({
      dry_run: true,
      window: { startDate, endDate },
      fetched: rows.length,
      sample: rows.slice(0, 10).map((r) => ({ date: r.event_date, artist: r.artist, city: r.city, genre: r.genre, score: r.score })),
      elapsed_ms: Date.now() - started,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

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
    upserted,
    pruned_past: deletedPast ?? 0,
    deactivated_stale: deactivated ?? 0,
    error_count: errors.length,
    errors,
    elapsed_ms: Date.now() - started,
  });
});
