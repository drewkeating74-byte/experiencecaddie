/**
 * Search Edge Function — Ticketmaster events + Google Places golf + mock hotels.
 * Phase 1A: DB-first golf lookup for Phoenix, Nashville, Austin when pool is strong enough.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reportError, logProviderError } from "../_shared/monitoring.ts";
import { METROS } from "../_shared/golfCities.ts";
import {
  buildTicketmasterSearchUrl,
  fetchTicketmasterEvents as searchTicketmaster,
  mapTmEventToResult as mapEventToResult,
  venueCityMatchesRequest,
  venueMatchesUserCity,
  tmEventMatchesArtistQuery,
} from "../_shared/ticketmaster.ts";

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_START_OFFSET_DAYS = 14; // Search starts 2 weeks from today
const DEFAULT_WINDOW_MONTHS = 9; // Search spans 9 months from start
const MAX_WINDOW_MONTHS = 12;

type SearchRequest = {
  artist?: string;
  destination: { city?: string; state?: string; lat?: number; lng?: number };
  dates: { start_date: string; end_date: string };
  group_size?: number;
  budget_tier?: "low" | "mid" | "high";
  tee_time_window?: { start: string; end: string };
  // When "background", skip live provider APIs (Ticketmaster/Google Places) that
  // must not be called from scheduled/automated jobs per their ToS. Background
  // callers (e.g. refresh-stale) must set this to avoid policy violations.
  _context?: "user" | "background";
};

type ConcertOutboundLink = {
  url: string;
  provider: string;
  category: "concert";
  link_type: "direct_event" | "provider_search" | "manual_fallback";
  label: string;
  is_verified: boolean;
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

type EventResult = {
  id: string;
  name: string;
  date_time: string;
  venue: { name: string; city: string; state?: string; lat?: number; lng?: number; capacity?: number };
  image_url?: string;
  source_url?: string;
  book_url?: string;
  book_link?: ConcertOutboundLink;
  price_min?: number;
  price_max?: number;
  provider: "ticketmaster" | "mock";
};

type TierHint = "bronze" | "silver" | "gold";

type GolfOutboundLink = {
  url: string;
  provider: string;
  category: "golf";
  link_type: "direct_listing" | "provider_search" | "manual_fallback";
  label: string;
  is_verified: boolean;
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

type GolfCourseResult = {
  id: string;
  name: string;
  city: string;
  state?: string;
  public_access?: boolean;
  public_access_confidence?: "likely_public" | "unknown" | "likely_private";
  rating?: number;
  tee_time_window?: { start: string; end: string };
  lat?: number;
  lng?: number;
  image_url?: string;
  source_url?: string;
  google_maps_uri?: string;
  book_url?: string;
  book_link?: GolfOutboundLink;
  price_min?: number;
  price_max?: number;
  source?: string;
  as_of?: string;
  provider: "google_places" | "mock";
  quality_score?: number;
  tier_hint?: TierHint;
  distance_miles?: number;
  drive_time_minutes?: number;
  user_rating_count?: number;
};

function buildGolfOutboundLink(url: string, providerHint?: string): GolfOutboundLink {
  const u = url.toLowerCase();
  const isSearch = u.includes("golfnow.com/search") || u.includes("teeoff.com/search") || (u.includes("/search") && u.includes("q="));
  const isGolfNow = u.includes("golfnow.com");
  const isTeeOff = u.includes("teeoff.com");
  const isGoogleMaps = u.includes("google.com/maps") || u.includes("maps.google") || u.includes("place_id");
  const provider = providerHint ?? (isGolfNow ? "GolfNow" : isTeeOff ? "TeeOff" : isGoogleMaps ? "Google Maps" : "External");
  if (isSearch) {
    return {
      url,
      provider: isGolfNow ? "GolfNow" : isTeeOff ? "TeeOff" : provider,
      category: "golf",
      link_type: "provider_search",
      label: "Search tee times",
      is_verified: false,
      confidence: "medium",
      disclaimer: "Opens external golf search results; tee time availability is not confirmed in Experience Caddie",
    };
  }
  const label = "Tee times";
  return {
    url,
    provider,
    category: "golf",
    link_type: "direct_listing",
    label,
    is_verified: false,
    confidence: "medium",
  };
}

type HotelOutboundLink = {
  url: string;
  provider: string;
  category: "hotel";
  link_type: "direct_listing" | "provider_search" | "manual_fallback";
  label: string;
  is_verified: boolean;
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

type HotelResult = {
  id: string;
  name: string;
  city: string;
  state?: string;
  stars?: number;
  rating?: number;
  image_url?: string;
  source_url?: string;
  book_url?: string;
  book_link?: HotelOutboundLink;
  price_min?: number;
  price_max?: number;
  provider: "google_places" | "mock";
  as_of?: string;
};

type CatalogVenue = {
  id: string;
  name: string;
  city: string;
  state?: string;
  venue_type?: string;
  website_url?: string | null;
  ticketmaster_url?: string | null;
  normalized_quality_score?: number | null;
};

type SearchResponse = {
  destination: { city: string; state?: string; start_date: string; end_date: string };
  events: EventResult[];
  golf_courses: GolfCourseResult[];
  bronze_golf_candidates?: GolfCourseResult[];
  silver_golf_candidates?: GolfCourseResult[];
  gold_golf_candidates?: GolfCourseResult[];
  hotels: HotelResult[];
  /** Catalog venues for this metro — passed to generate-itinerary as LLM context. */
  catalog_venues?: CatalogVenue[];
  /** Observability: tells callers how data was sourced for this request. */
  catalog_meta?: {
    metro_slug: string | null;
    catalog_enabled: boolean;
    golf_source: "catalog" | "live_api" | "mock";
    venues_from_catalog: number;
  };
  meta: { providers: ("ticketmaster" | "google_places" | "mock" | "catalog")[]; cached: boolean; generated_at: string; request_id: string };
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the TM search window.
 *
 * minStartOffsetDays controls the earliest date we'll search from:
 *  - DEFAULT_START_OFFSET_DAYS (14) for discovery/flexible flows — ensures booking lead time.
 *  - 1 for specific-artist queries — the user knows the show; don't hide near-term dates.
 */
function resolveDateWindow(
  startDate?: string,
  endDate?: string,
  minStartOffsetDays: number = DEFAULT_START_OFFSET_DAYS
): { start: string; end: string } {
  const today = new Date();
  const defaultStart = addDays(today, DEFAULT_START_OFFSET_DAYS);
  const defaultEnd = addMonths(defaultStart, DEFAULT_WINDOW_MONTHS);
  const minStart = addDays(today, minStartOffsetDays);
  const minStartStr = toYYYYMMDD(minStart);

  let start: Date;
  let end: Date;
  if (startDate && endDate) {
    start = new Date(startDate + "T12:00:00");
    end = new Date(endDate + "T12:00:00");
    if (isNaN(start.getTime())) start = defaultStart;
    if (isNaN(end.getTime())) end = addMonths(defaultStart, DEFAULT_WINDOW_MONTHS);
    // Enforce minimum start: never search past events
    const startStr = toYYYYMMDD(start);
    if (startStr < minStartStr) start = minStart;
    if (end <= start) end = addMonths(start, DEFAULT_WINDOW_MONTHS);
  } else {
    start = minStart;
    end = defaultEnd;
  }
  const maxEnd = addMonths(start, MAX_WINDOW_MONTHS);
  if (end > maxEnd) end = maxEnd;
  return { start: toYYYYMMDD(start), end: toYYYYMMDD(end) };
}

