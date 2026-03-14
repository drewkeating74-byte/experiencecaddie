/**
 * Search Edge Function — Ticketmaster events + Google Places golf + mock hotels.
 */
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
const DEFAULT_WINDOW_MONTHS = 6;
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

type EventResult = {
  id: string;
  name: string;
  date_time: string;
  venue: { name: string; city: string; state?: string; lat?: number; lng?: number; capacity?: number };
  image_url?: string;
  source_url?: string;
  book_url?: string;
  price_min?: number;
  price_max?: number;
  provider: "ticketmaster" | "mock";
};

type TierHint = "bronze" | "silver" | "gold";

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
  book_url?: string;
  price_min?: number;
  price_max?: number;
  source?: string;
  as_of?: string;
  provider: "google_places" | "mock";
  quality_score?: number;
  tier_hint?: TierHint;
  distance_miles?: number;
  user_rating_count?: number;
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
  price_min?: number;
  price_max?: number;
  provider: "mock";
};

type SearchResponse = {
  destination: { city: string; state?: string; start_date: string; end_date: string };
  events: EventResult[];
  golf_courses: GolfCourseResult[];
  hotels: HotelResult[];
  meta: { providers: ("ticketmaster" | "google_places" | "mock")[]; cached: boolean; generated_at: string; request_id: string };
};

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
  let start: Date;
  let end: Date;
  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    if (isNaN(start.getTime())) start = today;
    if (isNaN(end.getTime())) end = addMonths(today, DEFAULT_WINDOW_MONTHS);
    if (end <= start) end = addMonths(start, DEFAULT_WINDOW_MONTHS);
  } else {
    start = today;
    end = addMonths(today, DEFAULT_WINDOW_MONTHS);
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

function mapEventToResult(
  event: TMEvent,
  fallbackCity: string,
  fallbackState?: string
): EventResult {
  const venue = event._embedded?.venues?.[0];
  const attraction = event._embedded?.attractions?.[0];
  const eventName = event.name ?? attraction?.name ?? "Concert";
  const localDate = event.dates?.start?.localDate ?? "";
  const localTime = event.dates?.start?.localTime ?? "20:00:00";
  const dateTime = localDate ? `${localDate}T${localTime}` : "";
  const priceRange = event.priceRanges?.[0];
  const lat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : undefined;
  const lng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : undefined;

  return {
    id: event.id ?? `tm_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: eventName,
    date_time: dateTime,
    venue: {
      name: venue?.name ?? "Venue",
      city: venue?.city?.name ?? fallbackCity,
      state: venue?.state?.stateCode ?? venue?.state?.name ?? fallbackState,
      lat,
      lng,
      capacity: undefined,
    },
    image_url: event.images?.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
    source_url: event.url,
    book_url: event.url,
    price_min: priceRange?.min,
    price_max: priceRange?.max,
    provider: "ticketmaster",
  };
}

function mockEvents(request: SearchRequest, startDate: string, endDate: string): EventResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  return [
    {
      id: "event_mock_1",
      name: "Sample Concert",
      date_time: `${startDate}T20:00:00Z`,
      venue: { name: "Mock Arena", city, state, capacity: 12000 },
      image_url: "https://images.unsplash.com/flagged/photo-1578703916946-53d0d7e6bbd0?w=1200",
      source_url: "https://www.ticketmaster.com/",
      book_url: "https://www.ticketmaster.com/",
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
      source_url: "https://www.golfnow.com/",
      book_url: "https://www.golfnow.com/",
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
  if (/country club|private|members only/i.test(n)) return "likely_private";
  if (/municipal|public|city\b/i.test(n)) return "likely_public";
  return "unknown";
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
  if (/resort|country club|private club|national\b/i.test(n) && !/public|municipal/i.test(n)) return 20;
  if (/golf club|club\b|links\b|plantation\b/i.test(n) && !/municipal|city|public/i.test(n)) return 12;
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
  distance_rank?: number;
  user_rating_count?: number;
}): number {
  let score = 0;
  const rating = c.rating ?? 0;
  score += Math.min(30, rating * 6);
  const premium = namePremiumScore(c.name);
  score += premium;
  const value = nameValueScore(c.name);
  if (value > 0) score += Math.min(15, value);
  if (c.public_access_confidence === "likely_public") score += 8;
  if (c.public_access_confidence === "unknown") score += 4;
  if (c.distance_miles != null && c.distance_miles < 10) score += 10;
  else if (c.distance_miles != null && c.distance_miles < 20) score += 5;
  const reviewCount = c.user_rating_count ?? 0;
  if (reviewCount >= 100) score += 4;
  else if (reviewCount >= 50) score += 2;
  return Math.min(100, Math.round(score));
}

function assignTierHint(c: {
  name: string;
  rating?: number;
  public_access_confidence?: string;
  quality_score: number;
  distance_miles?: number;
  distance_rank: number;
}): TierHint {
  const premium = namePremiumScore(c.name);
  const value = nameValueScore(c.name);
  const rating = c.rating ?? 0;
  const isValueCourse = value >= 10 || c.public_access_confidence === "likely_public";
  const isPremiumCourse = premium >= 12 && rating >= 4.0;

  if (isPremiumCourse && !isValueCourse && rating >= 4.2 && c.quality_score >= 70) return "gold";
  if (isValueCourse || (c.distance_rank <= 2 && rating < 4.3) || c.quality_score < 55) return "bronze";
  return "silver";
}

function applyGolfTiering(
  courses: GolfCourseResult[],
  centerLat: number,
  centerLng: number
): GolfCourseResult[] {
  const withDistance = courses.map((c) => {
    const dist =
      c.lat != null && c.lng != null
        ? haversineMiles(centerLat, centerLng, c.lat, c.lng)
        : undefined;
    return { ...c, distance_miles: dist };
  });
  const sortedByDist = [...withDistance].sort((a, b) => (a.distance_miles ?? 999) - (b.distance_miles ?? 999));
  const withRank = sortedByDist.map((c, i) => ({ ...c, distance_rank: i }));

  const withScores = withRank.map((c) => {
    const quality_score = computeQualityScore(c);
    const tier_hint = assignTierHint({ ...c, quality_score });
    return { ...c, quality_score, tier_hint };
  });

  const bronze = withScores.filter((c) => c.tier_hint === "bronze");
  const silver = withScores.filter((c) => c.tier_hint === "silver");
  const gold = withScores.filter((c) => c.tier_hint === "gold");

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
  return [...result, ...remaining];
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

async function searchGolfGooglePlaces(
  lat: number,
  lng: number,
  radiusMeters: number,
  teeWindow: { start: string; end: string },
  apiKey: string
): Promise<GolfCourseResult[]> {
  const body = {
    includedTypes: ["golf_course"],
    maxResultCount: 20,
    rankPreference: "DISTANCE",
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
  };
  const fieldMask = "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount";
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
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
  const data = (await res.json()) as { places?: PlaceNearby[] };
  const places = data.places ?? [];
  const asOf = new Date().toISOString();
  return places.map((p) => {
    const name = p.displayName?.text ?? p.name ?? "Golf Course";
    const id = p.id ?? `golf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cityComp = p.addressComponents?.find((c) => c.types?.includes("locality"));
    const stateComp = p.addressComponents?.find((c) => c.types?.includes("administrative_area_level_1"));
    const city = cityComp?.longText ?? cityComp?.shortText ?? "";
    const state = stateComp?.shortText ?? stateComp?.longText;
    const url = p.websiteUri ?? p.googleMapsUri ?? buildGolfNowSearchUrl(name, city || "USA", state);
    const confidence = publicAccessConfidence(name);
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
      book_url: url,
      source: "google_places",
      as_of: asOf,
      provider: "google_places",
    };
  });
}

