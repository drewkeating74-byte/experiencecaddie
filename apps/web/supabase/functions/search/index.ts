/**
 * Search Edge Function — Ticketmaster events + Google Places golf + mock hotels.
 * Phase 1A: DB-first golf lookup for Phoenix, Nashville, Austin when pool is strong enough.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reportError } from "../_shared/monitoring.ts";

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

const BASE_URL = "https://app.ticketmaster.com/discovery/v2";
const DEFAULT_START_OFFSET_DAYS = 14; // Search starts 2 weeks from today
const DEFAULT_WINDOW_MONTHS = 9; // Search spans 9 months from start
const MAX_WINDOW_MONTHS = 12;

type TMVenue = {
  name?: string;
  city?: { name?: string };
  state?: { name?: string; stateCode?: string };
  address?: { line1?: string };
  location?: { latitude?: string; longitude?: string };
  id?: string;
};

type TMEvent = {
  id?: string;
  name?: string;
  url?: string;
  images?: Array<{ url?: string; width?: number; ratio?: string }>;
  dates?: { start?: { localDate?: string; localTime?: string; dateTBD?: boolean } };
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  _embedded?: {
    venues?: TMVenue[];
    attractions?: Array<{ name?: string }>;
  };
};

type TMResponse = { _embedded?: { events?: TMEvent[] }; page?: { totalElements?: number } };

type SearchRequest = {
  artist?: string;
  destination: { city?: string; state?: string; lat?: number; lng?: number };
  dates: { start_date: string; end_date: string };
  group_size?: number;
  budget_tier?: "low" | "mid" | "high";
  tee_time_window?: { start: string; end: string };
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
  provider: "mock";
};

type SearchResponse = {
  destination: { city: string; state?: string; start_date: string; end_date: string };
  events: EventResult[];
  golf_courses: GolfCourseResult[];
  bronze_golf_candidates?: GolfCourseResult[];
  silver_golf_candidates?: GolfCourseResult[];
  gold_golf_candidates?: GolfCourseResult[];
  hotels: HotelResult[];
  meta: { providers: ("ticketmaster" | "google_places" | "mock")[]; cached: boolean; generated_at: string; request_id: string };
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

function resolveDateWindow(startDate?: string, endDate?: string): { start: string; end: string } {
  const today = new Date();
  const defaultStart = addDays(today, DEFAULT_START_OFFSET_DAYS);
  const defaultEnd = addMonths(defaultStart, DEFAULT_WINDOW_MONTHS);
  const minStartStr = toYYYYMMDD(defaultStart);

  let start: Date;
  let end: Date;
  if (startDate && endDate) {
    start = new Date(startDate + "T12:00:00");
    end = new Date(endDate + "T12:00:00");
    if (isNaN(start.getTime())) start = defaultStart;
    if (isNaN(end.getTime())) end = addMonths(defaultStart, DEFAULT_WINDOW_MONTHS);
    // Enforce minimum start: never search past events; start at least 2 weeks from today
    const startStr = toYYYYMMDD(start);
    if (startStr < minStartStr) start = defaultStart;
    if (end <= start) end = addMonths(start, DEFAULT_WINDOW_MONTHS);
  } else {
    start = defaultStart;
    end = defaultEnd;
  }
  const maxEnd = addMonths(start, MAX_WINDOW_MONTHS);
  if (end > maxEnd) end = maxEnd;
  return { start: toYYYYMMDD(start), end: toYYYYMMDD(end) };
}

async function searchTicketmaster(params: {
  artist?: string;
  city?: string;
  state?: string;
  startDate: string;
  endDate: string;
  size?: number;
}): Promise<TMEvent[]> {
  const apiKey = Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY");
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY or TICKETMASTER_CONSUMER_KEY not set");
  const url = new URL(`${BASE_URL}/events.json`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("classificationName", "Music");
  url.searchParams.set("size", String(params.size ?? 15));
  url.searchParams.set("sort", "date,asc");
  if (params.artist?.trim()) url.searchParams.set("keyword", params.artist.trim());
  if (params.city?.trim() && params.city !== "flexible") url.searchParams.set("city", params.city.trim());
  if (params.state?.trim()) url.searchParams.set("stateCode", params.state.trim().toUpperCase().slice(0, 2));
  url.searchParams.set("startDateTime", `${params.startDate}T00:00:00Z`);
  url.searchParams.set("endDateTime", `${params.endDate}T23:59:59Z`);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ticketmaster API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as TMResponse;
  return data._embedded?.events ?? [];
}

/** Build a Ticketmaster search URL (reliable; avoids event-level 404s). Uses artist name only for better results. */
function buildTicketmasterSearchUrl(searchTerm: string): string {
  const q = (searchTerm || "").trim() || "concerts";
  return `https://www.ticketmaster.com/search?q=${encodeURIComponent(q)}`;
}

