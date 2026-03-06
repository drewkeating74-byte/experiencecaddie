export type Provider =
  | "ticketmaster"
  | "seatgeek"
  | "stubhub"
  | "golfnow"
  | "teeoff"
  | "expedia"
  | "booking"
  | "hotels"
  | "mock";

export type SearchRequest = {
  artist?: string;
  destination: { city?: string; state?: string; lat?: number; lng?: number };
  dates: { start_date: string; end_date: string };
  group_size?: number;
  budget_tier?: "low" | "mid" | "high";
  tee_time_window?: { start: string; end: string };
};

export type EventResult = {
  id: string;
  name: string;
  date_time: string;
  venue: { name: string; city: string; state?: string; lat?: number; lng?: number; capacity?: number };
  image_url?: string;
  source_url?: string;
  book_url?: string;
  price_min?: number;
  price_max?: number;
  provider: Provider;
};

export type GolfCourseResult = {
  id: string;
  name: string;
  city: string;
  state?: string;
  public_access?: boolean;
  rating?: number;
  tee_time_window?: { start: string; end: string };
  image_url?: string;
  source_url?: string;
  book_url?: string;
  price_min?: number;
  price_max?: number;
  provider: Provider;
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
  price_min?: number;
  price_max?: number;
  provider: Provider;
};

export type SearchResponse = {
  destination: { city: string; state?: string; start_date: string; end_date: string };
  events: EventResult[];
  golf_courses: GolfCourseResult[];
  hotels: HotelResult[];
  meta: { providers: Provider[]; cached: boolean; generated_at: string; request_id: string };
};

function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_BASE_URL;
  return (typeof url === "string" && url.trim() ? url : "http://localhost:4000").replace(/\/$/, "");
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

  const res = await fetch(`${getBaseUrl()}/api/search?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Search failed (${res.status})`);
  }
  return res.json();
}

/** Fallback mock data when /api/search is unreachable. */
export function buildFallbackSearchResponse(request: SearchRequest): SearchResponse {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const startDate = request.dates.start_date;
  const endDate = request.dates.end_date;
  const teeWindow = request.tee_time_window ?? { start: "07:00", end: "11:00" };

  return {
    destination: { city, state, start_date: startDate, end_date: endDate },
    events: [
      {
        id: "fallback_event_1",
        name: "Sample Concert",
        date_time: `${startDate}T20:00:00-05:00`,
        venue: { name: "Mock Arena", city, state, capacity: 12000 },
        image_url: "https://images.unsplash.com/flagged/photo-1578703916946-53d0d7e6bbd0?w=1200",
        source_url: "https://www.ticketmaster.com/",
        book_url: "https://www.ticketmaster.com/",
        price_min: 75,
        price_max: 250,
        provider: "mock",
      },
    ],
    golf_courses: [
      {
        id: "fallback_golf_1",
        name: "Mock Golf Club",
        city,
        state,
        public_access: true,
        rating: 4.4,
        tee_time_window: teeWindow,
        image_url: "https://images.unsplash.com/photo-1500930280485-71c409756852?w=1200",
        source_url: "https://www.golfnow.com/",
        book_url: "https://www.golfnow.com/",
        price_min: 80,
        price_max: 180,
        provider: "mock",
      },
    ],
    hotels: [
      {
        id: "fallback_hotel_1",
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
    ],
    meta: {
      providers: ["mock"],
      cached: false,
      generated_at: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    },
  };
}
