/**
 * refresh-catalog — Experience Caddie internal catalog refresh
 *
 * PURPOSE
 * -------
 * Populates (and keeps fresh) the internal golf_courses and venues tables
 * for up to 20 supported metros. The itinerary builder queries this catalog
 * first; only metros without catalog data fall back to live API calls.
 *
 * HOW TO CALL
 * -----------
 * Manual (any time):
 *   POST /functions/v1/refresh-catalog
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   Content-Type: application/json
 *   Body: { "metro": "austin", "mode": "all", "dry_run": false }
 *
 * Body parameters (all optional):
 *   metro    – slug from golfCities.ts, e.g. "austin". Omit to refresh ALL metros.
 *   mode     – "golf" | "venues" | "all" (default: "all")
 *   dry_run  – true = fetch + normalize but do NOT write to DB (safe for testing)
 *
 * RECOMMENDED CADENCE
 * -------------------
 *   - Monthly:  full refresh of all 20 metros (run via pg_cron or a scheduled job)
 *   - Weekly:   golf-only refresh for the 5 busiest metros
 *   - On-demand: when you add a new metro or suspect stale data
 *
 * SCHEDULING VIA pg_cron (when ready)
 * ------------------------------------
 * In Supabase SQL editor:
 *   SELECT cron.schedule(
 *     'monthly-catalog-refresh',
 *     '0 3 1 * *',   -- 3 AM on the 1st of every month
 *     $$ SELECT net.http_post(
 *          url := 'https://<project>.supabase.co/functions/v1/refresh-catalog',
 *          headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}',
 *          body := '{"mode":"all","dry_run":false}'
 *        ) $$
 *   );
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { METROS, getMetroBySlug, type MetroConfig } from "../_shared/golfCities.ts";
import { logProviderError } from "../_shared/monitoring.ts";

// ---------------------------------------------------------------------------
// Helpers: CORS + JSON response
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Google Places viewport helper (same as search function)
// ---------------------------------------------------------------------------
function viewportFromCenter(lat: number, lng: number, radiusMiles: number) {
  const degPerMileLat = 1 / 69;
  const degPerMileLng = 1 / (69 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusMiles * degPerMileLat;
  const dLng = radiusMiles * degPerMileLng;
  return {
    low:  { latitude: lat - dLat, longitude: lng - dLng },
    high: { latitude: lat + dLat, longitude: lng + dLng },
  };
}

// ---------------------------------------------------------------------------
// Golf: public-access confidence (mirrored from search function)
// ---------------------------------------------------------------------------
function publicAccessConfidence(name: string): "likely_public" | "unknown" | "likely_private" {
  const n = (name || "").toLowerCase();
  if (/municipal|muny|public\b|city\b|park\b|recreation|community\b/i.test(n)) return "likely_public";
  if (/private club|private\b golf|members[- ]only|members'? club|invitation[- ]only|invite[- ]only|proprietary|exclusive\b.*club/i.test(n)) return "likely_private";
  if (/(country club|golf & country|golf and country)\b/i.test(n) && !/resort|lodge|inn|hotel|spa/i.test(n)) return "likely_private";
  return "unknown";
}

function namePremiumScore(name: string): number {
  const n = (name || "").toLowerCase();
  if (/country club|private club|members only/i.test(n)) return 0;
  if (/resort\b|golf resort/i.test(n) && !/public|municipal/i.test(n)) return 22;
  if (/\blinks\b|plantation\b|dunes\b|pebble|ocean course/i.test(n) && !/public|municipal/i.test(n)) return 18;
  if (/\bnational\b/i.test(n) && !/public|municipal/i.test(n)) return 14;
  if (/golf club|club\b/i.test(n) && !/municipal|city|public|country club/i.test(n)) return 6;
  return 0;
}

function nameValueScore(name: string): number {
  const n = (name || "").toLowerCase();
  if (/municipal|muny|city\b|public\b/i.test(n)) return 18;
  if (/park\b|recreation|community\b/i.test(n)) return 10;
  return 0;
}

function computeQualityScore(c: {
  rating?: number;
  public_access_confidence?: string;
  name: string;
  user_rating_count?: number;
  distance_from_center_miles?: number;
}): number {
  let score = 0;
  const rating = c.rating ?? 0;
  score += Math.min(32, rating * 7);
  score += namePremiumScore(c.name);
  const value = nameValueScore(c.name);
  if (value > 0) score += Math.min(14, value);
  if (c.public_access_confidence === "likely_public") score += 6;
  if (c.public_access_confidence === "unknown") score += 3;
  if (c.public_access_confidence === "likely_private") score -= 15;
  if ((c.distance_from_center_miles ?? 999) <= 30) score += 2;
  const reviews = c.user_rating_count ?? 0;
  if (reviews >= 200) score += 6;
  else if (reviews >= 100) score += 4;
  else if (reviews >= 50) score += 2;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function assignTierHint(c: {
  name: string;
  rating?: number;
  public_access_confidence?: string;
  quality_score: number;
  user_rating_count?: number;
}): "bronze" | "silver" | "gold" {
  const premium = namePremiumScore(c.name);
  const value = nameValueScore(c.name);
  const rating = c.rating ?? 0;
  const reviewCount = c.user_rating_count ?? 0;
  const isMunicipalOrPark = value >= 10;
  const isTopTierPremium = premium >= 14;
  const isLikelyPrivate = c.public_access_confidence === "likely_private";
  const hasStrongReviews = reviewCount >= 50 && rating >= 4.3;

  if (isLikelyPrivate) return "bronze";
  if (isTopTierPremium && !isMunicipalOrPark && rating >= 4.2 && c.quality_score >= 55) return "gold";
  if (premium >= 6 && hasStrongReviews && !isMunicipalOrPark) return "gold";
  if (rating >= 4.5 && !isMunicipalOrPark) return "gold";
  if (isMunicipalOrPark) return "bronze";
  if (rating === 0) return "bronze";
  if (rating < 4.0) return "bronze";
  if (c.quality_score < 35) return "bronze";
  return "silver";
}

// ---------------------------------------------------------------------------
// Venue type inference from Ticketmaster data
// ---------------------------------------------------------------------------
function inferVenueType(name: string, capacity: number | null): string {
  const n = (name || "").toLowerCase();
  if (/stadium|field|ballpark/i.test(n) || (capacity != null && capacity >= 20000)) return "stadium";
  if (/amphitheater|amphitheatre|pavilion|outdoor/i.test(n)) return "amphitheater";
  if (/arena/i.test(n) || (capacity != null && capacity >= 5000 && capacity < 20000)) return "arena";
  if (/theater|theatre|hall\b|auditorium|opera|symphony/i.test(n)) return "theater";
  if (/club|lounge|bar\b|tavern|bar &/i.test(n) || (capacity != null && capacity < 1500)) return "club";
  return "other";
}

// ============================================================================
// GOLF DATA SOURCE
// ============================================================================
// Currently using Google Places Text Search — the same API the live search
// function uses today. This gives us a solid baseline of publicly-findable
// courses but does NOT include confirmed green fees, booking availability, or
// verified public-access status.
//
// RECOMMENDED UPGRADE: Replace fetchGolfForMetro() with a call to a
// golf-specific data provider. Top options:
//
//   1. GolfCourseAPI.com  — REST API, ~$50/mo, includes public_access flag,
//      green fees, holes, par, slope, booking URLs.
//      Docs: https://golfcourseapi.com/
//
//   2. GolfNow / EZLinks Partner API — real tee time inventory with live
//      pricing; requires a partnership agreement. Best for booking integration.
//      Contact: partners@golfnow.com
//
//   3. Golfbert API — comprehensive course data, handicap ratings, slope.
//      Docs: https://developer.golfbert.com/
//
// HOW TO SWAP IN A PAID API:
//   1. Add the API key to Supabase secrets:
//      supabase secrets set GOLF_API_KEY=your_key_here
//   2. Replace the function body of fetchGolfForMetro() below.
//   3. Map the API's response fields to normalizeGolfCourse() inputs.
//      The output shape stays the same — no other code changes needed.
// ============================================================================

// Metros with enough geographic sprawl (or multi-state/multi-region layout)
// that a single text query materially under-surfaces golf options. For these
// we run one query per anchor city (first N cities in the metro config) and
// dedup by Places id. Non-sprawl metros get a single query anchored on the
// metro label, which has been sufficient for tight markets like Austin.
const SPRAWL_METRO_SLUGS = new Set([
  "dallas",
  "miami",
  "los-angeles",
  "san-francisco",
  "chicago",
  "new-york-city",
  "washington-dc",
]);
// Number of anchor cities (first N in metro.cities) to use for sprawl metros.
const SPRAWL_ANCHOR_COUNT = 3;
// Max pagination pages per anchor. Google Places v1 text search caps at 60
// results across 3 pages, and each page is 20 results.
const MAX_PAGES_PER_ANCHOR = 3;

const GOLF_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.nationalPhoneNumber",
  "places.reservable",
  "places.editorialSummary",
  "nextPageToken",
].join(",");

/**
 * Run a single Places text search query with pagination (up to 3 pages).
 * Returns all results concatenated. Pagination tokens must rest ~2s before
 * being used (Google's serving requirement); we wait 2.5s to be safe.
 */
