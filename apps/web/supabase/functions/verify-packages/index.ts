/**
 * verify-packages — Periodic concert verification for catalog packages.
 *
 * For each active package with artist + city + event date:
 *   - Verify the show on the exact catalog date via Ticketmaster first.
 *   - If Ticketmaster cannot confirm it, ask Perplexity for sourced web confirmation.
 *   - First failed verification day → keep live, mark Needs Review.
 *   - Second failed verification day → hide from public and mark Failed Verification.
 *   - Past/expired packages are hidden immediately.
 *
 * Auth: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Query:
 *   ?suggest=1 — include metro_gaps (catalog metros with zero active curated packages).
 *   ?dry_run=1 — report only; no DB writes (use before a real run).
 *   ?backfill=1 — after verification, add verified curated replacements until 25 active rows.
 *   ?recover=1 — include inactive future packages and reactivate only if verified.
 *   ?strict_direct_tm=1 — require a direct Ticketmaster event URL from Ticketmaster resolution.
 *   ?require_venue_match=1 — also require catalog venue name to overlap TM venue tokens (stricter; off by default).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { METROS, getMetroByCity } from "../_shared/golfCities.ts";
import {
  buildGoogleTicketsSearchUrl,
  eventVenueBelongsToMetro,
  fetchTicketmasterEvents,
  isWeekendGetawayYmd,
  mapTmEventToResult,
  parseFlexibleDateToYmd,
  resolveConcertFromTicketmaster,
  tmEventMatchesGenreTokens,
  type TMEvent,
} from "../_shared/ticketmaster.ts";

const FAILURE_THRESHOLD = 2;
const PERPLEXITY_MODEL = "sonar-pro";
const BACKFILL_TARGET_ACTIVE_CURATED = 25;
const BACKFILL_MAX_CANDIDATES_PER_METRO = 40;
const BACKFILL_GENRES = ["country", "rock", "hip-hop", "rap", "pop"];
const BACKFILL_EXCLUDED_METROS = new Set(["san-antonio"]);
const WARM_WEATHER_METROS = new Set([
  "las-vegas",
  "phoenix",
  "dallas",
  "austin",
  "nashville",
  "atlanta",
  "charlotte",
  "tampa",
  "miami",
  "san-diego",
  "los-angeles",
  "new-orleans",
  "palm-springs",
  "orlando",
  "houston",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function toYmd(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function extractJson(raw: string): string {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  if (!cleaned.startsWith("{")) {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s !== -1 && e > s) cleaned = cleaned.slice(s, e + 1);
  }
  return cleaned;
}

/** True if at least one significant token overlaps (catches wrong venue on same night). */
function venuesRoughlyMatch(catalogVenue: string, ticketmasterVenue: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const a = words(catalogVenue);
  const b = words(ticketmasterVenue);
  if (a.length === 0 || b.length === 0) return true;
  const bset = new Set(b);
  return a.some((w) => bset.has(w));
}

async function updatePackage(
  sb: ReturnType<typeof createClient>,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await sb.from("packages").update(patch).eq("id", id);
  if (!error) return;
  const msg = error.message || "";
  const maybeMissingAudit =
    msg.includes("last_ticketmaster_check_at") ||
    msg.includes("ticketmaster_last_ok") ||
    msg.includes("verification_status") ||
    msg.includes("verification_fail_count") ||
    msg.includes("last_verification_at") ||
    msg.includes("last_verification_failed_at") ||
    msg.includes("last_verification_source") ||
    msg.includes("verification_notes") ||
    msg.includes("verification_evidence_url") ||
    (msg.includes("column") && msg.includes("does not exist"));
  if (maybeMissingAudit) {
    const minimal: Record<string, unknown> = {};
    if ("active" in patch) minimal.active = patch.active;
    if ("featured" in patch) minimal.featured = patch.featured;
    if (Object.keys(minimal).length === 0) {
      console.warn(`[verify-packages] audit columns missing; skipped audit-only write for ${id}`);
      return;
    }
    const { error: e2 } = await sb.from("packages").update(minimal).eq("id", id);
    if (e2) throw new Error(e2.message);
    console.warn(
      `[verify-packages] partial update (run package verification migrations before full audit writes): ${id}`
    );
    return;
  }
  throw new Error(msg);
}

type EventEmbed = {
  id: string;
  event_date: string;
  ticket_url: string | null;
  artists: { name: string } | null;
  venues: { name: string; city: string | null; state: string | null } | null;
} | null;

type PackageRow = {
  id: string;
  name: string;
  active: boolean | null;
  source: string;
  featured: boolean | null;
  event_id: string | null;
  event_date: string | null;
  artist_name: string | null;
  city: string | null;
  expires_at: string | null;
  verification_fail_count: number | null;
  last_verification_failed_at: string | null;
  events: EventEmbed | EventEmbed[] | null;
  destinations: { city: string | null; state: string | null } | null;
};