/**
 * Look up events from our internal catalog (the `events` table) that match the
 * requested artist and city. Only events with a confirmed direct ticket URL
 * (e.g. a real Ticketmaster event page) are returned. Events with search/fallback
 * URLs are skipped so the caller falls through to the live Ticketmaster API.
 */
function isConfirmedEventUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // Accept direct Ticketmaster or Live Nation event pages
  // Reject search pages, Google search URLs, or missing URLs
  if (url.includes("google.com/search")) return false;
  if (url.includes("ticketmaster.com/search")) return false;
  if (url.includes("livenation.com/search")) return false;
  if (url.match(/ticketmaster\.com\/event\//)) return true;
  if (url.match(/livenation\.com\/venue\//) || url.match(/livenation\.com\/event\//)) return true;
  // Any other direct URL that isn't a search page is acceptable
  if (url.includes("/search") || url.includes("?q=")) return false;
  return true;
}

async function findCatalogEvents(
  supabase: ReturnType<typeof createClient>,
  artistName: string | undefined,
  city: string,
  startDate: string,
  endDate: string
): Promise<EventResult[]> {
  if (!artistName?.trim()) return [];

  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, event_time, timezone, ticket_url, min_price, max_price, artists!inner(name), venues(name, city, state, lat, lng, capacity)")
    .gte("event_date", startDate)
    .lte("event_date", endDate);

  if (error || !data?.length) return [];

  const artistLower = artistName.trim().toLowerCase();
  const cityLower = city.toLowerCase();

  return data
    .filter((row: any) => {
      const rowArtist = (row.artists?.name ?? "").toLowerCase();
      const rowCity = row.venues?.city ?? "";
      const artistMatch = rowArtist.includes(artistLower) || artistLower.includes(rowArtist);
      const cityMatch = venueCityMatchesRequest(city, rowCity);
      // Only surface catalog events that have a real, confirmed ticket URL
      const hasConfirmedUrl = isConfirmedEventUrl(row.ticket_url);
      return artistMatch && cityMatch && hasConfirmedUrl;
    })
    .map((row: any) => {
      const artistN = row.artists?.name ?? artistName;
      const venueName = row.venues?.name ?? `${city} Live Music Venue`;
      const venueCity = row.venues?.city ?? city;
      const venueState = row.venues?.state ?? "";
      const ticketUrl = row.ticket_url!; // confirmed above
      const book_link: ConcertOutboundLink = {
        url: ticketUrl,
        provider: "Ticketmaster",
        category: "concert",
        link_type: "provider_event",
        label: "Get Tickets",
        is_verified: true,
        confidence: "high",
        disclaimer: "",
      };
      const localDate = row.event_date ?? startDate;
      const localTime = row.event_time?.slice(0, 8) ?? "20:00:00";
      return {
        id: row.id,
        name: row.name ?? artistN,
        date_time: `${localDate}T${localTime}`,
        venue: {
          name: venueName,
          city: venueCity,
          state: venueState,
          lat: row.venues?.lat ?? undefined,
          lng: row.venues?.lng ?? undefined,
          capacity: row.venues?.capacity ?? undefined,
        },
        image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200",
        source_url: ticketUrl,
        book_url: ticketUrl,
        book_link,
        price_min: row.min_price ?? undefined,
        price_max: row.max_price ?? undefined,
        provider: "catalog" as const,
      } satisfies EventResult;
    });
}

function mockEvents(request: SearchRequest, startDate: string, endDate: string): EventResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const artist = request.artist?.trim() || "";
  // Use artist name and city so the fallback is at least contextually accurate
  const eventName = artist ? artist : "Live Concert";
  const venueName = `${city} Live Music Venue`;
  const ticketUrl = artist
    ? `https://www.ticketmaster.com/search?q=${encodeURIComponent(artist)}+${encodeURIComponent(city)}`
    : `https://www.ticketmaster.com/search?q=concerts+${encodeURIComponent(city)}`;
  const book_link: ConcertOutboundLink = {
    url: ticketUrl,
    provider: "Ticketmaster",
    category: "concert",
    link_type: "provider_search",
    label: "Search tickets on Ticketmaster",
    is_verified: false,
    confidence: "medium",
    disclaimer: "Opens Ticketmaster search; specific tour dates and availability are not confirmed in Experience Caddie",
  };
  return [
    {
      id: "event_mock_1",
      name: eventName,
      date_time: `${startDate}T20:00:00Z`,
      venue: { name: venueName, city, state, capacity: 12000 },
      image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200",
      source_url: ticketUrl,
      book_url: ticketUrl,
      book_link,
      price_min: 75,
      price_max: 250,
      provider: "mock",
    },
  ];
}

function mockGolf(request: SearchRequest): GolfCourseResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const teeWindow = request.tee_time_window ?? { start: "07:00", end: "11:00" };
  const asOf = new Date().toISOString();
  const bookUrl = "https://www.golfnow.com/";
  const bookLink = buildGolfOutboundLink(bookUrl);
  return [
    {
      id: "golf_mock_1",
      name: "Mock Golf Club",
      city,
      state,
      public_access: true,
      public_access_confidence: "likely_public",
      rating: 4.4,
      tee_time_window: teeWindow,
      image_url: "https://images.unsplash.com/photo-1500930280485-71c409756852?w=1200",
      source_url: bookUrl,
      book_url: bookUrl,
      book_link: bookLink,
      price_min: 80,
      price_max: 180,
      source: "mock",
      as_of: asOf,
      provider: "mock",
      quality_score: 65,
      tier_hint: "silver",
    },
  ];
}

type GeoResult = { lat: number; lng: number } | null;

async function geocodeCity(city: string, state?: string): Promise<GeoResult> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) return null;
  const address = state ? `${city}, ${state}, USA` : `${city}, USA`;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> };
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch (err) {
    console.error("Geocoding error:", err);
    return null;
  }
}

