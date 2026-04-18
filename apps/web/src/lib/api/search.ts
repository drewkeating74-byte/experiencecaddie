export type Provider =
  | "ticketmaster"
  | "seatgeek"
  | "stubhub"
  | "golfnow"
  | "teeoff"
  | "expedia"
  | "booking"
  | "hotels"
  | "google_places"
  | "mock";

export type SearchRequest = {
  artist?: string;
  destination: { city?: string; state?: string; lat?: number; lng?: number };
  dates: { start_date: string; end_date: string };
  group_size?: number;
  budget_tier?: "low" | "mid" | "high";
  tee_time_window?: { start: string; end: string };
};

/** Outbound link shape for concerts (matches OutboundLink from types/outbound-link). */
export type ConcertOutboundLink = {
  url: string;
  provider: string;
  category: "concert";
  link_type: "direct_event" | "provider_search" | "manual_fallback";
  label: string;
  is_verified: boolean;
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

/** Outbound link shape for hotels (matches OutboundLink from types/outbound-link). */
export type HotelOutboundLink = {
  url: string;
  provider: string;
  category: "hotel";
  link_type: "direct_listing" | "provider_search" | "manual_fallback";
  label: string;
  is_verified: boolean;
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

/** Outbound link shape for golf (matches OutboundLink from types/outbound-link). */
export type GolfOutboundLink = {
  url: string;
  provider: string;
  category: "golf";
  link_type: "direct_listing" | "provider_search" | "manual_fallback";
  label: string;
  is_verified: boolean;
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

export type EventResult = {
  id: string;
  name: string;
  date_time: string;
  venue: { name: string; city: string; state?: string; lat?: number; lng?: number; capacity?: number };
  image_url?: string;
  source_url?: string;
  book_url?: string;
  /** Structured outbound link (Phase 2). When present, prefer over book_url for UI. */
  book_link?: ConcertOutboundLink;
  price_min?: number;
  price_max?: number;
  provider: Provider;
};

export type TierHint = "bronze" | "silver" | "gold";

export type GolfCourseResult = {
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
  /** Structured outbound link (Phase 4). When present, prefer over book_url for UI. */
  book_link?: GolfOutboundLink;
  price_min?: number;
  price_max?: number;
  source?: string;
  as_of?: string;
  provider: Provider;
  /** 0–100 quality score from tiering logic (optional) */
  quality_score?: number;
  /** Suggested package tier (bronze/silver/gold) for varied packages */
  tier_hint?: TierHint;
  /** Distance in miles from search center (optional) */
  distance_miles?: number;
  /** Drive time in minutes from search center when routing available (optional) */
  drive_time_minutes?: number;
  /** User rating count from provider (optional) */
  user_rating_count?: number;
};

export type HotelResult = {
  id: string;
  name: string;
  city: string;
  state?: string;
  stars?: number;
  rating?: number;
  image_url?: string;
  source_url?: string;
  book_url?: string;
  /** Structured outbound link (Phase 3). When present, prefer over book_url for UI. */
  book_link?: HotelOutboundLink;
  price_min?: number;
  price_max?: number;
  provider: Provider;
};

export type SearchResponse = {
  destination: { city: string; state?: string; start_date: string; end_date: string };
  events: EventResult[];
  golf_courses: GolfCourseResult[];
  bronze_golf_candidates?: GolfCourseResult[];
  silver_golf_candidates?: GolfCourseResult[];
  gold_golf_candidates?: GolfCourseResult[];
  hotels: HotelResult[];
  meta: { providers: Provider[]; cached: boolean; generated_at: string; request_id: string };
};

function getSearchUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url || typeof url !== "string") return "";
  return `${url.replace(/\/$/, "")}/functions/v1/search`;
}

export async function fetchSearch(request: SearchRequest): Promise<SearchResponse> {
  const params = new URLSearchParams({
    start_date: request.dates.start_date,
    end_date: request.dates.end_date,
  });
  if (request.artist?.trim()) params.set("artist", request.artist.trim());
  if (request.destination?.city) params.set("city", request.destination.city);
  if (request.destination?.state) params.set("state", request.destination.state);
  if (request.destination?.lat != null) params.set("lat", String(request.destination.lat));
  if (request.destination?.lng != null) params.set("lng", String(request.destination.lng));
  if (request.group_size != null) params.set("group_size", String(request.group_size));
  if (request.budget_tier) params.set("budget_tier", request.budget_tier);
  if (request.tee_time_window?.start) params.set("tee_time_start", request.tee_time_window.start);
  if (request.tee_time_window?.end) params.set("tee_time_end", request.tee_time_window.end);

  const baseUrl = getSearchUrl();
  if (!baseUrl) throw new Error("VITE_SUPABASE_URL is not set");
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const headers: Record<string, string> = {};
  if (key) {
    headers["apikey"] = key;
    headers["Authorization"] = `Bearer ${key}`;
  }

  const res = await fetch(`${baseUrl}?${params.toString()}`, {
    signal: AbortSignal.timeout(30000),
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Search failed (${res.status})`);
  }
  return res.json();
}

/** Fallback mock data when the search Edge Function is unreachable. */
export function buildFallbackSearchResponse(request: SearchRequest): SearchResponse {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const startDate = request.dates.start_date;
  const endDate = request.dates.end_date;
  const teeWindow = request.tee_time_window ?? { start: "07:00", end: "11:00" };
  const artist = request.artist?.trim() || "";

  // Use artist name and city so the fallback is contextually accurate rather than generic
  const eventName = artist || "Live Concert";
  const venueName = `${city} Live Music Venue`;
  const ticketUrl = artist
    ? `https://www.ticketmaster.com/search?q=${encodeURIComponent(artist)}+${encodeURIComponent(city)}`
    : `https://www.ticketmaster.com/search?q=concerts+${encodeURIComponent(city)}`;
  const concertLink: ConcertOutboundLink = {
    url: ticketUrl,
    provider: "Ticketmaster",
    category: "concert",
    link_type: "provider_search",
    label: "Search tickets on Ticketmaster",
    is_verified: false,
    confidence: "medium",
    disclaimer: "Opens Ticketmaster search; specific tour dates and availability are not confirmed in Experience Caddie",
  };
  return {
    destination: { city, state, start_date: startDate, end_date: endDate },
    events: [
      {
        id: "fallback_event_1",
        name: eventName,
        date_time: `${startDate}T20:00:00-05:00`,
        venue: { name: venueName, city, state, capacity: 12000 },
        image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200",
        source_url: ticketUrl,
        book_url: ticketUrl,
        book_link: concertLink,
        price_min: 75,
        price_max: 250,
        provider: "mock",
      },
    ],
    golf_courses: [
      {
        id: "fallback_golf_1",
        name: "Sample Golf Course",
        city,
        state,
        public_access: true,
        public_access_confidence: "likely_public",
        rating: 4.4,
        tee_time_window: teeWindow,
        image_url: "https://images.unsplash.com/photo-1500930280485-71c409756852?w=1200",
        source_url: "https://www.golfnow.com/",
        book_url: "https://www.golfnow.com/",
        book_link: {
          url: "https://www.golfnow.com/",
          provider: "GolfNow",
          category: "golf",
          link_type: "provider_search",
          label: "Search tee times",
          is_verified: false,
          confidence: "medium",
          disclaimer: "Opens external golf search results; tee time availability is not confirmed in Experience Caddie",
        },
        price_min: 80,
        price_max: 180,
        provider: "mock",
      },
    ],
    hotels: [
      {
        id: "fallback_hotel_1",
        name: "Sample Hotel",
        city,
        state,
        stars: 4,
        rating: 4.6,
        image_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200",
        source_url: "https://www.google.com/maps/search/?api=1&query=hotels",
        book_url: "https://www.google.com/maps/search/?api=1&query=hotels",
        book_link: {
          url: "https://www.google.com/maps/search/?api=1&query=hotels",
          provider: "Google Maps",
          category: "hotel",
          link_type: "provider_search",
          label: "Search hotels",
          is_verified: false,
          confidence: "medium",
          disclaimer: "Opens hotel search results; availability and rates are not confirmed in Experience Caddie",
        },
        price_min: 160,
        price_max: 320,
        provider: "mock",
      },
    ],
    meta: {
      providers: ["mock"],
      cached: false,
      generated_at: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    },
  };
}
