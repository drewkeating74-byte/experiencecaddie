/**
 * refresh-hot-artists — weekly Perplexity scan of music media → hot_artists cache.
 *
 * PURPOSE
 * -------
 * Genre / surprise discovery in generate-itinerary reads public.hot_artists to
 * seed and re-rank culturally hot artists, then proves nearby tour inventory via
 * discovery_shows / Ticketmaster. This job refreshes that cache on a weekly
 * schedule so user-facing discovery never waits on a live media scan.
 *
 * HOW TO CALL
 * -----------
 *   POST /functions/v1/refresh-hot-artists
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   Body (optional): { "dry_run": true }
 *
 * CADENCE: weekly (GitHub Actions cron → see .github/workflows/refresh-hot-artists.yml)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { askPerplexityJson } from "../_shared/perplexity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOT_ARTISTS_SCHEMA = {
  name: "hot_artists_scan",
  schema: {
    type: "object",
    properties: {
      artists: {
        type: "array",
        items: {
          type: "object",
          properties: {
            artist: { type: "string" },
            genres: { type: "array", items: { type: "string" } },
            sources: { type: "array", items: { type: "string" } },
            signal_types: { type: "array", items: { type: "string" } },
            evidence: { type: "string" },
          },
          required: ["artist", "genres", "sources", "signal_types", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["artists"],
    additionalProperties: false,
  },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Concert genre chips — keep in sync with apps/web/src/config/concertGenres.ts */
const CONCERT_GENRES = [
  "Country",
  "Rock",
  "Classic Rock",
  "Pop",
  "Alternative",
  "Indie",
  "Jam Band",
  "Americana",
  "Folk",
  "Latin",
  "EDM",
  "Blues",
] as const;

const ALLOWED_SOURCES = new Set([
  "rolling_stone",
  "spin",
  "billboard",
  "pitchfork",
  "npr_music",
  "resident_advisor",
]);

const ALLOWED_SIGNALS = new Set([
  "tour_album",
  "chart",
  "critical",
  "award",
  "viral",
]);

/** Touring-relevance weights from the What's Hot plan. */
const SIGNAL_WEIGHTS: Record<string, number> = {
  tour_album: 1.0,
  chart: 0.75,
  critical: 0.6,
  award: 0.4,
  viral: 0.25,
};

type RawHotArtist = {
  artist?: string;
  artist_name?: string;
  genres?: string[];
  sources?: string[];
  signal_types?: string[];
  evidence?: string | { outlet?: string; blurb?: string; url?: string };
};

type HotArtistRow = {
  artist_key: string;
  artist_name: string;
  genres: string[];
  sources: string[];
  signal_types: string[];
  source_count: number;
  heat_score: number;
  evidence: Array<{ outlet?: string; blurb?: string; url?: string }>;
  active: boolean;
  refreshed_at: string;
  updated_at: string;
};

function normalizeArtistKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugSource(raw: string): string | null {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const aliases: Record<string, string> = {
    rollingstone: "rolling_stone",
    rolling_stone: "rolling_stone",
    rs: "rolling_stone",
    spin: "spin",
    billboard: "billboard",
    pitchfork: "pitchfork",
    npr: "npr_music",
    npr_music: "npr_music",
    residentadvisor: "resident_advisor",
    resident_advisor: "resident_advisor",
    ra: "resident_advisor",
  };
  const mapped = aliases[s] ?? s;
  return ALLOWED_SOURCES.has(mapped) ? mapped : null;
}

function slugSignal(raw: string): string | null {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const aliases: Record<string, string> = {
    tour_album: "tour_album",
    tour: "tour_album",
    album: "tour_album",
    album_release: "tour_album",
    new_album: "tour_album",
    chart: "chart",
    charts: "chart",
    critical: "critical",
    critics: "critical",
    award: "award",
    awards: "award",
    viral: "viral",
  };
  const mapped = aliases[s] ?? s;
  return ALLOWED_SIGNALS.has(mapped) ? mapped : null;
}