function publicAccessConfidence(name: string): "likely_public" | "unknown" | "likely_private" {
  const n = (name || "").toLowerCase();
  if (/municipal|muny|public\b|city\b|park\b|recreation|community\b/i.test(n)) return "likely_public";
  // Only flag as private when the name contains explicit private-membership language.
  // "Golf Club" alone is NOT a reliable private indicator — the vast majority of courses
  // marketed as tee-time-bookable venues use this naming convention (e.g. "Avery Ranch Golf Club").
  if (/private club|private\b golf|members[- ]only|members'? club|invitation[- ]only|invite[- ]only|proprietary|exclusive\b.*club/i.test(n)) return "likely_private";
  if (/(country club|golf & country|golf and country)\b/i.test(n) && !/resort|lodge|inn|hotel|spa/i.test(n)) return "likely_private";
  return "unknown";
}

function isLikelyPlayableCourse(name: string): boolean {
  const n = (name || "").toLowerCase();
  if (/gym\b|fitness|workout|training\s*center|performance\s*center/i.test(n)) return false;
  if (/simulator|indoor\s*golf|golf\s*simulator/i.test(n)) return false;
  if (/mini\s*golf|minigolf|putt-?putt|pitch\s*and\s*putt|executive\s*course/i.test(n)) return false;
  if (/9\s*hole|nine\s*hole|par\s*3\b|par\s*27/i.test(n)) return false;
  if (/topgolf|top\s*golf|driving\s*range/i.test(n) && !/course|club|links|resort/i.test(n)) return false;
  if (/academy|instruction|lessons?\b|golf\s*school/i.test(n) && !/course|club|resort|links/i.test(n)) return false;
  if (/community\s*group|golf\s*community\b|golf\s*association|golf\s*organization/i.test(n)) return false;
  if (/\bshop\b|\bstore\b|retail|pro\s*shop\s*only/i.test(n) && !/course|club|links|resort/i.test(n)) return false;
  if (/cafe\b|café|coffee\b|restaurant|dining|eatery|bar\b|grill\b|tavern\b|lounge\b/i.test(n) && !/course|club|country\s*club|links|resort|golf\s*club/i.test(n)) return false;
  if (/rec\s*center|recreation\s*center|community\s*center/i.test(n) && !/golf\s*course|golf\s*club/i.test(n)) return false;
  if (/nonprofit|foundation|foundation\s*golf/i.test(n) && !/course|club|links/i.test(n)) return false;
  if (/\.(com|org|net)\b|website|online|web\s*community/i.test(n)) return false;
  if (n.length < 10) return false;
  if (!/\bgolf\b|course|club|links|resort|municipal|muny|park\b/i.test(n)) return false;
  if (!/golf\s*course|golf\s*club|golf\s*links|golf\s*resort|municipal|muny|country\s*club|golf\s*park|golf\b/i.test(n)) return false;
  return true;
}

function buildGolfNowSearchUrl(name: string, city: string, state?: string): string {
  const q = state ? `${name} ${city} ${state}` : `${name} ${city}`;
  return `https://www.golfnow.com/search?q=${encodeURIComponent(q)}`;
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
  distance_miles?: number;
  drive_time_minutes?: number;
  user_rating_count?: number;
}): number {
  let score = 0;
  const rating = c.rating ?? 0;
  score += Math.min(32, rating * 7);
  const premium = namePremiumScore(c.name);
  score += premium;
  const value = nameValueScore(c.name);
  if (value > 0) score += Math.min(14, value);
  if (c.public_access_confidence === "likely_public") score += 6;
  if (c.public_access_confidence === "unknown") score += 3;
  if (c.public_access_confidence === "likely_private") score -= 15;
  if (c.distance_miles != null && c.distance_miles <= 30) score += 2;
  const reviewCount = c.user_rating_count ?? 0;
  if (reviewCount >= 200) score += 6;
  else if (reviewCount >= 100) score += 4;
  else if (reviewCount >= 50) score += 2;
  return Math.min(100, Math.max(0, Math.round(score)));
}

// Second-pass quality filter & enrichment (on top of Text Search)
// - Pre-filter: exclude likely_private; require min rating 3.8 and min 5 reviews when rated
// - Enrichment: Place Details for top 12 shortlist → better links, rating, review count
// - quality_score recomputed after enrichment in applyGolfTiering
const MIN_GOLF_RATING = 3.8;
const MIN_GOLF_REVIEW_COUNT = 5;
const ENRICHMENT_SHORTLIST_SIZE = 20;

function preliminaryQualityScore(c: GolfCourseResult): number {
  const rating = c.rating ?? 0;
  const reviewCount = c.user_rating_count ?? 0;
  let score = rating * 10 + Math.min(5, Math.floor(reviewCount / 20));
  if (c.public_access_confidence === "likely_private") score -= 50;
  return score;
}

function applyQualityPreFilter(courses: GolfCourseResult[]): GolfCourseResult[] {
  const filtered = courses.filter((c) => {
    if (c.public_access_confidence === "likely_private") return false;
    const rating = c.rating ?? 0;
    if (rating > 0 && rating < MIN_GOLF_RATING) return false;
    const reviewCount = c.user_rating_count ?? 0;
    if (rating > 0 && reviewCount < MIN_GOLF_REVIEW_COUNT) return false;
    return true;
  });
  const sorted = filtered.sort((a, b) => preliminaryQualityScore(b) - preliminaryQualityScore(a)).slice(0, ENRICHMENT_SHORTLIST_SIZE);
  console.log(`[GOLF_PREFILTER] input=${courses.length} surviving=${sorted.length} | names=${sorted.map(c => `${c.name}(${c.public_access_confidence})`).join(", ")}`);
  return sorted;
}

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string
): Promise<{
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  reservable?: boolean;
  editorialSummary?: { text?: string; languageCode?: string };
  priceLevel?: string;
} | null> {
  const id = placeId.replace(/^places\//, "");
  const url = `https://places.googleapis.com/v1/places/${id}`;
  const fieldMask = "websiteUri,googleMapsUri,rating,userRatingCount,businessStatus,reservable,editorialSummary,priceLevel";
  try {
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      websiteUri?: string;
      googleMapsUri?: string;
      rating?: number;
      userRatingCount?: number;
      businessStatus?: string;
      reservable?: boolean;
      editorialSummary?: { text?: string; languageCode?: string };
      priceLevel?: string;
    };
    return data;
  } catch {
    return null;
  }
}

async function enrichGolfCandidates(
  courses: GolfCourseResult[],
  apiKey: string
): Promise<GolfCourseResult[]> {
  const enriched = await Promise.all(
    courses.map(async (c) => {
      const details = await fetchPlaceDetails(c.id, apiKey);
      if (!details) return c;
      if (details.businessStatus === "CLOSED_PERMANENTLY") return null;
      const bookUrl = details.websiteUri ?? details.googleMapsUri ?? c.book_url;
      const sourceUrl = details.websiteUri ?? details.googleMapsUri ?? c.source_url;
      const book_link = buildGolfOutboundLink(bookUrl ?? "");
      // Use reservable as a positive confirmation of public access.
      // Only override if Places says reservable=true; never downgrade on false alone.
      const confirmedPublic = details.reservable === true;
      const updatedConfidence: GolfCourseResult["public_access_confidence"] =
        confirmedPublic && c.public_access_confidence !== "likely_private"
          ? "likely_public"
          : c.public_access_confidence;

      return {
        ...c,
        book_url: bookUrl,
        book_link,
        source_url: details.websiteUri ?? c.source_url,
        google_maps_uri: details.googleMapsUri ?? c.google_maps_uri,
        rating: details.rating ?? c.rating,
        user_rating_count: details.userRatingCount ?? c.user_rating_count,
        public_access: confirmedPublic || c.public_access,
        public_access_confidence: updatedConfidence,
      };
    })
  );
  return enriched.filter((c): c is GolfCourseResult => c != null);
}

