/**
 * Search Edge Function — Ticketmaster events + mock golf/hotels.
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

type GolfCourseResult = {
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
  provider: "mock";
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
  meta: { providers: ("ticketmaster" | "mock")[]; cached: boolean; generated_at: string; request_id: string };
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
  return [
    {
      id: "golf_mock_1",
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
  ];
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
  const artist = getString(url.searchParams.get("artist")) ?? getString(url.searchParams.get("keyword"));
  const city = getString(url.searchParams.get("city"));
  const state = getString(url.searchParams.get("state"));
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
    destination: { city, state },
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

    const golfCourses = mockGolf({
      ...payload,
      destination: { ...payload.destination, city: effectiveCity },
    });
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
