/**
 * backfill-demand — one-off operator job that computes a Ticketmaster-derived
 * demand score for each artist and writes it to artists.ticketmaster_demand_score.
 *
 * Spotify popularity is unavailable to our API app, so "top artist / high
 * demand" is proxied from Ticketmaster signals per artist:
 *   - tour breadth: number of upcoming US events (events page.totalElements)
 *   - venue size tier: largest venue across their upcoming events
 *   - ticket price: max price range seen
 * Combined into a 0-100 score. Idempotent and safe to re-run.
 *
 * Runs server-side so it can read the existing TICKETMASTER_CONSUMER_KEY secret
 * (same one search/verify-packages use) without anyone pasting it.
 *
 * Auth: pass header `x-run-token: <BACKFILL_DEMAND_TOKEN>` (a secret set just
 * for this job). Deployed with --no-verify-jwt; the token guard protects it.
 *
 * Query:
 *   ?dry_run=1     report only, no DB writes
 *   ?limit=N       cap how many distinct artist names to process
 *   ?refresh=1     re-score everyone (default: only artists with NULL score)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const RATE_PER_SEC = 5;
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-run-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

let nextSlot = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

async function tmGet(apiKey: string, path: string, params: Record<string, string>) {
  await throttle();
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res = await fetch(`${TM_BASE}/${path}?${qs}`);
  if (res.status === 429) {
    await sleep(1500);
    return tmGet(apiKey, path, params);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TM ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.json();
}

function venueTierPoints(venueName: string | undefined): number {
  const n = (venueName || "").toLowerCase();
  if (/stadium|field|ballpark/.test(n)) return 30;
  if (/arena|center|centre|garden|forum|sphere|coliseum|colosseum/.test(n)) return 22;
  if (/amphitheat(er|re)|pavilion|outdoor|lawn/.test(n)) return 14;
  if (/theat(er|re)|hall|auditorium|opera|music center/.test(n)) return 8;
  return 4;
}

function pricePoints(maxPrice: number | null): number {
  if (maxPrice == null) return 0;
  if (maxPrice >= 400) return 20;
  if (maxPrice >= 250) return 15;
  if (maxPrice >= 150) return 10;
  if (maxPrice >= 75) return 5;
  return 2;
}

function datesPoints(totalUpcoming: number): number {
  return Math.min(Math.max(totalUpcoming, 0), 50);
}

function computeScore(totalUpcoming: number, maxVenuePts: number, maxPrice: number | null): number {
  const raw = datesPoints(totalUpcoming) + maxVenuePts + pricePoints(maxPrice);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

async function resolveAttractionId(apiKey: string, name: string): Promise<string | null> {
  const data = await tmGet(apiKey, "attractions.json", {
    keyword: name,
    size: "10",
    sort: "relevance,desc",
  });
  // deno-lint-ignore no-explicit-any
  const items: any[] = data?._embedded?.attractions ?? [];
  if (items.length === 0) return null;
  const norm = (s: string) => (s || "").trim().toLowerCase();
  // deno-lint-ignore no-explicit-any
  const isMusic = (a: any) =>
    (a.classifications ?? []).some((c: any) => /music/i.test(c?.segment?.name ?? ""));
  const exactMusic = items.find((a) => norm(a.name) === norm(name) && isMusic(a));
  const exact = items.find((a) => norm(a.name) === norm(name));
  const music = items.find(isMusic);
  const best = exactMusic || exact || music || items[0];
  return best?.id ?? null;
}

async function gatherSignals(apiKey: string, attractionId: string) {
  const nowIso = new Date().toISOString().slice(0, 19) + "Z";
  const data = await tmGet(apiKey, "events.json", {
    attractionId,
    countryCode: "US",
    size: "100",
    sort: "date,asc",
    startDateTime: nowIso,
  });
  const totalUpcoming = data?.page?.totalElements ?? 0;
  // deno-lint-ignore no-explicit-any
  const events: any[] = data?._embedded?.events ?? [];
  let maxVenuePts = 4;
  let maxPrice: number | null = null;
  for (const ev of events) {
    maxVenuePts = Math.max(maxVenuePts, venueTierPoints(ev?._embedded?.venues?.[0]?.name));
    for (const pr of ev?.priceRanges ?? []) {
      const m = Number(pr?.max);
      if (Number.isFinite(m)) maxPrice = Math.max(maxPrice ?? 0, m);
    }
  }
  return { totalUpcoming, maxVenuePts, maxPrice };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expectedToken = Deno.env.get("BACKFILL_DEMAND_TOKEN");
  if (!expectedToken) return json({ error: "BACKFILL_DEMAND_TOKEN not configured" }, 500);
  if (req.headers.get("x-run-token") !== expectedToken) {
    return json({ error: "Unauthorized — bad or missing x-run-token" }, 401);
  }

  const apiKey =
    Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY");
  if (!apiKey) return json({ error: "TICKETMASTER_API_KEY / TICKETMASTER_CONSUMER_KEY not set" }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Missing Supabase env" }, 500);

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const refresh = url.searchParams.get("refresh") === "1";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : Infinity;

  const sb = createClient(supabaseUrl, serviceKey);

  let q = sb.from("artists").select("name, ticketmaster_demand_score").not("name", "is", null);
  if (!refresh) q = q.is("ticketmaster_demand_score", null);
  const { data: artistRows, error: qErr } = await q;
  if (qErr) return json({ error: qErr.message }, 500);

  const distinctNames = [...new Set(
    (artistRows ?? [])
      .map((r) => (r as { name: string }).name?.trim())
      .filter((n): n is string => Boolean(n))
  )].sort();
  const names = distinctNames.slice(0, limit === Infinity ? distinctNames.length : limit);

  const result = {
    dry_run: dryRun,
    refresh,
    distinct_names: distinctNames.length,
    processed: 0,
    scored: 0,
    no_attraction: 0,
    rows_updated: 0,
    errors: 0,
    no_attraction_names: [] as string[],
    error_samples: [] as string[],
    top_preview: [] as Array<{ name: string; score: number; upcoming: number; venue_pts: number; max_price: number | null }>,
  };

  for (const name of names) {
    try {
      const attractionId = await resolveAttractionId(apiKey, name);
      if (!attractionId) {
        result.no_attraction++;
        if (result.no_attraction_names.length < 50) result.no_attraction_names.push(name);
      } else {
        const sig = await gatherSignals(apiKey, attractionId);
        const score = computeScore(sig.totalUpcoming, sig.maxVenuePts, sig.maxPrice);
        result.scored++;
        result.top_preview.push({
          name,
          score,
          upcoming: sig.totalUpcoming,
          venue_pts: sig.maxVenuePts,
          max_price: sig.maxPrice,
        });
        if (!dryRun) {
          const { error: upErr, count } = await sb
            .from("artists")
            .update(
              { ticketmaster_demand_score: score, demand_synced_at: new Date().toISOString() },
              { count: "exact" }
            )
            .eq("name", name);
          if (upErr) throw new Error(upErr.message);
          result.rows_updated += count ?? 0;
        }
      }
    } catch (err) {
      result.errors++;
      const msg = `${name}: ${err instanceof Error ? err.message : String(err)}`;
      if (result.error_samples.length < 20) result.error_samples.push(msg);
      console.error(`[backfill-demand] ${msg}`);
    }
    result.processed++;
  }

  result.top_preview.sort((a, b) => b.score - a.score);
  result.top_preview = result.top_preview.slice(0, 20);

  console.log(
    `[backfill-demand] done dry_run=${dryRun} processed=${result.processed} scored=${result.scored} ` +
    `rows_updated=${result.rows_updated} no_attraction=${result.no_attraction} errors=${result.errors}`
  );
  return json(result);
});