function assignTierHint(c: {
  name: string;
  rating?: number;
  public_access_confidence?: string;
  quality_score: number;
  distance_miles?: number;
  user_rating_count?: number;
}): TierHint {
  const premium = namePremiumScore(c.name);
  const value = nameValueScore(c.name);
  const rating = c.rating ?? 0;
  const reviewCount = c.user_rating_count ?? 0;

  // A "municipal/value" course is one explicitly named as such — NOT simply any course that
  // happens to be publicly accessible. Many excellent resort and semi-private courses are open
  // to the public; forcing them to bronze because Google marks them as "likely_public" was
  // creating empty silver pools and removing all quality differentiation.
  const isMunicipalOrPark = value >= 10; // "municipal", "muny", "city", "public", "park", "recreation", "community" in name
  const isTopTierPremium = premium >= 14; // "resort", "links", "plantation", "dunes", "pebble", "ocean course" etc.
  const isLikelyPrivate = c.public_access_confidence === "likely_private";
  const hasStrongReviews = reviewCount >= 50 && rating >= 4.3;

  if (isLikelyPrivate) return "bronze";

  // Gold: resort / destination courses, OR any well-reviewed named golf club.
  if (isTopTierPremium && !isMunicipalOrPark && rating >= 4.2 && c.quality_score >= 55) return "gold";
  if (premium >= 6 && hasStrongReviews && !isMunicipalOrPark) return "gold";
  if (rating >= 4.5 && !isMunicipalOrPark) return "gold";

  // Bronze: municipal / park-named courses, unrated courses, clearly low-rated, or very low quality.
  if (isMunicipalOrPark) return "bronze";
  if (rating === 0) return "bronze";
  if (rating < 4.0) return "bronze";
  if (c.quality_score < 35) return "bronze";

  // Silver: everything else — well-rated accessible courses that aren't budget municipal or premium resort.
  return "silver";
}

function applyGolfTiering(
  courses: GolfCourseResult[],
  centerLat: number,
  centerLng: number,
  options?: { allowUnknown?: boolean; preserveTierHint?: boolean }
): GolfCourseResult[] {
  const allowUnknown = options?.allowUnknown ?? false;
  const preserveTierHint = options?.preserveTierHint ?? false;
  const publicOnly = courses.filter((c) =>
    c.public_access_confidence === "likely_public" || (allowUnknown && c.public_access_confidence === "unknown")
  );
  const withDistance = publicOnly.map((c) => {
    const dist = c.distance_miles ?? (c.lat != null && c.lng != null
      ? haversineMiles(centerLat, centerLng, c.lat, c.lng)
      : undefined);
    return { ...c, distance_miles: dist };
  });

  const withScores = withDistance.map((c) => {
    const quality_score = (c as { quality_score?: number }).quality_score ?? computeQualityScore(c);
    const tier_hint =
      preserveTierHint && c.tier_hint ? c.tier_hint : assignTierHint({ ...c, quality_score });
    console.log(`[GOLF_TIER] "${c.name}" | access=${c.public_access_confidence} | rating=${c.rating} | reviews=${c.user_rating_count} | premium=${namePremiumScore(c.name)} | qs=${quality_score} → ${tier_hint}`);
    return { ...c, quality_score, tier_hint };
  });

  const distTiebreaker = (a: { distance_miles?: number }, b: { distance_miles?: number }) => (a.distance_miles ?? 999) - (b.distance_miles ?? 999);
  const bronze = withScores.filter((c) => c.tier_hint === "bronze").sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0) || distTiebreaker(a, b));
  const silver = withScores.filter((c) => c.tier_hint === "silver").sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0) || distTiebreaker(a, b));
  const gold = withScores.filter((c) => c.tier_hint === "gold").sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0) || (b.rating ?? 0) - (a.rating ?? 0));

  const maxPerPool = 5;
  const bronzePool = bronze.slice(0, maxPerPool);
  const silverPool = silver.slice(0, maxPerPool);
  const goldPool = gold.slice(0, maxPerPool);
  console.log(`[GOLF_POOLS] bronze=${bronzePool.length} silver=${silverPool.length} gold=${goldPool.length} | gold_courses=${goldPool.map(c => c.name).join(", ") || "none"}`);

  const result: GolfCourseResult[] = [];
  const seen = new Set<string>();
  const maxPerTier = 5;
  for (let i = 0; i < maxPerTier; i++) {
    for (const list of [bronze, silver, gold]) {
      const c = list[i];
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        result.push(c);
      }
    }
  }
  const remaining = withScores.filter((c) => !seen.has(c.id));
  return {
    courses: [...result, ...remaining],
    pools: { bronze: bronzePool, silver: silverPool, gold: goldPool },
  };
}

// --- Catalog-first infrastructure ---
// All 20 supported metros are derived from the shared golfCities config — no
// parallel hardcoded list to maintain. The slug (e.g. "austin") matches
// metro_areas.slug and the metro column stored in golf_courses / venues.
const CITY_TO_METRO_SLUG = new Map<string, string>(
  METROS.flatMap((m) => m.cities.map((c) => [c.toLowerCase(), m.slug]))
);
const METRO_SLUG_TO_STATE = new Map<string, string>(
  METROS.map((m) => [m.slug, m.state])
);

const MIN_DB_COURSES = 8;
const MIN_DB_TIERS = 2;

/** Returns the metro slug (e.g. "austin") for a city, or null for unsupported cities. */
function getMetroSlug(city: string | undefined): string | null {
  if (!city || city === "flexible" || city === "Various") return null;
  return CITY_TO_METRO_SLUG.get(city.toLowerCase().trim()) ?? null;
}

function inferTierFromScore(score: number | null | undefined): TierHint {
  if (score == null) return "bronze";
  if (score >= 70) return "gold";
  if (score >= 50) return "silver";
  return "bronze";
}

type DbGolfRow = {
  id: string;
  name: string;
  city: string;
  state?: string;
  lat?: number;
  lng?: number;
  source_id?: string;
  place_id?: string;
  metro?: string;
  canonical_name?: string;
  public_access_confidence?: string | null;
  normalized_quality_score?: number | null;
  tier_hint?: string | null;
  editorial_boost?: number | null;
  verification_status?: "verified" | "needs_review" | "excluded" | "unreviewed" | null;
  last_verified_at?: string | null;
  last_refreshed_at?: string | null;
};