async function fetchGolfAnchored(
  textQuery: string,
  viewport: ReturnType<typeof viewportFromCenter>,
  googleApiKey: string
): Promise<RawGolfPlace[]> {
  const collected: RawGolfPlace[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_ANCHOR; page++) {
    const body: Record<string, unknown> = {
      textQuery,
      pageSize: 20,
      locationRestriction: { rectangle: viewport },
      includedType: "golf_course",
      strictTypeFiltering: true,
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleApiKey,
        "X-Goog-FieldMask": GOLF_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Places error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as { places?: RawGolfPlace[]; nextPageToken?: string };
    collected.push(...(data.places ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    // Google requires a short delay before using nextPageToken.
    await new Promise((r) => setTimeout(r, 2500));
  }

  return collected;
}

async function fetchGolfForMetro(
  metro: MetroConfig,
  googleApiKey: string
): Promise<RawGolfPlace[]> {
  const viewport = viewportFromCenter(
    metro.center.lat,
    metro.center.lng,
    metro.searchRadiusMiles
  );

  // Build the anchor query list. Sprawl metros get one query per anchor city;
  // compact metros get a single metro-label query. Anchor queries are less
  // prone to Google's relevance bias toward the downtown core.
  const queries: string[] = [];
  if (SPRAWL_METRO_SLUGS.has(metro.slug)) {
    const anchors = metro.cities.slice(0, SPRAWL_ANCHOR_COUNT);
    for (const city of anchors) {
      queries.push(`golf course in ${city}, ${metro.state}`);
    }
  } else {
    queries.push(`golf course in ${metro.label}`);
  }

  // Run anchors sequentially to be a good API citizen and to keep request
  // bursts under Google's per-second quota.
  const byId = new Map<string, RawGolfPlace>();
  for (const query of queries) {
    const results = await fetchGolfAnchored(query, viewport, googleApiKey);
    for (const place of results) {
      if (place.id && !byId.has(place.id)) byId.set(place.id, place);
    }
  }
  return Array.from(byId.values());
}

// ============================================================================
// VENUE DATA SOURCE — TICKETMASTER DISCOVERY API
// ============================================================================
// Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
// Secret name: TICKETMASTER_CONSUMER_KEY  (already used by the search function)
//
// The venues endpoint returns major concert/event venues for a given city.
// We filter to keep only music-relevant venues (arenas, amphitheaters, clubs,
// theaters) and skip sports-only stadiums.
//
// NOTE: Ticketmaster DMA IDs in golfCities.ts should be confirmed against:
//   GET https://app.ticketmaster.com/discovery/v2/markets.json?apikey={key}
// ============================================================================

interface TmVenueRaw {
  id: string;
  name: string;
  address?: { line1?: string };
  city?: { name?: string };
  state?: { stateCode?: string; name?: string };
  country?: { countryCode?: string };
  location?: { longitude?: string; latitude?: string };
  postalCode?: string;
  url?: string;
  images?: Array<{ url: string; width: number; height: number }>;
  upcomingEvents?: { _total?: number };
  generalInfo?: { generalRule?: string };
  capacity?: number;
  timezone?: string;
}

async function fetchVenuesForMetro(
  metro: MetroConfig,
  tmApiKey: string
): Promise<TmVenueRaw[]> {
  // Always filter by city + state for precise, city-specific results.
  // DMA IDs in golfCities.ts are unverified estimates — using them as the
  // sole filter caused the API to return the same broad national set of venues
  // for every metro, so we stick with the more reliable city/stateCode params.
  const params = new URLSearchParams({
    apikey: tmApiKey,
    city: metro.cities[0],
    stateCode: metro.state,
    size: "20",
    sort: "relevance,desc",
  });

  const url = `https://app.ticketmaster.com/discovery/v2/venues.json?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ticketmaster venues error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as {
    _embedded?: { venues?: TmVenueRaw[] };
    page?: { totalElements?: number };
  };
  return data._embedded?.venues ?? [];
}

// ---------------------------------------------------------------------------
// Normalization — Golf
// ---------------------------------------------------------------------------

interface RawGolfPlace {
  id?: string;
  displayName?: { text?: string };
  name?: string;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  reservable?: boolean;
  editorialSummary?: { text?: string; languageCode?: string };
}

interface NormalizedGolfCourse {
  // Core identity
  name: string;
  source: string;
  source_id: string;
  // Location
  address: string | null;
  city: string;
  state: string;
  country: string;
  lat: number | null;
  lng: number | null;
  // Quality signals
  rating: number | null;
  user_rating_count: number | null;
  public_access: boolean;
  public_access_confidence: string;
  normalized_quality_score: number;
  tier_hint: string;
  // Catalog fields
  metro: string;
  distance_from_center_miles: number | null;
  website_url: string | null;
  booking_url: string | null;     // GolfNow/TeeOff link (added by paid API swap)
  tee_time_url: string | null;    // Same — direct booking CTA
  phone: string | null;
  active: boolean;
  last_refreshed_at: string;
}

function normalizeGolfCourse(place: RawGolfPlace, metro: MetroConfig): NormalizedGolfCourse | null {
  const name = place.displayName?.text ?? place.name ?? "";
  if (!name) return null;

  const source_id = place.id ?? "";
  if (!source_id) return null;

  const cityComp = place.addressComponents?.find((c) => c.types?.includes("locality"));
  const stateComp = place.addressComponents?.find((c) => c.types?.includes("administrative_area_level_1"));
  const city = cityComp?.longText ?? cityComp?.shortText ?? metro.cities[0];
  const state = stateComp?.shortText ?? metro.state;

  const lat = place.location?.latitude ?? null;
  const lng = place.location?.longitude ?? null;
  const dist = (lat != null && lng != null)
    ? haversineMiles(metro.center.lat, metro.center.lng, lat, lng)
    : null;

  const confidence = publicAccessConfidence(name);
  // If Google Places confirms the course accepts reservations, treat it as likely_public
  // even if the name alone was ambiguous or unknown.
  const adjustedConfidence: "likely_public" | "unknown" | "likely_private" =
    place.reservable === true && confidence !== "likely_private"
      ? "likely_public"
      : confidence;
  const qs = computeQualityScore({
    name,
    rating: place.rating,
    public_access_confidence: adjustedConfidence,
    user_rating_count: place.userRatingCount,
    distance_from_center_miles: dist ?? undefined,
  });
  const tier = assignTierHint({ name, rating: place.rating, public_access_confidence: adjustedConfidence, quality_score: qs, user_rating_count: place.userRatingCount });

  return {
    name,
    source: "google_places",
    source_id,
    address: place.formattedAddress ?? null,
    city,
    state,
    country: "United States",
    lat,
    lng,
    rating: place.rating ?? null,
    user_rating_count: place.userRatingCount ?? null,
    public_access: adjustedConfidence !== "likely_private",
    public_access_confidence: adjustedConfidence,
    normalized_quality_score: qs,
    tier_hint: tier,
    metro: metro.slug,
    distance_from_center_miles: dist ? Math.round(dist * 10) / 10 : null,
    website_url: place.websiteUri ?? null,
    booking_url: place.websiteUri ?? null,
    tee_time_url: null,   // Populated by paid golf API — leave null for now
    phone: place.nationalPhoneNumber ?? null,
    active: true,
    last_refreshed_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Normalization — Venues
// ---------------------------------------------------------------------------

interface NormalizedVenue {
  name: string;
  source: string;
  source_id: string;
  address: string | null;
  city: string;
  state: string;
  country: string;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  venue_type: string;
  image_url: string | null;
  website_url: string | null;
  ticketmaster_url: string | null;
  ticketmaster_market: string;
  timezone: string;
  metro: string;
  active: boolean;
  last_refreshed_at: string;
}

function normalizeVenue(tm: TmVenueRaw, metro: MetroConfig): NormalizedVenue | null {
  if (!tm.name || !tm.id) return null;

  // Pick the largest available image
  const image = tm.images
    ?.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    ?.[0]?.url ?? null;

  const lat = tm.location?.latitude  ? parseFloat(tm.location.latitude)  : null;
  const lng = tm.location?.longitude ? parseFloat(tm.location.longitude) : null;

  const capacity = typeof tm.capacity === "number" ? tm.capacity : null;

  return {
    name: tm.name,
    source: "ticketmaster",
    source_id: tm.id,
    address: tm.address?.line1 ?? null,
    city: tm.city?.name ?? metro.cities[0],
    state: tm.state?.stateCode ?? metro.state,
    country: tm.country?.countryCode ?? "US",
    lat,
    lng,
    capacity,
    venue_type: inferVenueType(tm.name, capacity),
    image_url: image,
    website_url: tm.url ?? null,
    ticketmaster_url: tm.url ?? null,
    ticketmaster_market: metro.ticketmasterMarket,
    timezone: tm.timezone ?? metro.timezone,
    metro: metro.slug,
    active: true,
    last_refreshed_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function upsertGolfCourses(
  supabase: SupabaseClient,
  courses: NormalizedGolfCourse[]
): Promise<{ upserted: number; errors: string[] }> {
  if (courses.length === 0) return { upserted: 0, errors: [] };

  const { error } = await supabase
    .from("golf_courses")
    .upsert(courses, { onConflict: "source,source_id", ignoreDuplicates: false });

  if (error) return { upserted: 0, errors: [error.message] };
  return { upserted: courses.length, errors: [] };
}

async function upsertVenues(
  supabase: SupabaseClient,
  venues: NormalizedVenue[]
): Promise<{ upserted: number; errors: string[] }> {
  if (venues.length === 0) return { upserted: 0, errors: [] };

  const { error } = await supabase
    .from("venues")
    .upsert(venues, { onConflict: "source,source_id", ignoreDuplicates: false });

  if (error) return { upserted: 0, errors: [error.message] };
  return { upserted: venues.length, errors: [] };
}

async function updateMetroStats(
  supabase: SupabaseClient,
  metroSlug: string,
  mode: "golf" | "venues" | "all",
  golfCount: number,
  venueCount: number
) {
  const metro = getMetroBySlug(metroSlug);
  const now = new Date().toISOString();

  // Step 1: Ensure the metro_areas row exists. Uses ignoreDuplicates: true so
  // an existing row is left untouched (preserves catalog_enabled and other
  // manually-set fields). New metros get their row created automatically the
  // first time refresh-catalog runs — no manual SQL INSERT needed.
  if (metro) {
    const identityRow = {
      slug: metroSlug,
      label: metro.label,
      state: metro.state,
      region: metro.region,
      center_lat: metro.center.lat,
      center_lng: metro.center.lng,
      search_radius_miles: metro.searchRadiusMiles,
      cities: metro.cities,
      catalog_enabled: false,
      updated_at: now,
    };
    await supabase
      .from("metro_areas")
      .upsert(identityRow, { onConflict: "slug", ignoreDuplicates: true });
  }

  // Step 2: Update only the stats columns so catalog_enabled is never overwritten.
  const statsUpdate: Record<string, unknown> = { updated_at: now };
  if (mode === "golf" || mode === "all") {
    statsUpdate.last_golf_refresh_at = now;
    statsUpdate.golf_count = golfCount;
  }
  if (mode === "venues" || mode === "all") {
    statsUpdate.last_venue_refresh_at = now;
    statsUpdate.venue_count = venueCount;
  }
  await supabase.from("metro_areas").update(statsUpdate).eq("slug", metroSlug);
}

// ---------------------------------------------------------------------------
// Mock data — used when dry_run = true and no API keys present
// ---------------------------------------------------------------------------
function mockGolfPlaces(metro: MetroConfig): RawGolfPlace[] {
  return [
    {
      id: `mock_golf_${metro.slug}_1`,
      displayName: { text: `${metro.cities[0]} Golf Club` },
      formattedAddress: `100 Fairway Dr, ${metro.cities[0]}, ${metro.state}`,
      location: { latitude: metro.center.lat + 0.05, longitude: metro.center.lng + 0.05 },
      rating: 4.4,
      userRatingCount: 180,
    },
    {
      id: `mock_golf_${metro.slug}_2`,
      displayName: { text: `Municipal Golf Course` },
      formattedAddress: `200 Park Ave, ${metro.cities[0]}, ${metro.state}`,
      location: { latitude: metro.center.lat - 0.08, longitude: metro.center.lng - 0.04 },
      rating: 4.1,
      userRatingCount: 320,
    },
    {
      id: `mock_golf_${metro.slug}_3`,
      displayName: { text: `${metro.cities[0]} Resort & Golf` },
      formattedAddress: `300 Resort Blvd, ${metro.cities[0]}, ${metro.state}`,
      location: { latitude: metro.center.lat + 0.12, longitude: metro.center.lng - 0.10 },
      rating: 4.7,
      userRatingCount: 95,
    },
  ];
}

function mockTmVenues(metro: MetroConfig): TmVenueRaw[] {
  return [
    {
      id: `mock_venue_${metro.slug}_1`,
      name: `${metro.cities[0]} Arena`,
      address: { line1: "100 Arena Way" },
      city: { name: metro.cities[0] },
      state: { stateCode: metro.state },
      location: { latitude: String(metro.center.lat + 0.02), longitude: String(metro.center.lng + 0.02) },
      capacity: 18000,
      timezone: metro.timezone,
      url: `https://www.ticketmaster.com/venue/mock-${metro.slug}`,
    },
    {
      id: `mock_venue_${metro.slug}_2`,
      name: `${metro.cities[0]} Amphitheater`,
      address: { line1: "200 Outdoor Lane" },
      city: { name: metro.cities[0] },
      state: { stateCode: metro.state },
      location: { latitude: String(metro.center.lat - 0.05), longitude: String(metro.center.lng + 0.06) },
      capacity: 7500,
      timezone: metro.timezone,
      url: `https://www.ticketmaster.com/venue/mock-amphitheater-${metro.slug}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Per-metro refresh orchestrator
// ---------------------------------------------------------------------------

interface MetroResult {
  metro: string;
  golf_fetched: number;
  golf_upserted: number;
  venues_fetched: number;
  venues_upserted: number;
  errors: string[];
  dry_run: boolean;
}

async function refreshMetro(
  metro: MetroConfig,
  supabase: SupabaseClient,
  googleApiKey: string | null,
  tmApiKey: string | null,
  mode: "golf" | "venues" | "all",
  dryRun: boolean
): Promise<MetroResult> {
  const result: MetroResult = {
    metro: metro.slug,
    golf_fetched: 0,
    golf_upserted: 0,
    venues_fetched: 0,
    venues_upserted: 0,
    errors: [],
    dry_run: dryRun,
  };

  // ---- GOLF ---------------------------------------------------------------
  if (mode === "golf" || mode === "all") {
    try {
      let rawPlaces: RawGolfPlace[];

      if (!googleApiKey || dryRun) {
        // Use mock data when key is absent or it's a dry run
        rawPlaces = mockGolfPlaces(metro);
        console.log(`[${metro.slug}] golf: using mock data (dry_run=${dryRun})`);
      } else {
        rawPlaces = await fetchGolfForMetro(metro, googleApiKey);
        console.log(`[${metro.slug}] golf: fetched ${rawPlaces.length} places from Google`);
      }

      result.golf_fetched = rawPlaces.length;
      const normalized = rawPlaces
        .map((p) => normalizeGolfCourse(p, metro))
        .filter((c): c is NormalizedGolfCourse => c !== null);

      // Ingest-time quality floor: drop courses whose computed quality score
      // is under 30. This removes unrated / thinly-reviewed / name-penalized
      // entries (e.g. obvious private clubs) before they enter the DB, saving
      // both storage and downstream LLM verification cost. Courses can still
      // pass with rating=0 if their name/access signals push them above 30,
      // which is fine — the verifier will make the final call.
      const QUALITY_FLOOR = 30;
      const qualityPassing = normalized.filter((c) => c.normalized_quality_score >= QUALITY_FLOOR);
      const filteredOutCount = normalized.length - qualityPassing.length;
      if (filteredOutCount > 0) {
        console.log(`[${metro.slug}] golf: ${filteredOutCount} courses filtered below quality floor ${QUALITY_FLOOR}`);
      }

      if (!dryRun) {
        const { upserted, errors } = await upsertGolfCourses(supabase, qualityPassing);
        result.golf_upserted = upserted;
        result.errors.push(...errors);
      } else {
        result.golf_upserted = 0; // dry run — no writes
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusMatch = msg.match(/error (\d{3})/i);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
      await logProviderError("google_places", statusCode, msg, "refresh-catalog");
      result.errors.push(`golf error: ${msg}`);
    }
  }

  // ---- VENUES -------------------------------------------------------------
  if (mode === "venues" || mode === "all") {
    try {
      let rawVenues: TmVenueRaw[];

      if (!tmApiKey || dryRun) {
        rawVenues = mockTmVenues(metro);
        console.log(`[${metro.slug}] venues: using mock data (dry_run=${dryRun})`);
      } else {
        rawVenues = await fetchVenuesForMetro(metro, tmApiKey);
        console.log(`[${metro.slug}] venues: fetched ${rawVenues.length} from Ticketmaster`);
      }

      result.venues_fetched = rawVenues.length;
      const normalized = rawVenues
        .map((v) => normalizeVenue(v, metro))
        .filter((v): v is NormalizedVenue => v !== null);

      if (!dryRun) {
        const { upserted, errors } = await upsertVenues(supabase, normalized);
        result.venues_upserted = upserted;
        result.errors.push(...errors);
      } else {
        result.venues_upserted = 0;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusMatch = msg.match(/error (\d{3})/i);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
      await logProviderError("ticketmaster", statusCode, msg, "refresh-catalog");
      result.errors.push(`venues error: ${msg}`);
    }
  }

  // ---- Update metro_areas stats (skip on dry run) -------------------------
  if (!dryRun && (result.golf_upserted > 0 || result.venues_upserted > 0)) {
    try {
      await updateMetroStats(
        supabase,
        metro.slug,
        mode,
        result.golf_upserted,
        result.venues_upserted
      );
    } catch (err) {
      result.errors.push(`stats update error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ---- Auth: accept service role key OR any valid Supabase JWT -----------
  // The Supabase dashboard test modal sends the logged-in user's JWT, so we
  // accept both. In production, the cron job uses the service role key.
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) {
    return json({ error: "Unauthorized — authorization header required" }, 401);
  }

  // ---- Parse request body ------------------------------------------------
  let body: { metro?: string; mode?: string; dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — use defaults
  }

  const requestedSlug: string | undefined = body.metro?.toLowerCase().trim();
  const mode = (["golf", "venues", "all"].includes(body.mode ?? "") ? body.mode : "all") as "golf" | "venues" | "all";
  const dryRun: boolean = body.dry_run ?? false;

  // ---- Resolve which metros to process -----------------------------------
  let metrosToProcess: MetroConfig[];
  if (requestedSlug) {
    const found = getMetroBySlug(requestedSlug);
    if (!found) return json({ error: `Unknown metro slug: "${requestedSlug}"` }, 400);
    metrosToProcess = [found];
  } else {
    metrosToProcess = METROS;
  }

  // ---- API keys ----------------------------------------------------------
  const googleApiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? null;
  const tmApiKey     = Deno.env.get("TICKETMASTER_CONSUMER_KEY") ?? null;

  // ---- Supabase client (service role for DB writes) ----------------------
  const supabaseUrl      = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- Process metros sequentially (avoids API rate limits) --------------
  const results: MetroResult[] = [];
  const started = Date.now();

  for (const metro of metrosToProcess) {
    console.log(`[refresh-catalog] starting metro: ${metro.slug} (mode=${mode}, dry_run=${dryRun})`);
    const result = await refreshMetro(metro, supabase, googleApiKey, tmApiKey, mode, dryRun);
    results.push(result);
    console.log(`[refresh-catalog] ${metro.slug} done — golf:${result.golf_upserted} venues:${result.venues_upserted} errors:${result.errors.length}`);

    // Brief pause between metros to be a good API citizen
    if (metrosToProcess.length > 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // ---- Summary -----------------------------------------------------------
  const totalGolfUpserted   = results.reduce((s, r) => s + r.golf_upserted, 0);
  const totalVenueUpserted  = results.reduce((s, r) => s + r.venues_upserted, 0);
  const totalErrors         = results.flatMap((r) => r.errors);
  const elapsedMs           = Date.now() - started;

  return json({
    summary: {
      metros_processed: results.length,
      mode,
      dry_run: dryRun,
      golf_upserted: totalGolfUpserted,
      venues_upserted: totalVenueUpserted,
      error_count: totalErrors.length,
      elapsed_ms: elapsedMs,
    },
    results,
    errors: totalErrors,
  });
});