function mapGenre(raw: string): string | null {
  const t = raw.toLowerCase().trim();
  if (!t) return null;
  const aliases: Record<string, string> = {
    country: "Country",
    rock: "Rock",
    "classic rock": "Classic Rock",
    classicrock: "Classic Rock",
    pop: "Pop",
    alternative: "Alternative",
    "alt rock": "Alternative",
    indie: "Indie",
    "indie rock": "Indie",
    "jam band": "Jam Band",
    jamband: "Jam Band",
    americana: "Americana",
    folk: "Folk",
    latin: "Latin",
    reggaeton: "Latin",
    edm: "EDM",
    electronic: "EDM",
    techno: "EDM",
    house: "EDM",
    dance: "EDM",
    blues: "Blues",
  };
  if (aliases[t]) return aliases[t];
  for (const g of CONCERT_GENRES) {
    if (g.toLowerCase() === t) return g;
  }
  return null;
}

function computeHeatScore(signalTypes: string[], sourceCount: number): number {
  const signalSum = signalTypes.reduce((sum, s) => sum + (SIGNAL_WEIGHTS[s] ?? 0), 0);
  const base = signalSum > 0 ? signalSum : 0.3;
  const multiSourceBoost = 1 + 0.25 * Math.max(0, sourceCount - 1);
  return Math.round(base * multiSourceBoost * 100) / 100;
}

function mergeArtist(into: HotArtistRow, from: HotArtistRow): HotArtistRow {
  const sources = [...new Set([...into.sources, ...from.sources])];
  const signal_types = [...new Set([...into.signal_types, ...from.signal_types])];
  const genres = [...new Set([...into.genres, ...from.genres])];
  const evidence = [...into.evidence, ...from.evidence].slice(0, 8);
  const source_count = sources.length;
  return {
    ...into,
    genres,
    sources,
    signal_types,
    source_count,
    heat_score: computeHeatScore(signal_types, source_count),
    evidence,
  };
}

function toRow(raw: RawHotArtist, nowIso: string): HotArtistRow | null {
  const name = String(raw.artist_name || raw.artist || "").trim();
  if (!name || name.length < 2) return null;
  const artist_key = normalizeArtistKey(name);
  if (!artist_key) return null;

  const sources = [...new Set((raw.sources ?? []).map(slugSource).filter(Boolean))] as string[];
  const signal_types = [
    ...new Set((raw.signal_types ?? []).map(slugSignal).filter(Boolean)),
  ] as string[];
  const genres = [...new Set((raw.genres ?? []).map(mapGenre).filter(Boolean))] as string[];
  if (genres.length === 0) genres.push("Pop");

  let evidence: Array<{ outlet?: string; blurb?: string; url?: string }> = [];
  if (typeof raw.evidence === "string" && raw.evidence.trim()) {
    evidence = [{ blurb: raw.evidence.trim() }];
  } else if (raw.evidence && typeof raw.evidence === "object") {
    evidence = [raw.evidence];
  }

  const source_count = Math.max(1, sources.length);
  if (signal_types.length === 0) signal_types.push("critical");

  return {
    artist_key,
    artist_name: name,
    genres,
    sources,
    signal_types,
    source_count,
    heat_score: computeHeatScore(signal_types, source_count),
    evidence,
    active: true,
    refreshed_at: nowIso,
    updated_at: nowIso,
  };
}