function mockHotels(request: SearchRequest): HotelResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  return [
    {
      id: "hotel_mock_1",
      name: "Mock Boutique Hotel",
      city,
      state,
      stars: 4,
      rating: 4.6,
      image_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200",
      source_url: "https://www.booking.com/",
      book_url: "https://www.booking.com/",
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

  const today = toYYYYMMDD(new Date());
  const sixMo = toYYYYMMDD(addMonths(new Date(), DEFAULT_WINDOW_MONTHS));

  return {
    artist: artist ?? undefined,
    destination: { city, state, lat, lng },
    dates: {
      start_date: startDate ?? today,
      end_date: endDate ?? sixMo,
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
    const effectiveCity =
      payload.destination?.city && payload.destination.city !== "flexible"
        ? payload.destination.city
        : "Various";

    const hasTicketmasterKey = Boolean(
      Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY")
    );
    const shouldCallTicketmaster =
      hasTicketmasterKey &&
      (Boolean(payload.artist?.trim()) ||
        (Boolean(payload.destination?.city) && payload.destination?.city !== "flexible"));

    let events: EventResult[];

    if (shouldCallTicketmaster) {
      try {
        const tmEvents = await searchTicketmaster({
          artist: payload.artist,
          city: payload.destination?.city && payload.destination.city !== "flexible"
            ? payload.destination.city
            : undefined,
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
          let raw = await searchGolfGooglePlaces(
            center.lat,
            center.lng,
            48000,
            teeWindow,
            googleKey
          );
          golfCourses = applyGolfTiering(raw, center.lat, center.lng);
          if (golfCourses.length > 0 && !providers.includes("google_places")) {
            providers.push("google_places");
          }
        } else {
          golfCourses = mockGolf({
            ...payload,
            destination: { ...payload.destination, city: effectiveCity },
          });
        }
      } catch (err) {
        console.error("Google Places golf search error:", err);
        golfCourses = mockGolf({
          ...payload,
          destination: { ...payload.destination, city: effectiveCity },
        });
      }
    } else {
      golfCourses = mockGolf({
        ...payload,
        destination: { ...payload.destination, city: effectiveCity },
      });
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
      hotels,
      meta: {
        providers,
        cached: false,
        generated_at: new Date().toISOString(),
        request_id: crypto.randomUUID(),
      },
    };

    return json(response, 200, corsHeaders);
  } catch (e) {
    console.error("Search error:", e);
    return json({ error: "Search failed" }, 500, corsHeaders);
  }
});