/** Returns true if the URL looks like a valid Ticketmaster event page. */
function isUsableTicketmasterEventUrl(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const u = url.trim();
  if (!u.startsWith("https://")) return false;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.replace(/^www\./, "");
    return host === "ticketmaster.com" || host.endsWith(".ticketmaster.com");
  } catch {
    return false;
  }
}

function mapEventToResult(
  event: TMEvent,
  fallbackCity: string,
  fallbackState?: string
): EventResult {
  const venue = event._embedded?.venues?.[0];
  const attraction = event._embedded?.attractions?.[0];
  const eventName = event.name ?? attraction?.name ?? "Concert";
  const artistName = attraction?.name ?? event.name ?? "Concert";
  const localDate = event.dates?.start?.localDate ?? "";
  const localTime = event.dates?.start?.localTime ?? "20:00:00";
  const dateTime = localDate ? `${localDate}T${localTime}` : "";
  const priceRange = event.priceRanges?.[0];
  const lat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : undefined;
  const lng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : undefined;
  const city = venue?.city?.name ?? fallbackCity;
  const state = venue?.state?.stateCode ?? venue?.state?.name ?? fallbackState;
  const useDirectUrl = isUsableTicketmasterEventUrl(event.url);
  const ticketUrl = useDirectUrl ? event.url!.trim() : buildTicketmasterSearchUrl(artistName);

  const book_link: ConcertOutboundLink = useDirectUrl
    ? {
        url: ticketUrl,
        provider: "Ticketmaster",
        category: "concert",
        link_type: "direct_event",
        label: "Tickets",
        is_verified: false,
        confidence: "low",
        disclaimer: undefined,
      }
    : {
        url: ticketUrl,
        provider: "Ticketmaster",
        category: "concert",
        link_type: "provider_search",
        label: "Find tickets",
        is_verified: false,
        confidence: "medium",
        disclaimer: "Opens Ticketmaster search results for this event",
      };

  return {
    id: event.id ?? `tm_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: eventName,
    date_time: dateTime,
    venue: {
      name: venue?.name ?? "Venue",
      city,
      state,
      lat,
      lng,
      capacity: undefined,
    },
    image_url: event.images?.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
    source_url: ticketUrl,
    book_url: ticketUrl,
    book_link,
    price_min: priceRange?.min,
    price_max: priceRange?.max,
    provider: "ticketmaster",
  };
}

function mockEvents(request: SearchRequest, startDate: string, endDate: string): EventResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const ticketUrl = "https://www.google.com/search?q=concerts+tickets";
  const book_link: ConcertOutboundLink = {
    url: ticketUrl,
    provider: "Google",
    category: "concert",
    link_type: "provider_search",
    label: "Search tickets",
    is_verified: false,
    confidence: "medium",
    disclaimer: "Opens ticket search results across multiple vendors; availability is not confirmed in Experience Caddie",
  };
  return [
    {
      id: "event_mock_1",
      name: "Sample Concert",
      date_time: `${startDate}T20:00:00Z`,
      venue: { name: "Mock Arena", city, state, capacity: 12000 },
      image_url: "https://images.unsplash.com/flagged/photo-1578703916946-53d0d7e6bbd0?w=1200",
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
  return filtered
    .sort((a, b) => preliminaryQualityScore(b) - preliminaryQualityScore(a))
    .slice(0, ENRICHMENT_SHORTLIST_SIZE);
}

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string
): Promise<{ websiteUri?: string; googleMapsUri?: string; rating?: number; userRatingCount?: number; businessStatus?: string } | null> {
  const id = placeId.replace(/^places\//, "");
  const url = `https://places.googleapis.com/v1/places/${id}`;
  const fieldMask = "websiteUri,googleMapsUri,rating,userRatingCount,businessStatus";
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
      return {
        ...c,
        book_url: bookUrl,
        book_link,
        source_url: details.websiteUri ?? c.source_url,
        google_maps_uri: details.googleMapsUri ?? c.google_maps_uri,
        rating: details.rating ?? c.rating,
        user_rating_count: details.userRatingCount ?? c.user_rating_count,
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
  if (rating >= 4.5 && c.quality_score >= 55 && !isMunicipalOrPark) return "gold";

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

// --- Phase 1A: DB-first golf catalog ---
const CITY_TO_METRO: Record<string, string> = {
  phoenix: "Phoenix",
  scottsdale: "Phoenix",
  tempe: "Phoenix",
  mesa: "Phoenix",
  gilbert: "Phoenix",
  nashville: "Nashville",
  franklin: "Nashville",
  brentwood: "Nashville",
  austin: "Austin",
  "round rock": "Austin",
  "cedar park": "Austin",
};

const MIN_DB_COURSES = 8;
const MIN_DB_TIERS = 2;

const METRO_STATE: Record<string, string> = {
  Phoenix: "AZ",
  Nashville: "TN",
  Austin: "TX",
};

function getMetro(city: string | undefined): string | null {
  if (!city || city === "flexible" || city === "Various") return null;
  const key = String(city).toLowerCase().trim();
  return CITY_TO_METRO[key] ?? null;
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
};

async function findGolfFromDb(
  supabase: ReturnType<typeof createClient>,
  metro: string,
  state: string
): Promise<DbGolfRow[]> {
  const { data, error } = await supabase
    .from("golf_courses")
    .select("id,name,city,state,lat,lng,source_id,place_id,metro,canonical_name,public_access_confidence,normalized_quality_score,tier_hint,editorial_boost")
    .eq("metro", metro)
    .eq("state", state.toUpperCase().slice(0, 2))
    .eq("active", true)
    .in("public_access_confidence", ["likely_public", "unknown"])
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
  const asOf = new Date().toISOString();
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
      as_of: asOf,
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

function mockHotels(request: SearchRequest): HotelResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const bookUrl = "https://www.google.com/travel/hotels?q=hotels";
  const bookLink: HotelOutboundLink = {
    url: bookUrl,
    provider: "Google Hotels",
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
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const payload = parseRequest(url);
    const { start: startDate, end: endDate } = resolveDateWindow(
      payload.dates?.start_date,
      payload.dates?.end_date
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
    const shouldCallTicketmaster =
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
        events = tmEvents.map((e) =>
          mapEventToResult(e, effectiveCity, payload.destination?.state)
        );
        if (events.length > 0) providers.push("ticketmaster");
      } catch (err) {
        console.error("Ticketmaster search error:", err);
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

    if (googleKey) {
      try {
        const center = await resolveGolfCenter();
        if (center) {
          const metro = getMetro(effectiveCity);
          const state =
            payload.destination?.state ??
            events[0]?.venue?.state ??
            (metro ? METRO_STATE[metro] : "");
          const stateCode = state?.toUpperCase().slice(0, 2) || "";

          let useDbPath = false;
          if (metro && stateCode) {
            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (supabaseUrl && supabaseKey) {
              const supabase = createClient(supabaseUrl, supabaseKey);
              const dbRows = await findGolfFromDb(supabase, metro, stateCode);
              if (dbMeetsThreshold(dbRows)) {
                useDbPath = true;
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
              }
            }
          }

          if (!useDbPath) {
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
          golfCourses = mockGolf({
            ...payload,
            destination: { ...payload.destination, city: effectiveCity },
          });
          silverPool = [...golfCourses];
        }
      } catch (err) {
        console.error("Google Places golf search error:", err);
        golfCourses = mockGolf({
          ...payload,
          destination: { ...payload.destination, city: effectiveCity },
        });
        silverPool = [...golfCourses];
      }
    } else {
      golfCourses = mockGolf({
        ...payload,
        destination: { ...payload.destination, city: effectiveCity },
      });
      silverPool = [...golfCourses];
    }

    const hotels = mockHotels({
      ...payload,
      destination: { ...payload.destination, city: effectiveCity },
    });
    if (!providers.includes("mock")) providers.push("mock");

    const response: SearchResponse = {
      destination: { city: effectiveCity, state: payload.destination?.state, start_date: startDate, end_date: endDate },
      events,
      golf_courses: golfCourses,
      bronze_golf_candidates: bronzePool.length > 0 ? bronzePool : undefined,
      silver_golf_candidates: silverPool.length > 0 ? silverPool : undefined,
      gold_golf_candidates: goldPool.length > 0 ? goldPool : undefined,
      hotels,
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