async function fetchHotArtistsFromPerplexity(apiKey: string): Promise<RawHotArtist[]> {
  const genreList = CONCERT_GENRES.join(", ");
  const prompt = `Scan current US music coverage from Rolling Stone, Spin, Billboard, Pitchfork, NPR Music, and Resident Advisor.

Return artists that are culturally hot RIGHT NOW in a way that matters for live touring demand over the next 6 months (new album + tour buzz, chart momentum, sustained critical buzz, award buzz). Deprioritize one-day viral moments with no tour relevance.

Cover a mix of genres relevant to these chips: ${genreList}.
Use Pitchfork for Indie/Alternative, Resident Advisor for EDM, Billboard/Rolling Stone/Spin for mainstream Pop/Rock/Country, NPR Music for broad critical coverage.

Return 25-40 artists in the artists array. Each object:
- artist: Exact artist name
- genres: chip genres from the list above
- sources: from rolling_stone, spin, billboard, pitchfork, npr_music, resident_advisor
- signal_types: from tour_album, chart, critical, award, viral
- evidence: One short sentence citing the buzz

Rules:
- Prefer artists that appear on multiple outlets when possible
- US-relevant touring acts only
- Never invent outlet attributions`;

  const parsed = await askPerplexityJson<{ artists?: RawHotArtist[] }>({
    apiKey,
    preset: "low",
    legacyModel: "sonar-pro",
    instructions:
      "You are a music-culture research assistant. Return only valid JSON. Never invent outlet attributions.",
    input: prompt,
    schema: HOT_ARTISTS_SCHEMA,
    temperature: 0.2,
    maxOutputTokens: 4096,
  });

  return Array.isArray(parsed.artists) ? parsed.artists : [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json({ error: "Unauthorized — authorization header required" }, 401);

  let body: { dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body ok
  }
  const dryRun = body.dry_run === true;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  if (!perplexityKey) {
    // Soft-fail: keep prior week active so discovery still works.
    console.warn("[HOT] PERPLEXITY_API_KEY missing — keeping prior hot_artists rows");
    return json({
      success: true,
      skipped: true,
      reason: "PERPLEXITY_API_KEY not configured",
      kept_prior: true,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const runStartedAt = new Date().toISOString();

  let rawList: RawHotArtist[];
  try {
    rawList = await fetchHotArtistsFromPerplexity(perplexityKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[HOT] Perplexity scan failed — keeping prior rows:", msg);
    return json({
      success: true,
      skipped: true,
      reason: msg,
      kept_prior: true,
    });
  }

  const refreshedAt = new Date().toISOString();
  const byKey = new Map<string, HotArtistRow>();
  for (const raw of rawList) {
    const row = toRow(raw, refreshedAt);
    if (!row) continue;
    const existing = byKey.get(row.artist_key);
    byKey.set(row.artist_key, existing ? mergeArtist(existing, row) : row);
  }

  const rows = [...byKey.values()].sort((a, b) => b.heat_score - a.heat_score);
  console.log(`[HOT] parsed=${rawList.length} unique=${rows.length} dry_run=${dryRun}`);

  if (dryRun) {
    return json({
      success: true,
      dry_run: true,
      parsed: rawList.length,
      unique: rows.length,
      sample: rows.slice(0, 10).map((r) => ({
        artist: r.artist_name,
        heat_score: r.heat_score,
        sources: r.sources,
        signal_types: r.signal_types,
        genres: r.genres,
      })),
    });
  }

  if (rows.length === 0) {
    console.warn("[HOT] empty parse — keeping prior rows");
    return json({
      success: true,
      skipped: true,
      reason: "empty_parse",
      kept_prior: true,
    });
  }

  const { error: upsertError } = await supabase
    .from("hot_artists")
    .upsert(rows, { onConflict: "artist_key" });

  if (upsertError) {
    console.error("[HOT] upsert failed:", upsertError.message);
    return json({
      success: true,
      skipped: true,
      reason: `upsert_failed: ${upsertError.message}`,
      kept_prior: true,
    });
  }

  // Anything not refreshed in this run is no longer hot — deactivate.
  // Also prune rows stale beyond 14 days as a safety net.
  const staleBefore = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { error: deactivateError } = await supabase
    .from("hot_artists")
    .update({ active: false, updated_at: refreshedAt })
    .eq("active", true)
    .or(`refreshed_at.lt."${runStartedAt}",refreshed_at.lt."${staleBefore}"`);

  if (deactivateError) {
    console.warn("[HOT] deactivate failed:", deactivateError.message);
  }

  return json({
    success: true,
    upserted: rows.length,
    deactivated_ok: !deactivateError,
    top: rows.slice(0, 5).map((r) => ({
      artist: r.artist_name,
      heat_score: r.heat_score,
      sources: r.sources,
    })),
  });
});