type BackfillGolfCourse = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  source_id?: string | null;
  public_access?: boolean | null;
  public_access_confidence?: string | null;
  course_type?: string | null;
  verification_status?: string | null;
  excluded_reason?: string | null;
  normalized_quality_score?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
};

type ActiveCuratedRow = {
  id: string;
  city: string | null;
  artist_name: string | null;
  events:
    | {
        source_id: string | null;
        event_date: string | null;
        artists: { name: string | null } | null;
      }
    | Array<{
        source_id: string | null;
        event_date: string | null;
        artists: { name: string | null } | null;
      }>
    | null;
};

type BackfillCandidate = {
  metro: (typeof METROS)[number];
  event: TMEvent;
  eventResult: ReturnType<typeof mapTmEventToResult>;
  artist: string;
  genre: string;
  subgenre: string;
  ymd: string;
  golfCourse: BackfillGolfCourse;
  score: number;
};

type BackfillResult = {
  enabled: boolean;
  target_active_curated: number;
  active_curated_before: number;
  gap: number;
  dry_run: boolean;
  candidates_considered: number;
  inserted: number;
  skipped: string[];
  selected: Array<{
    artist: string;
    city: string;
    date: string;
    venue: string;
    golf_course: string;
    dry_run: boolean;
  }>;
};

function embedEvent(row: PackageRow): EventEmbed {
  const e = row.events;
  if (e == null) return null;
  return Array.isArray(e) ? e[0] ?? null : e;
}

function embedActiveEvent(row: ActiveCuratedRow) {
  const e = row.events;
  if (e == null) return null;
  return Array.isArray(e) ? e[0] ?? null : e;
}

type ProviderSuccess = {
  source: "ticketmaster" | "perplexity";
  dateYmd: string;
  venue?: string;
  url?: string;
  ticketmaster?: Awaited<ReturnType<typeof resolveConcertFromTicketmaster>>;
};

type ProviderFailure = {
  reason: string;
  providerError?: boolean;
  ticketmasterVenue?: string;
};

function sameCalendarDay(a: string | null | undefined, bYmd: string): boolean {
  return toYmd(a) === bYmd;
}

function dateIsExpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return !Number.isNaN(t) && t <= nowMs;
}

function nextFailureCount(row: PackageRow, today: string): number {
  const current = Math.max(0, row.verification_fail_count ?? 0);
  return sameCalendarDay(row.last_verification_failed_at, today) ? current : current + 1;
}

async function verifyWithPerplexity(params: {
  apiKey: string;
  artist: string;
  city: string;
  eventYmd: string;
  venue?: string;
}): Promise<ProviderSuccess | null> {
  const venueLine = params.venue?.trim()
    ? `Expected venue if available: ${params.venue.trim()}`
    : "Venue may be omitted if the source does not name one.";
  const prompt = `Confirm whether this concert is happening on the exact requested date.

Artist/event: ${params.artist}
City/market: ${params.city}
Requested date: ${params.eventYmd}
${venueLine}

Return ONLY valid JSON. No markdown, no extra text.
If confirmed by a reliable source: {"confirmed":true,"date":"YYYY-MM-DD","venue":"exact venue name or Venue TBD","url":"source URL","evidence":"short source summary"}
If not confirmed on that exact date: {"confirmed":false,"evidence":"short reason"}

Rules:
- confirmed=true only when the same artist/event is happening in that city/market on the requested date.
- Do not guess or infer dates.
- A different date means confirmed=false.`;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: "Concert verification assistant. Return only valid JSON and never guess dates." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 256,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = String(data.choices?.[0]?.message?.content ?? "");
  const parsed = JSON.parse(extractJson(raw)) as {
    confirmed?: boolean;
    date?: string;
    venue?: string;
    url?: string;
  };

  if (!parsed.confirmed) return null;
  const ymd = parseFlexibleDateToYmd(parsed.date ?? "");
  if (ymd !== params.eventYmd) return null;

  const sourceUrl =
    typeof parsed.url === "string" && parsed.url.trim().startsWith("https://")
      ? parsed.url.trim()
      : buildGoogleTicketsSearchUrl({
          performer: params.artist,
          city: params.city,
          venue: typeof parsed.venue === "string" ? parsed.venue : undefined,
          dateYmd: params.eventYmd,
        });

  return {
    source: "perplexity",
    dateYmd: ymd,
    venue: typeof parsed.venue === "string" ? parsed.venue.trim() : undefined,
    url: sourceUrl,
  };
}

