/**
 * refresh-stale — Background job to keep itineraries fresh.
 *
 * Finds up to MAX_BATCH itineraries that were last updated more than
 * STALE_DAYS ago, re-runs the search with future-shifted dates, then
 * calls generate-itinerary to update result_json.
 *
 * Called weekly by the GitHub Actions cron in
 * .github/workflows/refresh-stale-itineraries.yml
 *
 * Requires: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STALE_DAYS = 7;
// Supabase edge functions time out at ~150s. Each itinerary requires a search
// call (~10s) + a generate-itinerary/Perplexity call (~30s) = ~40s per item.
// MAX_BATCH of 3 leaves a safe margin: 3 × 40s = 120s worst case.
// The weekly cron compensates for the lower batch size by running every week.
const MAX_BATCH = 3;

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

/** Shift a YYYY-MM-DD date forward by N days. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Return future-shifted start/end dates for a stale itinerary.
 *  Preserves the original trip duration; always starts at least 14 days out. */
function futureDates(startDate: string | null, endDate: string | null): { start: string; end: string } {
  const minStart = new Date();
  minStart.setDate(minStart.getDate() + 14);
  const minStartStr = minStart.toISOString().slice(0, 10);

  if (!startDate || !endDate) {
    return { start: minStartStr, end: addDays(minStartStr, 2) };
  }

  const origStart = new Date(startDate + "T12:00:00");
  const origEnd = new Date(endDate + "T12:00:00");
  const tripDays = Math.max(2, Math.round((origEnd.getTime() - origStart.getTime()) / 86_400_000));

  if (startDate >= minStartStr) {
    // Dates are still in the future — no shift needed
    return { start: startDate, end: endDate };
  }

  return { start: minStartStr, end: addDays(minStartStr, tripDays) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Find stale itineraries that were successfully generated and have a city
  const { data: staleRows, error: queryError } = await supabase
    .from("itineraries")
    .select("id, city, start_date, end_date, budget_tier, group_size, event_details, preferences")
    .eq("status", "generated")
    .lt("updated_at", staleCutoff)
    .not("city", "is", null)
    .order("updated_at", { ascending: true })
    .limit(MAX_BATCH);

  if (queryError) {
    console.error("[refresh-stale] query error:", queryError.message);
    return json({ error: queryError.message }, 500);
  }

  const rows = staleRows ?? [];
  console.log(`[refresh-stale] found ${rows.length} stale itinerary/itineraries (cutoff: ${staleCutoff})`);

  if (rows.length === 0) {
    return json({ refreshed: 0, skipped: 0, errors: [] });
  }

  const results: { id: string; status: "refreshed" | "skipped" | "error"; reason?: string }[] = [];

  for (const row of rows) {
    const { start, end } = futureDates(
      row.start_date ? String(row.start_date).slice(0, 10) : null,
      row.end_date   ? String(row.end_date).slice(0, 10)   : null
    );

    const city = (row.city === "flexible" ? "Austin" : row.city) ?? "Austin";
    const prefs = (row.preferences ?? {}) as Record<string, unknown>;
    const eventDetails = typeof row.event_details === "string" ? row.event_details.trim() : "";
    const artist =
      eventDetails.length > 0 && eventDetails.length < 80 && !eventDetails.toLowerCase().startsWith("genres:")
        ? eventDetails
        : undefined;

    // Build search URL
    const searchParams = new URLSearchParams({
      city,
      start_date: start,
      end_date: end,
      budget_tier: row.budget_tier ?? "mid",
      group_size: String(row.group_size ?? 2),
    });
    if (artist) searchParams.set("artist", artist);
    if (typeof prefs.state === "string") searchParams.set("state", prefs.state);

    try {
      // Step 1: re-run search with future dates
      const searchRes = await fetch(`${supabaseUrl}/functions/v1/search?${searchParams}`, {
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        signal: AbortSignal.timeout(20_000),
      });
      if (!searchRes.ok) {
        const text = await searchRes.text();
        throw new Error(`search returned ${searchRes.status}: ${text.slice(0, 200)}`);
      }
      const searchData = await searchRes.json() as {
        events?: unknown[];
        golf_courses?: unknown[];
        hotels?: unknown[];
        bronze_golf_candidates?: unknown[];
        silver_golf_candidates?: unknown[];
        gold_golf_candidates?: unknown[];
      };

      // Step 2: regenerate itinerary
      const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({
          itinerary_id: row.id,
          payload: {
            search_results: {
              events:                   searchData.events,
              golf_courses:             searchData.golf_courses,
              hotels:                   searchData.hotels,
              bronze_golf_candidates:   searchData.bronze_golf_candidates,
              silver_golf_candidates:   searchData.silver_golf_candidates,
              gold_golf_candidates:     searchData.gold_golf_candidates,
            },
          },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!genRes.ok) {
        const text = await genRes.text();
        throw new Error(`generate-itinerary returned ${genRes.status}: ${text.slice(0, 200)}`);
      }

      // Update start_date / end_date on the itinerary so it reflects the new window
      await supabase
        .from("itineraries")
        .update({ start_date: start, end_date: end })
        .eq("id", row.id);

      console.log(`[refresh-stale] ✓ refreshed ${row.id} (${city}, ${start}–${end})`);
      results.push({ id: row.id, status: "refreshed" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[refresh-stale] ✗ error on ${row.id}:`, msg);
      results.push({ id: row.id, status: "error", reason: msg });
    }
  }

  const refreshed = results.filter((r) => r.status === "refreshed").length;
  const errors = results.filter((r) => r.status === "error");
  console.log(`[refresh-stale] done — refreshed=${refreshed} errors=${errors.length}`);
  return json({ refreshed, skipped: rows.length - results.length, errors });
});