// Verification rules for package inclusion:
//   verified     → eligible, ranked normally
//   unreviewed   → eligible (default for all courses not yet manually reviewed)
//   needs_review → NOT eligible; held back until a human reviews the course
//   excluded     → NOT eligible; never shown under any circumstances
// A course must also have active = true to appear here.
async function findGolfFromDb(
  supabase: ReturnType<typeof createClient>,
  metro: string,
  state: string
): Promise<DbGolfRow[]> {
  const { data, error } = await supabase
    .from("golf_courses")
    .select("id,name,city,state,lat,lng,source_id,place_id,metro,canonical_name,public_access_confidence,normalized_quality_score,tier_hint,editorial_boost,verification_status,last_verified_at,last_refreshed_at")
    .eq("metro", metro)
    .eq("state", state.toUpperCase().slice(0, 2))
    .eq("active", true)
    .in("public_access_confidence", ["likely_public", "unknown"])
    .in("verification_status", ["verified", "unreviewed"])
    .not("source_id", "is", null)
    .order("normalized_quality_score", { ascending: false, nullsFirst: false })
    .limit(20);
  if (error) {
    console.error("DB golf query error:", error);
    return [];
  }
  return (data ?? []) as DbGolfRow[];
}

function dbMeetsThreshold(rows: DbGolfRow[]): boolean {
  if (rows.length < MIN_DB_COURSES) return false;
  const tiers = new Set<string>();
  for (const r of rows) {
    const tier = r.tier_hint || inferTierFromScore(r.normalized_quality_score);
    tiers.add(tier);
  }
  return tiers.size >= MIN_DB_TIERS;
}

function dbRowsToGolfCourseResults(
  rows: DbGolfRow[],
  centerLat: number,
  centerLng: number,
  teeWindow: { start: string; end: string }
): GolfCourseResult[] {
  return rows.map((r) => {
    const placeId = r.source_id ?? r.place_id;
    if (!placeId) return null;
    const id = String(placeId).startsWith("ChIJ") ? placeId : `places/${placeId}`;
    const name = r.canonical_name ?? r.name;
    const lat = r.lat;
    const lng = r.lng;
    const distance_miles =
      lat != null && lng != null ? haversineMiles(centerLat, centerLng, lat, lng) : undefined;
    const quality_score = r.normalized_quality_score ?? 50;
    const tier_hint = (r.tier_hint as TierHint) || inferTierFromScore(r.normalized_quality_score);
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + r.city)}`;
    // Use last_verified_at as as_of so the "Checked [date]" badge reflects when this
    // course was actually last verified, not when the search ran.
    const as_of = r.last_verified_at ?? new Date().toISOString();
    return {
      id,
      name,
      city: r.city || "Unknown",
      state: r.state,
      public_access: r.public_access_confidence === "likely_public",
      public_access_confidence: (r.public_access_confidence as GolfCourseResult["public_access_confidence"]) ?? "unknown",
      rating: undefined,
      tee_time_window: teeWindow,
      lat,
      lng,
      source_url: undefined,
      google_maps_uri: undefined,
      book_url: url,
      book_link: buildGolfOutboundLink(url),
      source: "google_places",
      as_of,
      provider: "google_places",
      quality_score,
      tier_hint,
      distance_miles,
    };
  }).filter((c): c is GolfCourseResult => c != null);
}

async function enrichDbCoursesWithPlaceDetails(
  courses: GolfCourseResult[],
  apiKey: string
): Promise<GolfCourseResult[]> {
  return enrichGolfCandidates(courses, apiKey);
}

/**
 * Check whether catalog_enabled = true for a metro in the metro_areas table.
 * When true, the itinerary builder will always prefer catalog data even if
 * the row count is below the MIN_DB_COURSES threshold.
 */
async function getCatalogEnabled(
  supabase: ReturnType<typeof createClient>,
  slug: string
): Promise<boolean> {
  const { data } = await supabase
    .from("metro_areas")
    .select("catalog_enabled")
    .eq("slug", slug)
    .single();
  return data?.catalog_enabled === true;
}

/**
 * Load up to 10 venues from the catalog for a metro.
 * These are passed to generate-itinerary as LLM context (known arenas/amphitheaters).
 * Falls back to an empty array if the catalog has no venue data yet.
 */
async function findVenuesFromDb(
  supabase: ReturnType<typeof createClient>,
  metroSlug: string
): Promise<CatalogVenue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("id,name,city,state,venue_type,website_url,ticketmaster_url,normalized_quality_score")
    .eq("metro", metroSlug)
    .eq("active", true)
    .order("normalized_quality_score", { ascending: false, nullsFirst: false })
    .limit(10);
  if (error) {
    console.error("[CATALOG] venues DB error:", error.message);
    return [];
  }
  return (data ?? []) as CatalogVenue[];
}

type PlaceNearby = {
  id?: string;
  name?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
};

function viewportFromCenter(lat: number, lng: number, radiusMiles: number): { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } {
  const degPerMileLat = 1 / 69;
  const degPerMileLng = 1 / (69 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusMiles * degPerMileLat;
  const dLng = radiusMiles * degPerMileLng;
  return {
    low: { latitude: lat - dLat, longitude: lng - dLng },
    high: { latitude: lat + dLat, longitude: lng + dLng },
  };
}

async function searchGolfGooglePlaces(
  lat: number,
  lng: number,
  radiusMeters: number,
  teeWindow: { start: string; end: string },
  apiKey: string,
  city?: string,
  state?: string
): Promise<GolfCourseResult[]> {
  const radiusMiles = radiusMeters / 1609.344;
  const locationPart = city && state ? ` in ${city}, ${state}` : city ? ` in ${city}` : "";
  const textQuery = `golf course${locationPart}`.trim();
  const viewport = viewportFromCenter(lat, lng, radiusMiles);
  const body = {
    textQuery,
    pageSize: 20,
    locationRestriction: { rectangle: viewport },
    includedType: "golf_course",
    strictTypeFiltering: true,
    routingParameters: {
      origin: { latitude: lat, longitude: lng },
    },
  };
  const fieldMask = "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,routingSummaries";
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    places?: PlaceNearby[];
    routingSummaries?: Array<{ legs?: Array<{ duration?: string; distanceMeters?: number }> }>;
  };
  const places = data.places ?? [];
  const routingSummaries = data.routingSummaries ?? [];
  const asOf = new Date().toISOString();
  return places.map((p, i) => {
    const name = p.displayName?.text ?? p.name ?? "Golf Course";
    const id = p.id ?? `golf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cityComp = p.addressComponents?.find((c) => c.types?.includes("locality"));
    const stateComp = p.addressComponents?.find((c) => c.types?.includes("administrative_area_level_1"));
    const city = cityComp?.longText ?? cityComp?.shortText ?? "";
    const state = stateComp?.shortText ?? stateComp?.longText;
    const url = p.websiteUri ?? p.googleMapsUri ?? buildGolfNowSearchUrl(name, city || "USA", state);
    const confidence = publicAccessConfidence(name);
    const routing = routingSummaries[i]?.legs?.[0];
    let distance_miles: number | undefined;
    let drive_time_minutes: number | undefined;
    if (routing?.distanceMeters != null) {
      distance_miles = Math.round((routing.distanceMeters / 1609.344) * 10) / 10;
    }
    if (routing?.duration) {
      const secMatch = routing.duration.match(/^(\d+)s?$/);
      if (secMatch) drive_time_minutes = Math.round(parseInt(secMatch[1], 10) / 6) / 10;
    }
    const book_link = buildGolfOutboundLink(url);
    return {
      id,
      name,
      city: city || "Unknown",
      state,
      public_access: confidence === "likely_public",
      public_access_confidence: confidence,
      rating: typeof p.rating === "number" ? p.rating : undefined,
      tee_time_window: teeWindow,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      source_url: p.websiteUri ?? p.googleMapsUri,
      google_maps_uri: p.googleMapsUri,
      book_url: url,
      book_link,
      source: "google_places",
      as_of: asOf,
      provider: "google_places",
      user_rating_count: typeof p.userRatingCount === "number" ? p.userRatingCount : undefined,
      ...(distance_miles != null && { distance_miles }),
      ...(drive_time_minutes != null && { drive_time_minutes }),
    };
  }).filter((c) => isLikelyPlayableCourse(c.name));
}