async function verifyPackageConcert(params: {
  artist: string;
  city: string;
  eventYmd: string;
  packageVenue?: string;
  strictDirectTm: boolean;
  requireVenueMatch: boolean;
  perplexityKey: string | null;
}): Promise<{ success: ProviderSuccess | null; failure?: ProviderFailure }> {
  const winStart = addCalendarDaysYmd(params.eventYmd, -90);
  const winEnd = addCalendarDaysYmd(params.eventYmd, 90);

  let resolved: Awaited<ReturnType<typeof resolveConcertFromTicketmaster>> = null;
  try {
    resolved = await resolveConcertFromTicketmaster({
      artist: params.artist,
      city: params.city,
      startDate: winStart,
      endDate: winEnd,
      dateHintYmd: params.eventYmd,
    });
  } catch (e) {
    console.error("[verify-packages] Ticketmaster error:", e);
  }

  const resolvedYmd = resolved ? resolved.date_time.slice(0, 10) : null;
  let tmReason =
    resolved == null
      ? "no matching Ticketmaster event in window"
      : `Ticketmaster date ${resolvedYmd} !== package ${params.eventYmd}`;
  let tmOk = Boolean(resolved && resolvedYmd === params.eventYmd);

  if (params.requireVenueMatch && tmOk && resolved) {
    const tmVenue = resolved.venue?.name?.trim() ?? "";
    const pkgVenue = params.packageVenue?.trim() ?? "";
    if (pkgVenue.length > 3 && tmVenue.length > 3 && !venuesRoughlyMatch(pkgVenue, tmVenue)) {
      tmOk = false;
      tmReason = `venue mismatch: catalog "${pkgVenue}" vs Ticketmaster "${tmVenue}"`;
    }
  }
  if (tmOk && resolved && params.strictDirectTm && resolved.book_link?.link_type !== "direct_event") {
    tmOk = false;
    tmReason = "no direct Ticketmaster event URL (strict_direct_tm)";
  }

  if (tmOk && resolved) {
    return {
      success: {
        source: "ticketmaster",
        dateYmd: params.eventYmd,
        venue: resolved.venue?.name,
        url: resolved.book_url,
        ticketmaster: resolved,
      },
    };
  }

  if (!params.perplexityKey) {
    return {
      success: null,
      failure: {
        reason: `${tmReason}; Perplexity not configured`,
        providerError: true,
        ticketmasterVenue: resolved?.venue?.name,
      },
    };
  }

  try {
    const p = await verifyWithPerplexity({
      apiKey: params.perplexityKey,
      artist: params.artist,
      city: params.city,
      eventYmd: params.eventYmd,
      venue: params.packageVenue,
    });
    if (p) return { success: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: null,
      failure: {
        reason: `${tmReason}; Perplexity error: ${msg}`,
        providerError: true,
        ticketmasterVenue: resolved?.venue?.name,
      },
    };
  }

  return {
    success: null,
    failure: {
      reason: `${tmReason}; Perplexity did not confirm exact date`,
      ticketmasterVenue: resolved?.venue?.name,
    },
  };
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsYmd(ymd: string, months: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function sqlishEscapeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function stableUuid(seed: string): Promise<string> {
  const bytes = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function monthFromYmd(ymd: string): number {
  return Number(ymd.slice(5, 7));
}

function isSeasonallyPlayable(metro: (typeof METROS)[number], ymd: string): boolean {
  if (WARM_WEATHER_METROS.has(metro.slug)) return true;
  const month = monthFromYmd(ymd);
  if (metro.region === "Midwest" || metro.region === "Northeast") {
    return month >= 5 && month <= 9;
  }
  if (metro.slug === "denver" || metro.slug === "seattle" || metro.slug === "portland") {
    return month >= 5 && month <= 10;
  }
  return month >= 4 && month <= 10;
}

function excludedEventName(name: string): boolean {
  return /parking|upgrade|club access|vip|lounge|fast lane|testing|do not purchase|parkwhiz|add-on|2-day ticket|cannot split|suite|premium|pass/i.test(
    name
  );
}

function venueTypeFromName(name: string): string {
  if (/stadium|field|park/i.test(name)) return "stadium";
  if (/arena|center|centre|garden|forum|sphere/i.test(name)) return "arena";
  if (/amphitheat(er|re)|outdoors|fairgrounds/i.test(name)) return "amphitheater";
  return "theater";
}

function eventArtistName(event: TMEvent): string {
  return event._embedded?.attractions?.[0]?.name?.trim() || event.name?.trim() || "Concert";
}

function eventGenre(event: TMEvent): { genre: string; subgenre: string } {
  const c = event.classifications?.[0];
  const rawGenre = c?.genre?.name ?? c?.segment?.name ?? "";
  const rawSubgenre = c?.subGenre?.name ?? rawGenre;
  const blob = `${rawGenre} ${rawSubgenre} ${event.name ?? ""}`.toLowerCase();
  if (blob.includes("country")) return { genre: "Country", subgenre: rawSubgenre || "Country" };
  if (blob.includes("hip-hop") || blob.includes("hip hop") || blob.includes("rap")) {
    return { genre: "Hip-Hop", subgenre: rawSubgenre || "Rap" };
  }
  if (blob.includes("rock") || blob.includes("metal") || blob.includes("alternative")) {
    return { genre: "Rock", subgenre: rawSubgenre || "Rock" };
  }
  return { genre: "Pop", subgenre: rawSubgenre || "Pop" };
}

function scoreGolfCourse(course: BackfillGolfCourse): number {
  const publicBoost =
    course.public_access === true || course.course_type === "public" || course.public_access_confidence === "likely_public"
      ? 1000
      : 0;
  return (
    publicBoost +
    (course.normalized_quality_score ?? 0) * 10 +
    (course.rating ?? 0) * 20 +
    Math.min(course.user_rating_count ?? 0, 1000) / 10
  );
}

function isUsableGolfCourse(course: BackfillGolfCourse): boolean {
  if (!course.id || !course.name?.trim()) return false;
  if (/topgolf|mini|putt|disc|simulator|driving range/i.test(course.name)) return false;
  if (/military|naval|navy|marine corps|air force|army|coast guard|\bbase\b|\bmwr\b|\bdod\b|camp pendleton|miramar|sea 'n air|sea n air/i.test(course.name)) return false;
  if (course.excluded_reason) return false;
  if (!["verified", "unreviewed"].includes(course.verification_status ?? "unreviewed")) return false;
  if (course.public_access_confidence === "likely_private") return false;
  if (["private", "semi_private", "resort", "military"].includes(course.course_type ?? "")) return false;
  return (
    course.public_access === true ||
    course.course_type === "public" ||
    course.course_type === "municipal" ||
    course.public_access_confidence === "likely_public"
  );
}

async function bestGolfCourseForMetro(
  sb: ReturnType<typeof createClient>,
  metroSlug: string
): Promise<BackfillGolfCourse | null> {
  const selectFull =
    "id, name, city, state, source_id, public_access, public_access_confidence, course_type, verification_status, excluded_reason, normalized_quality_score, rating, user_rating_count";
  const selectFallback = "id, name, city, state, source_id";

  let { data, error } = await sb
    .from("golf_courses")
    .select(selectFull)
    .eq("active", true)
    .eq("metro", metroSlug)
    .in("verification_status", ["verified", "unreviewed"])
    .in("public_access_confidence", ["likely_public", "unknown"])
    .or("course_type.is.null,course_type.not.in.(private,semi_private,resort,military)")
    .limit(30);

  if (error) {
    console.warn(`[verify-packages] full golf query failed for ${metroSlug}; retrying minimal: ${error.message}`);
    const retry = await sb
      .from("golf_courses")
      .select(selectFallback)
      .eq("active", true)
      .eq("metro", metroSlug)
      .limit(30);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.warn(`[verify-packages] golf query failed for ${metroSlug}: ${error.message}`);
    return null;
  }

  const usable = ((data ?? []) as BackfillGolfCourse[]).filter(isUsableGolfCourse);
  if (usable.length === 0) return null;
  return usable.sort((a, b) => scoreGolfCourse(b) - scoreGolfCourse(a))[0];
}

function candidateScore(candidate: BackfillCandidate, cityCounts: Map<string, number>): number {
  const venue = candidate.eventResult.venue.name;
  const venueBoost = /stadium|field|arena|center|garden|forum|sphere|amphitheat/i.test(venue) ? 50 : 0;
  const imageBoost = candidate.eventResult.image_url ? 30 : 0;
  const priceBoost = candidate.eventResult.price_min != null || candidate.eventResult.price_max != null ? 10 : 0;
  const cityPenalty = (cityCounts.get(candidate.metro.slug) ?? 0) * 40;
  const warmWinterBoost = WARM_WEATHER_METROS.has(candidate.metro.slug) && monthFromYmd(candidate.ymd) >= 10 ? 35 : 0;
  return candidate.score + venueBoost + imageBoost + priceBoost + warmWinterBoost - cityPenalty;
}

async function getActiveCuratedContext(sb: ReturnType<typeof createClient>) {
  const { data, error } = await sb
    .from("packages")
    .select("id, city, artist_name, events(source_id, event_date, artists(name))")
    .eq("active", true)
    .eq("source", "curated");

  if (error) throw new Error(`active curated query failed: ${error.message}`);

  const existingTmIds = new Set<string>();
  const existingArtistDateCity = new Set<string>();
  const cityCounts = new Map<string, number>();

  for (const raw of (data ?? []) as ActiveCuratedRow[]) {
    const ev = embedActiveEvent(raw);
    const sourceId = ev?.source_id?.trim();
    if (sourceId) existingTmIds.add(sourceId);

    const artist = (ev?.artists?.name || raw.artist_name || "").toLowerCase().trim();
    const city = (raw.city || "").toLowerCase().trim();
    const ymd = toYmd(ev?.event_date);
    if (artist && city && ymd) existingArtistDateCity.add(`${artist}|${city}|${ymd}`);

    const metro = getMetroByCity(raw.city);
    if (metro) cityCounts.set(metro.slug, (cityCounts.get(metro.slug) ?? 0) + 1);
  }

  return {
    rows: (data ?? []) as ActiveCuratedRow[],
    existingTmIds,
    existingArtistDateCity,
    cityCounts,
  };
}

async function discoverBackfillCandidates(params: {
  sb: ReturnType<typeof createClient>;
  gap: number;
  existingTmIds: Set<string>;
  existingArtistDateCity: Set<string>;
  cityCounts: Map<string, number>;
  today: string;
}): Promise<{ candidates: BackfillCandidate[]; considered: number; skipped: string[] }> {
  const startDate = addDaysYmd(params.today, 14);
  const endDate = addMonthsYmd(startDate, 9);
  const skipped: string[] = [];
  const golfCache = new Map<string, BackfillGolfCourse | null>();

  const metroPool = METROS
    .filter((metro) => !BACKFILL_EXCLUDED_METROS.has(metro.slug))
    .sort((a, b) => {
      const countDiff = (params.cityCounts.get(a.slug) ?? 0) - (params.cityCounts.get(b.slug) ?? 0);
      if (countDiff !== 0) return countDiff;
      const warmDiff = Number(WARM_WEATHER_METROS.has(b.slug)) - Number(WARM_WEATHER_METROS.has(a.slug));
      if (warmDiff !== 0) return warmDiff;
      return a.label.localeCompare(b.label);
    });

  const settled = await Promise.allSettled(
    metroPool.map(async (metro) => {
      const events = await fetchTicketmasterEvents({
        startDate,
        endDate,
        size: BACKFILL_MAX_CANDIDATES_PER_METRO,
        dmaId: metro.ticketmasterDmaId,
        ...(!metro.ticketmasterDmaId ? { city: metro.cities[0], state: metro.state } : {}),
      });
      return { metro, events };
    })
  );

  const candidates: BackfillCandidate[] = [];

  for (const item of settled) {
    if (item.status !== "fulfilled") {
      skipped.push(`ticketmaster fetch failed: ${String(item.reason).slice(0, 160)}`);
      continue;
    }

    const { metro, events } = item.value;
    for (const event of events) {
      const ymd = event.dates?.start?.localDate ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      if (!isWeekendGetawayYmd(ymd)) continue;
      if (!isSeasonallyPlayable(metro, ymd)) continue;
      if (excludedEventName(event.name ?? "")) continue;
      if (!tmEventMatchesGenreTokens(event, BACKFILL_GENRES)) continue;
      if (!eventVenueBelongsToMetro(event._embedded?.venues?.[0], metro)) continue;

      const eventResult = mapTmEventToResult(event, metro.cities[0], metro.state);
      if (eventResult.book_link.link_type !== "direct_event") continue;
      if (!eventResult.image_url) continue;
      if (params.existingTmIds.has(eventResult.id)) continue;

      const artist = eventArtistName(event);
      const duplicateKey = `${artist.toLowerCase()}|${eventResult.venue.city.toLowerCase()}|${ymd}`;
      if (params.existingArtistDateCity.has(duplicateKey)) continue;

      if (!golfCache.has(metro.slug)) {
        golfCache.set(metro.slug, await bestGolfCourseForMetro(params.sb, metro.slug));
      }
      const golfCourse = golfCache.get(metro.slug);
      if (!golfCourse) {
        skipped.push(`no usable golf course for ${metro.label}`);
        continue;
      }

      const genre = eventGenre(event);
      candidates.push({
        metro,
        event,
        eventResult,
        artist,
        genre: genre.genre,
        subgenre: genre.subgenre,
        ymd,
        golfCourse,
        score: 0,
      });
    }
  }

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: candidateScore(candidate, params.cityCounts),
    }))
    .sort((a, b) => b.score - a.score);

  const selected: BackfillCandidate[] = [];
  const selectedTmIds = new Set<string>();
  const selectedMetros = new Set<string>();
  for (const c of scored) {
    if (selected.length >= params.gap) break;
    if (selectedTmIds.has(c.eventResult.id)) continue;
    if (selectedMetros.has(c.metro.slug) && selected.length + 1 < params.gap) continue;
    selected.push(c);
    selectedTmIds.add(c.eventResult.id);
    selectedMetros.add(c.metro.slug);
  }

  return { candidates: selected, considered: scored.length, skipped };
}

async function insertBackfillCandidate(
  sb: ReturnType<typeof createClient>,
  candidate: BackfillCandidate,
  nowIso: string
): Promise<void> {
  const eventId = candidate.eventResult.id;
  const destinationId = await stableUuid(`backfill:destination:${candidate.metro.slug}`);
  const artistId = await stableUuid(`backfill:artist:${candidate.artist.toLowerCase()}`);
  const venueId = await stableUuid(`backfill:venue:${eventId}`);
  const packageEventId = await stableUuid(`backfill:event:${eventId}`);
  const packageId = await stableUuid(`backfill:package:${eventId}`);
  const startDate = addDaysYmd(candidate.ymd, -1);
  const endDate = addDaysYmd(candidate.ymd, 1);
  const expiresAt = `${addDaysYmd(candidate.ymd, 2)}T23:59:59Z`;
  const price = Math.max(725, Math.round(((candidate.eventResult.price_min ?? 125) + 700) / 5) * 5);
  const venueCity = candidate.eventResult.venue.city || candidate.metro.cities[0];
  const venueState = candidate.eventResult.venue.state || candidate.metro.state;
  const packageName = `${candidate.artist} + ${candidate.golfCourse.name} | ${venueCity}, ${venueState}`;
  const description = sqlishEscapeText(
    `${candidate.eventResult.name} at ${candidate.eventResult.venue.name} anchors a mainstream ${candidate.genre.toLowerCase()} concert weekend in ${venueCity}, paired with a round at ${candidate.golfCourse.name}. The event is confirmed through Ticketmaster and the golf pairing fits the destination's seasonal golf window.`
  );

  const writes = [
    sb.from("destinations").upsert({
      id: destinationId,
      name: candidate.metro.label,
      city: candidate.metro.cities[0],
      state: candidate.metro.state,
      country: "US",
      lat: candidate.metro.center.lat,
      lng: candidate.metro.center.lng,
      description: `${candidate.metro.label} concert weekends paired with seasonally appropriate public golf.`,
      updated_at: nowIso,
    }),
    sb.from("artists").upsert({
      id: artistId,
      name: candidate.artist,
      genre: candidate.genre,
      subgenre: candidate.subgenre,
      description: `${candidate.artist} was added by the automated curated package backfill from Ticketmaster-backed event data.`,
      updated_at: nowIso,
    }),
    sb.from("venues").upsert({
      id: venueId,
      name: candidate.eventResult.venue.name,
      city: venueCity,
      state: venueState,
      country: "US",
      venue_type: venueTypeFromName(candidate.eventResult.venue.name),
      active: true,
      updated_at: nowIso,
    }),
  ];

  for (const write of writes) {
    const { error } = await write;
    if (error) throw new Error(error.message);
  }

  const { error: eventError } = await sb.from("events").upsert({
    id: packageEventId,
    name: candidate.eventResult.name,
    artist_id: artistId,
    venue_id: venueId,
    event_date: candidate.ymd,
    event_time: null,
    timezone: candidate.metro.timezone,
    ticket_url: candidate.eventResult.book_url,
    availability_status: "available",
    source_id: eventId,
    source_name: "ticketmaster",
    updated_at: nowIso,
  });
  if (eventError) throw new Error(eventError.message);

  const { error: packageError } = await sb.from("packages").upsert({
    id: packageId,
    name: packageName,
    event_id: packageEventId,
    golf_course_id: candidate.golfCourse.id,
    destination_id: destinationId,
    description,
    image_url: candidate.eventResult.image_url,
    price,
    original_price: price + 150,
    category: "Golf + Concert",
    featured: false,
    active: true,
    expires_at: expiresAt,
    package_start_date: startDate,
    package_end_date: endDate,
    source: "curated",
    artist_name: candidate.artist,
    city: venueCity,
    golf_course_name: candidate.golfCourse.name,
    verification_status: "verified",
    verification_fail_count: 0,
    last_verification_at: nowIso,
    last_verification_source: "ticketmaster",
    verification_notes: `Confirmed Ticketmaster event ${eventId} for ${candidate.eventResult.name} on ${candidate.ymd}.`,
    verification_evidence_url: candidate.eventResult.book_url,
    last_ticketmaster_check_at: nowIso,
    ticketmaster_last_ok: true,
    updated_at: nowIso,
  });
  if (packageError) throw new Error(packageError.message);
}

async function backfillCuratedPackages(params: {
  sb: ReturnType<typeof createClient>;
  dryRun: boolean;
  today: string;
  nowIso: string;
}): Promise<BackfillResult> {
  const context = await getActiveCuratedContext(params.sb);
  const activeBefore = context.rows.length;
  const gap = Math.max(0, BACKFILL_TARGET_ACTIVE_CURATED - activeBefore);
  const result: BackfillResult = {
    enabled: true,
    target_active_curated: BACKFILL_TARGET_ACTIVE_CURATED,
    active_curated_before: activeBefore,
    gap,
    dry_run: params.dryRun,
    candidates_considered: 0,
    inserted: 0,
    skipped: [],
    selected: [],
  };

  if (gap === 0) return result;

  const discovery = await discoverBackfillCandidates({
    sb: params.sb,
    gap,
    existingTmIds: context.existingTmIds,
    existingArtistDateCity: context.existingArtistDateCity,
    cityCounts: context.cityCounts,
    today: params.today,
  });
  result.candidates_considered = discovery.considered;
  result.skipped.push(...discovery.skipped.slice(0, 20));

  for (const candidate of discovery.candidates) {
    result.selected.push({
      artist: candidate.artist,
      city: candidate.eventResult.venue.city,
      date: candidate.ymd,
      venue: candidate.eventResult.venue.name,
      golf_course: candidate.golfCourse.name,
      dry_run: params.dryRun,
    });
    if (!params.dryRun) {
      await insertBackfillCandidate(params.sb, candidate, params.nowIso);
      result.inserted++;
    }
  }

  if (discovery.candidates.length < gap) {
    result.skipped.push(`only found ${discovery.candidates.length} usable replacement(s) for gap of ${gap}`);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const hasTmKey = Boolean(
    Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY")
  );
  const hasPerplexityKey = Boolean(Deno.env.get("PERPLEXITY_API_KEY"));
  if (!hasTmKey && !hasPerplexityKey) {
    return json({ error: "No concert verification provider configured" }, 503);
  }

  const url = new URL(req.url);
  const suggest = url.searchParams.get("suggest") === "1";
  const dryRun = url.searchParams.get("dry_run") === "1";
  const backfill = url.searchParams.get("backfill") === "1";
  const recover = url.searchParams.get("recover") === "1";
  const strictDirectTm = url.searchParams.get("strict_direct_tm") === "1";
  const requireVenueMatch = url.searchParams.get("require_venue_match") === "1";
  const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");

  const sb = createClient(supabaseUrl, serviceKey);

  const baseSelect = `
    id, name, active, source, featured, event_id, event_date, artist_name, city, expires_at,
    events ( id, event_date, ticket_url, artists ( name ), venues ( name, city, state ) ),
    destinations ( city, state )
  `;
  const fullSelect = `
    id, name, active, source, featured, event_id, event_date, artist_name, city, expires_at,
    verification_fail_count, last_verification_failed_at,
    events ( id, event_date, ticket_url, artists ( name ), venues ( name, city, state ) ),
    destinations ( city, state )
  `;
  const runPackageQuery = async (selectClause: string) => {
    let query = sb.from("packages").select(selectClause);
    if (!recover) query = query.eq("active", true);
    return await query;
  };

  let { data: rows, error: qErr } = await runPackageQuery(fullSelect);
  if (qErr) {
    const msg = qErr.message || "";
    const missingVerificationColumns =
      msg.includes("verification_fail_count") ||
      msg.includes("last_verification_failed_at") ||
      (msg.includes("column") && msg.includes("does not exist"));
    if (missingVerificationColumns) {
      console.warn("[verify-packages] verification columns missing; retrying with legacy package shape");
      const retry = await runPackageQuery(baseSelect);
      rows = retry.data;
      qErr = retry.error;
    }
  }

  if (qErr) {
    console.error("[verify-packages] query error:", qErr.message);
    return json({ error: qErr.message }, 500);
  }

  const result = {
    dry_run: dryRun,
    backfill,
    recover,
    strict_direct_tm: strictDirectTm,
    require_venue_match: requireVenueMatch,
    checked: 0,
    verified_ticketmaster: 0,
    verified_perplexity: 0,
    first_failed: 0,
    second_failed_hidden: 0,
    expired_hidden: 0,
    recovered: 0,
    deactivated: 0,
    skipped_incomplete: 0,
    provider_errors: 0,
    ticket_url_refreshed: 0,
    details: [] as Array<{
      package_id: string;
      name: string;
      outcome: "verified" | "needs_review" | "hidden" | "expired" | "skipped";
      reason?: string;
      source?: "ticketmaster" | "perplexity";
      fail_count?: number;
      ticketmaster_venue?: string;
    }>,
  };

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  for (const raw of rows ?? []) {
    const row = raw as unknown as PackageRow;
    const ev = embedEvent(row);
    const artist = ev?.artists?.name?.trim() || row.artist_name?.trim() || "";
    const city =
      ev?.venues?.city?.trim() ||
      row.destinations?.city?.trim() ||
      row.city?.trim() ||
      "";
    const eventYmd = toYmd(ev?.event_date) || toYmd(row.event_date);

    if (!artist || !city || !eventYmd) {
      result.skipped_incomplete++;
      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "skipped",
        reason: "missing artist, city, or event date",
      });
      continue;
    }

    if (eventYmd < today || dateIsExpired(row.expires_at, nowMs)) {
      result.deactivated++;
      result.expired_hidden++;
      const reason = eventYmd < today ? "event date in the past" : "package expiry in the past";
      if (!dryRun) {
        await updatePackage(sb, row.id, {
          active: false,
          featured: false,
          verification_status: "expired",
          last_verification_at: nowIso,
          last_verification_source: "system",
          verification_notes: reason,
          last_ticketmaster_check_at: nowIso,
          ticketmaster_last_ok: false,
        });
      }
      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "expired",
        reason,
      });
      continue;
    }

    result.checked++;

    const verification = await verifyPackageConcert({
      artist,
      city,
      eventYmd,
      packageVenue: ev?.venues?.name ?? undefined,
      strictDirectTm,
      requireVenueMatch,
      perplexityKey: perplexityKey ?? null,
    });

    if (verification.success) {
      if (verification.success.source === "ticketmaster") result.verified_ticketmaster++;
      else result.verified_perplexity++;
      if (recover && row.active !== true) result.recovered++;

      if (!dryRun) {
        await updatePackage(sb, row.id, {
          active: true,
          verification_status: "verified",
          verification_fail_count: 0,
          last_verification_at: nowIso,
          last_verification_source: verification.success.source,
          verification_notes: `Confirmed ${artist} in ${city} on ${eventYmd}`,
          verification_evidence_url: verification.success.url ?? null,
          last_ticketmaster_check_at: nowIso,
          ticketmaster_last_ok: verification.success.source === "ticketmaster",
        });

        const evId = ev?.id ?? row.event_id;
        const linkType = verification.success.ticketmaster?.book_link?.link_type;
        const newUrl = verification.success.ticketmaster?.book_url?.trim();
        if (evId && linkType === "direct_event" && newUrl && newUrl.startsWith("https://")) {
          const old = ev?.ticket_url ?? "";
          if (old !== newUrl) {
            await sb
              .from("events")
              .update({ ticket_url: newUrl, updated_at: nowIso })
              .eq("id", evId);
            result.ticket_url_refreshed++;
          }
        }
      }

      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "verified",
        source: verification.success.source,
        ticketmaster_venue: verification.success.ticketmaster?.venue?.name,
      });
    } else {
      if (verification.failure?.providerError) {
        result.provider_errors++;
        result.details.push({
          package_id: row.id,
          name: row.name,
          outcome: "skipped",
          reason: verification.failure.reason,
          ...(verification.failure.ticketmasterVenue ? { ticketmaster_venue: verification.failure.ticketmasterVenue } : {}),
        });
        console.warn(`[verify-packages] provider error for ${row.id} — ${verification.failure.reason}`);
        continue;
      }

      const failureCount = nextFailureCount(row, today);
      const hide = failureCount >= FAILURE_THRESHOLD;
      if (hide) {
        result.deactivated++;
        result.second_failed_hidden++;
      } else {
        result.first_failed++;
      }

      if (!dryRun) {
        const patch: Record<string, unknown> = {
          active: hide ? false : row.active,
          verification_status: hide ? "failed_twice" : "needs_review",
          verification_fail_count: failureCount,
          last_verification_at: nowIso,
          last_verification_failed_at: nowIso,
          last_verification_source: "system",
          verification_notes: verification.failure?.reason ?? "verification failed",
          verification_evidence_url: null,
          last_ticketmaster_check_at: nowIso,
          ticketmaster_last_ok: false,
        };
        if (hide) {
          patch.featured = false;
        }
        await updatePackage(sb, row.id, patch);
      }

      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: hide ? "hidden" : "needs_review",
        reason: verification.failure?.reason ?? "verification failed",
        fail_count: failureCount,
        ...(verification.failure?.ticketmasterVenue ? { ticketmaster_venue: verification.failure.ticketmasterVenue } : {}),
      });
      console.log(
        `[verify-packages] ${dryRun ? "[dry_run] " : ""}${hide ? "hidden" : "needs_review"} ${row.id} — ${verification.failure?.reason}`
      );
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  let metro_gaps: Array<{ slug: string; label: string }> | undefined;
  if (suggest) {
    const { data: activeCurated } = await sb
      .from("packages")
      .select("city, destinations ( city )")
      .eq("active", true)
      .eq("source", "curated");

    const counts = new Map<string, number>();
    for (const m of METROS) counts.set(m.slug, 0);
    for (const p of activeCurated ?? []) {
      const c =
        (p as { destinations?: { city?: string }; city?: string }).destinations?.city ||
        (p as { city?: string }).city ||
        "";
      const metro = getMetroByCity(c);
      if (metro) counts.set(metro.slug, (counts.get(metro.slug) ?? 0) + 1);
    }
    metro_gaps = METROS.filter((m) => (counts.get(m.slug) ?? 0) === 0).map((m) => ({
      slug: m.slug,
      label: m.label,
    }));
  }

  let backfill_result: BackfillResult | undefined;
  if (backfill) {
    try {
      backfill_result = await backfillCuratedPackages({
        sb,
        dryRun,
        today,
        nowIso,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[verify-packages] backfill failed:", msg);
      return json({ ...result, ...(suggest ? { metro_gaps } : {}), backfill_error: msg }, 500);
    }
  }

  console.log(
    `[verify-packages] done dry_run=${dryRun} recover=${recover} backfill=${backfill} checked=${result.checked} tm=${result.verified_ticketmaster} perplexity=${result.verified_perplexity} first_failed=${result.first_failed} hidden=${result.second_failed_hidden} expired=${result.expired_hidden} skipped=${result.skipped_incomplete} urls=${result.ticket_url_refreshed} backfill_inserted=${backfill_result?.inserted ?? 0}`
  );

  return json({ ...result, ...(suggest ? { metro_gaps } : {}), ...(backfill ? { backfill_result } : {}) });
});