type HotelPlace = {
  id?: string;
  displayName?: { text?: string };
  name?: string;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  googleMapsUri?: string;
};

function priceLevelToRange(priceLevel?: string): { price_min?: number; price_max?: number; stars?: number } {
  switch (priceLevel) {
    case "PRICE_LEVEL_INEXPENSIVE": return { price_min: 80, price_max: 150, stars: 2 };
    case "PRICE_LEVEL_MODERATE":    return { price_min: 150, price_max: 250, stars: 3 };
    case "PRICE_LEVEL_EXPENSIVE":   return { price_min: 250, price_max: 400, stars: 4 };
    case "PRICE_LEVEL_VERY_EXPENSIVE": return { price_min: 400, price_max: 700, stars: 5 };
    default: return {};
  }
}

async function searchHotelsGooglePlaces(
  lat: number,
  lng: number,
  city: string,
  state: string | undefined,
  startDate: string,
  endDate: string,
  groupSize: number,
  apiKey: string
): Promise<HotelResult[]> {
  const locationPart = state ? `in ${city}, ${state}` : `in ${city}`;
  const viewport = viewportFromCenter(lat, lng, 15);
  const body = {
    textQuery: `hotel ${locationPart}`,
    pageSize: 10,
    locationRestriction: { rectangle: viewport },
    includedType: "lodging",
    strictTypeFiltering: false,
    rankPreference: "RELEVANCE",
  };
  const fieldMask = "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.rating,places.userRatingCount,places.priceLevel,places.websiteUri,places.googleMapsUri";
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places hotel search error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { places?: HotelPlace[] };
  const places = data.places ?? [];
  const asOf = new Date().toISOString();

  // Derive a 1–2 night check-out for the Booking.com search link
  const nights = Math.max(1, Math.min(2, Math.round(
    (new Date(endDate + "T12:00:00").getTime() - new Date(startDate + "T12:00:00").getTime()) / 86_400_000
  )));
  const checkOut = addDays(new Date(startDate + "T12:00:00"), nights).toISOString().slice(0, 10);

  return places
    .filter((p) => {
      const n = (p.displayName?.text ?? p.name ?? "").toLowerCase();
      if (/\bmotel 6\b|super 8\b|days inn\b|red roof\b|econo lodge\b/i.test(n)) return false;
      if (/vacation rental|airbnb\b|vrbo\b/i.test(n) && !/hotel|resort/i.test(n)) return false;
      return true;
    })
    .slice(0, 6)
    .map((p) => {
      const name = p.displayName?.text ?? p.name ?? "Hotel";
      const cityComp = p.addressComponents?.find((c) => c.types?.includes("locality"));
      const stateComp = p.addressComponents?.find((c) => c.types?.includes("administrative_area_level_1"));
      const hotelCity = cityComp?.longText ?? city;
      const hotelState = stateComp?.shortText ?? state;
      const { price_min, price_max, stars } = priceLevelToRange(p.priceLevel);

      // Booking.com search URL — AWIN affiliate wrapping applied at render time in outboundLinks.ts
      const bookingParams = new URLSearchParams({
        ss: [name, hotelCity, hotelState].filter(Boolean).join(" "),
        checkin: startDate.slice(0, 10),
        checkout: checkOut,
        group_adults: String(Math.max(1, groupSize)),
        no_rooms: "1",
        lang: "en-us",
      });
      const bookUrl = `https://www.booking.com/searchresults.html?${bookingParams}`;
      const book_link: HotelOutboundLink = {
        url: bookUrl,
        provider: "Booking.com",
        category: "hotel",
        link_type: "provider_search",
        label: "View on Booking.com",
        is_verified: false,
        confidence: "medium",
        disclaimer: "Opens Booking.com search; rates and availability not confirmed in Experience Caddie",
      };
      return {
        id: p.id ?? `hotel_gp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name,
        city: hotelCity,
        state: hotelState,
        stars,
        rating: typeof p.rating === "number" ? p.rating : undefined,
        source_url: p.websiteUri ?? p.googleMapsUri ?? bookUrl,
        book_url: bookUrl,
        book_link,
        price_min,
        price_max,
        provider: "google_places" as const,
        as_of: asOf,
      };
    });
}

function mockHotels(request: SearchRequest): HotelResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const bookUrl = "https://www.google.com/maps/search/?api=1&query=hotels";
  const bookLink: HotelOutboundLink = {
    url: bookUrl,
    provider: "Google Maps",
    category: "hotel",
    link_type: "provider_search",
    label: "Search hotels",
    is_verified: false,
    confidence: "medium",
    disclaimer: "Opens hotel search results; availability and rates are not confirmed in Experience Caddie",
  };
  return [
    {
      id: "hotel_mock_1",
      name: "Mock Boutique Hotel",
      city,
      state,
      stars: 4,
      rating: 4.6,
      image_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200",
      source_url: bookUrl,
      book_url: bookUrl,
      book_link: bookLink,
      price_min: 160,
      price_max: 320,
      provider: "mock",
    },
  ];
}

function parseRequest(url: URL): SearchRequest {
  const getString = (v: string | null) => (typeof v === "string" && v.trim() ? v : undefined);
  const getNum = (v: string | null) => {
    if (typeof v !== "string" || !v.trim()) return undefined;
    const n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  };
  const artist = getString(url.searchParams.get("artist")) ?? getString(url.searchParams.get("keyword"));
  const rawContext = getString(url.searchParams.get("_context"));
  const _context: SearchRequest["_context"] = rawContext === "background" ? "background" : "user";
  const city = getString(url.searchParams.get("city"));
  const state = getString(url.searchParams.get("state"));
  const lat = getNum(url.searchParams.get("lat"));
  const lng = getNum(url.searchParams.get("lng"));
  const startDate =
    getString(url.searchParams.get("start_date")) ?? getString(url.searchParams.get("startDate"));
  const endDate =
    getString(url.searchParams.get("end_date")) ?? getString(url.searchParams.get("endDate"));
  const teeTimeStart = getString(url.searchParams.get("tee_time_start"));
  const teeTimeEnd = getString(url.searchParams.get("tee_time_end"));
  const rawBudget = getString(url.searchParams.get("budget_tier")) ?? getString(url.searchParams.get("budgetTier"));
  const budget_tier =
    rawBudget === "low" || rawBudget === "mid" || rawBudget === "high" ? rawBudget : undefined;

  const defaultStart = toYYYYMMDD(addDays(new Date(), DEFAULT_START_OFFSET_DAYS));
  const defaultEnd = toYYYYMMDD(addMonths(addDays(new Date(), DEFAULT_START_OFFSET_DAYS), DEFAULT_WINDOW_MONTHS));

  return {
    artist: artist ?? undefined,
    destination: { city, state, lat, lng },
    dates: {
      start_date: startDate ?? defaultStart,
      end_date: endDate ?? defaultEnd,
    },
    budget_tier,
    tee_time_window:
      teeTimeStart || teeTimeEnd ? { start: teeTimeStart ?? "07:00", end: teeTimeEnd ?? "11:00" } : undefined,
    _context,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const payload = parseRequest(url);
    // For specific-artist queries the user already knows the show — allow near-term dates
    // so TM can return shows within the next few days. Discovery/flexible flows keep the
    // 14-day minimum so there's enough lead time to book golf and hotels.
    const minStartOffset = payload.artist?.trim() ? 1 : DEFAULT_START_OFFSET_DAYS;
    const { start: startDate, end: endDate } = resolveDateWindow(
      payload.dates?.start_date,
      payload.dates?.end_date,
      minStartOffset
    );

    const providers: SearchResponse["meta"]["providers"] = [];
    // For flexible/missing city: use Austin as default so we get real TM + golf instead of mock-only
    const DEFAULT_FLEXIBLE_CITY = "Austin";
    const effectiveCity =
      payload.destination?.city && payload.destination.city !== "flexible"
        ? payload.destination.city
        : DEFAULT_FLEXIBLE_CITY;

    const hasTicketmasterKey = Boolean(
      Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY")
    );
    // Ticketmaster ToS prohibits scheduled/automated API calls not triggered by a user.
    // Background callers (refresh-stale etc.) must set _context=background to skip the
    // live TM API. They will receive mock/catalog events only — real event data is not
    // needed for itinerary refresh since the itinerary already contains event details.
    const isBackgroundContext = payload._context === "background";
    if (isBackgroundContext) {
      console.log("[COMPLIANCE] background context — skipping live Ticketmaster API (ToS guardrail)");
      await logProviderError(
        "ticketmaster",
        null,
        "background context: live API call suppressed by compliance guardrail",
        "search"
      );
    }
    const shouldCallTicketmaster =
      !isBackgroundContext &&
      hasTicketmasterKey &&
      (Boolean(payload.artist?.trim()) || Boolean(effectiveCity));

    let events: EventResult[];

    if (shouldCallTicketmaster) {
      try {
        const tmEvents = await searchTicketmaster({
          artist: payload.artist,
          city: effectiveCity,
          state: payload.destination?.state,
          startDate,
          endDate,
          size: 15,
        });
        const tmFiltered = tmEvents.filter((e) => {
          const venue = e._embedded?.venues?.[0];
          if (!venueMatchesUserCity(effectiveCity, venue)) {
            console.log(
              `[TM] skip city mismatch: want="${effectiveCity}" got="${venue?.city?.name}" event="${e.name}"`
            );
            return false;
          }
          if (!tmEventMatchesArtistQuery(e, payload.artist)) {
            console.log(`[TM] skip artist mismatch: artist="${payload.artist}" event="${e.name}"`);
            return false;
          }
          return true;
        });
        events = tmFiltered.map((e) =>
          mapEventToResult(e, effectiveCity, payload.destination?.state)
        );
        if (events.length > 0) providers.push("ticketmaster");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const statusMatch = msg.match(/error (\d{3})/i);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
        console.error("Ticketmaster search error:", err);
        await logProviderError("ticketmaster", statusCode, msg, "search");
        events = mockEvents(
          { ...payload, destination: { ...payload.destination, city: effectiveCity } },
          startDate,
          endDate
        );
        providers.push("mock");
      }
    } else {
      events = mockEvents(
        { ...payload, destination: { ...payload.destination, city: effectiveCity } },
        startDate,
        endDate
      );
      providers.push("mock");
    }

    // Catalog-first events: if Ticketmaster returned nothing (or wasn't called) and
    // an artist name was provided, look up matching events from our internal events table.
    // This ensures featured artists (Luke Combs, Billie Eilish, etc.) return our seeded
    // events even when Ticketmaster has no confirmed tour dates in the date range.
    if (events.length === 0 && payload.artist?.trim()) {
      const sbUrl = Deno.env.get("SUPABASE_URL");
      const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (sbUrl && sbKey) {
        try {
          const sb = createClient(sbUrl, sbKey);
          const catalogEvts = await findCatalogEvents(sb, payload.artist, effectiveCity, startDate, endDate);
          if (catalogEvts.length > 0) {
            events = catalogEvts;
            (providers as string[]).push("catalog");
            console.log(`[CATALOG] events: found ${catalogEvts.length} catalog event(s) for artist="${payload.artist}" city="${effectiveCity}"`);
          }
        } catch (err) {
          console.error("[CATALOG] events lookup error:", err);
        }
      }
    }

    let golfCourses: GolfCourseResult[];
    let bronzePool: GolfCourseResult[] = [];
    let silverPool: GolfCourseResult[] = [];
    let goldPool: GolfCourseResult[] = [];
    const teeWindow = payload.tee_time_window ?? { start: "07:00", end: "11:00" };
    const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    const hasCity = effectiveCity && effectiveCity !== "flexible" && effectiveCity !== "Various";

    const resolveGolfCenter = async (): Promise<{ lat: number; lng: number } | null> => {
      if (payload.destination?.lat != null && payload.destination?.lng != null) {
        return { lat: payload.destination.lat, lng: payload.destination.lng };
      }
      if (events.length > 0) {
        const v = events[0]?.venue;
        if (v && typeof v.lat === "number" && typeof v.lng === "number") {
          return { lat: v.lat, lng: v.lng };
        }
      }
      if (hasCity) {
        return await geocodeCity(effectiveCity, payload.destination?.state ?? undefined);
      }
      return null;
    };

    // Catalog-first state (populated below, included in the response for observability)
    let catalogVenues: CatalogVenue[] = [];
    let catalogEnabled = false;
    let golfSource: "catalog" | "live_api" | "mock" = "mock";
    const metroSlug = getMetroSlug(effectiveCity);
    // Shared resolved center — used for both golf and hotel searches to avoid a second geocode.
    let resolvedCenter: { lat: number; lng: number } | null = null;

    if (googleKey) {
      try {
        const center = await resolveGolfCenter();
        resolvedCenter = center;
        if (center) {
          const stateCode = (
            payload.destination?.state ??
            events[0]?.venue?.state ??
            (metroSlug ? METRO_SLUG_TO_STATE.get(metroSlug) : "")
          )?.toUpperCase().slice(0, 2) || "";

          let useDbPath = false;

          // --- Catalog-first path ---
          // For any of the 20 supported metros, try the internal catalog before
          // hitting live APIs. Falls through to Google Places when the catalog
          // doesn't have enough data yet (below MIN_DB_COURSES / MIN_DB_TIERS).
          if (metroSlug) {
            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (supabaseUrl && supabaseKey) {
              const supabase = createClient(supabaseUrl, supabaseKey);

              // Fetch catalog_enabled flag, golf rows, and venue rows in parallel
              // to minimise latency — we need all three regardless of the result.
              const [isEnabled, dbRows, venueRows] = await Promise.all([
                getCatalogEnabled(supabase, metroSlug),
                findGolfFromDb(supabase, metroSlug, stateCode),
                findVenuesFromDb(supabase, metroSlug),
              ]);
              catalogEnabled = isEnabled;
              catalogVenues = venueRows;

              console.log(
                `[CATALOG] metro=${metroSlug} catalog_enabled=${isEnabled} golf_rows=${dbRows.length} venue_rows=${venueRows.length}`
              );

              if (dbMeetsThreshold(dbRows)) {
                useDbPath = true;
                golfSource = "catalog";

                // Google Places ToS: cached place data should not be served beyond 30 days.
                // Log a warning to provider_errors when stale catalog data is being served
                // so the daily health check surfaces the need for a catalog refresh.
                const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                const staleRows = dbRows.filter((r) => !r.last_refreshed_at || r.last_refreshed_at < staleCutoff);
                if (staleRows.length > 0) {
                  console.warn(`[COMPLIANCE] ${staleRows.length}/${dbRows.length} catalog courses have last_refreshed_at > 30 days for metro=${metroSlug}. Run refresh-catalog to stay within Google Places ToS caching limits.`);
                  await logProviderError(
                    "google_places",
                    null,
                    `${staleRows.length} catalog courses in metro=${metroSlug} have last_refreshed_at > 30 days — run refresh-catalog`,
                    "search"
                  ).catch(() => {});
                }

                const dbResults = dbRowsToGolfCourseResults(dbRows, center.lat, center.lng, teeWindow);
                const enriched = await enrichDbCoursesWithPlaceDetails(dbResults, googleKey);
                const tiered = applyGolfTiering(enriched, center.lat, center.lng, {
                  allowUnknown: true,
                  preserveTierHint: true,
                });
                golfCourses = tiered.courses;
                bronzePool = tiered.pools.bronze;
                silverPool = tiered.pools.silver;
                goldPool = tiered.pools.gold;
              } else {
                console.log(
                  `[CATALOG] metro=${metroSlug} — catalog insufficient (${dbRows.length} rows / ${new Set(dbRows.map((r) => r.tier_hint || "bronze")).size} tiers); falling back to Google Places`
                );
              }
            }
          } else {
            console.log(`[CATALOG] city="${effectiveCity}" not in any supported metro — using live API`);
          }

          // --- Live API fallback ---
          // Unchanged from pre-Step-4 behaviour; runs for unsupported metros
          // and for supported metros where the catalog is not yet populated.
          if (!useDbPath) {
            golfSource = "live_api";
            const raw = await searchGolfGooglePlaces(
              center.lat,
              center.lng,
              48280,
              teeWindow,
              googleKey,
              effectiveCity !== "Various" ? effectiveCity : undefined,
              payload.destination?.state
            );
            const preFiltered = applyQualityPreFilter(raw);
            const enriched = await enrichGolfCandidates(preFiltered, googleKey);
            const tiered = applyGolfTiering(enriched, center.lat, center.lng, { allowUnknown: true });
            golfCourses = tiered.courses;
            bronzePool = tiered.pools.bronze;
            silverPool = tiered.pools.silver;
            goldPool = tiered.pools.gold;
          }

          if (golfCourses.length > 0 && !providers.includes("google_places")) {
            providers.push("google_places");
          }
        } else {
          golfSource = "mock";
          golfCourses = mockGolf({
            ...payload,
            destination: { ...payload.destination, city: effectiveCity },
          });
          silverPool = [...golfCourses];
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const statusMatch = msg.match(/error (\d{3})/i);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
        console.error("Google Places golf search error:", err);
        await logProviderError("google_places", statusCode, msg, "search");
        golfSource = "mock";
        golfCourses = mockGolf({
          ...payload,
          destination: { ...payload.destination, city: effectiveCity },
        });
        silverPool = [...golfCourses];
      }
    } else {
      golfSource = "mock";
      golfCourses = mockGolf({
        ...payload,
        destination: { ...payload.destination, city: effectiveCity },
      });
      silverPool = [...golfCourses];
    }

    // Hotel search — Google Places for real hotel names, with mock fallback.
    // Background context skips live API calls (Ticketmaster compliance guardrail already
    // applies above; we apply the same rule here for consistency).
    let hotels: HotelResult[];
    if (googleKey && resolvedCenter && !isBackgroundContext) {
      try {
        const realHotels = await searchHotelsGooglePlaces(
          resolvedCenter.lat,
          resolvedCenter.lng,
          effectiveCity,
          payload.destination?.state,
          startDate,
          endDate,
          payload.group_size ?? 2,
          googleKey
        );
        if (realHotels.length > 0) {
          hotels = realHotels;
          console.log(`[HOTELS] ${hotels.length} real hotels from Google Places for city="${effectiveCity}"`);
        } else {
          console.log("[HOTELS] Google Places returned 0 hotels — falling back to mock");
          hotels = mockHotels({ ...payload, destination: { ...payload.destination, city: effectiveCity } });
          if (!providers.includes("mock")) providers.push("mock");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[HOTELS] Google Places hotel search error:", msg);
        await logProviderError("google_places", null, `hotel search: ${msg}`, "search");
        hotels = mockHotels({ ...payload, destination: { ...payload.destination, city: effectiveCity } });
        if (!providers.includes("mock")) providers.push("mock");
      }
    } else {
      hotels = mockHotels({ ...payload, destination: { ...payload.destination, city: effectiveCity } });
      if (!providers.includes("mock")) providers.push("mock");
    }

    const response: SearchResponse = {
      destination: { city: effectiveCity, state: payload.destination?.state, start_date: startDate, end_date: endDate },
      events,
      golf_courses: golfCourses,
      bronze_golf_candidates: bronzePool.length > 0 ? bronzePool : undefined,
      silver_golf_candidates: silverPool.length > 0 ? silverPool : undefined,
      gold_golf_candidates: goldPool.length > 0 ? goldPool : undefined,
      hotels,
      ...(catalogVenues.length > 0 && { catalog_venues: catalogVenues }),
      catalog_meta: {
        metro_slug: metroSlug,
        catalog_enabled: catalogEnabled,
        golf_source: golfSource,
        venues_from_catalog: catalogVenues.length,
      },
      meta: {
        providers,
        cached: false,
        generated_at: new Date().toISOString(),
        request_id: crypto.randomUUID(),
      },
    };

    return json(response, 200, corsHeaders);
  } catch (e: unknown) {
    await reportError(e, { function: "search" });
    return json({ error: "Search failed" }, 500, corsHeaders);
  }
});
