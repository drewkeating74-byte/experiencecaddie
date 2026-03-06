import crypto from "node:crypto";
import type { SearchRequest, SearchResponse, EventResult } from "../contracts/search.js";
import { searchEvents, mapEventToResult, resolveDateWindow } from "./ticketmasterService.js";
import { upsertVenues } from "./venueService.js";

const buildRequestId = () => crypto.randomUUID();

function hasTicketmasterKey(): boolean {
  return Boolean(process.env.TICKETMASTER_CONSUMER_KEY || process.env.TICKETMASTER_API_KEY);
}

function mockEvents(request: SearchRequest): EventResult[] {
  const city = request.destination?.city || "Austin";
  const state = request.destination?.state ?? "TX";
  const startDate = request.dates.start_date;
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

function mockGolf(request: SearchRequest) {
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
      provider: "mock" as const,
    },
  ];
}

function mockHotels(request: SearchRequest) {
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
      provider: "mock" as const,
    },
  ];
}

export async function buildSearchResponse(request: SearchRequest): Promise<SearchResponse> {
  const now = new Date().toISOString();
  const artist = request.artist?.trim();
  const city = request.destination?.city;
  const state = request.destination?.state;

  // Apply 6-month default, 12-month max
  const { start: startDate, end: endDate } = resolveDateWindow(
    request.dates?.start_date,
    request.dates?.end_date
  );

  const providers: SearchResponse["meta"]["providers"] = [];
  const effectiveCity = city && city !== "flexible" ? city : "Various";

  // Call Ticketmaster when we have artist OR a specific city
  const shouldCallTicketmaster =
    hasTicketmasterKey() && (Boolean(artist) || (Boolean(city) && city !== "flexible"));

  let events: EventResult[];

  if (shouldCallTicketmaster) {
    try {
      const tmEvents = await searchEvents({
        artist,
        city: city && city !== "flexible" ? city : undefined,
        state,
        startDate,
        endDate,
        size: 15,
      });

      events = tmEvents.map((e) => {
        const venueCity = e._embedded?.venues?.[0]?.city?.name ?? effectiveCity;
        const venueState = e._embedded?.venues?.[0]?.state?.stateCode ?? state;
        const mapped = mapEventToResult(e, venueCity, venueState);
        const { venueSource, ...result } = mapped;
        return result;
      });

      // Persist venues
      const venuesToUpsert = tmEvents
        .map((e) => {
          const venueCity = e._embedded?.venues?.[0]?.city?.name ?? effectiveCity;
          const venueState = e._embedded?.venues?.[0]?.state?.stateCode ?? state;
          const mapped = mapEventToResult(e, venueCity, venueState);
          return mapped.venueSource;
        })
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
        .map((v) => ({
          source: "ticketmaster" as const,
          source_id: v.sourceId,
          name: v.name,
          address: v.address,
          city: v.city,
          state: v.state,
          lat: v.lat,
          lng: v.lng,
        }));
      await upsertVenues(venuesToUpsert);

      if (events.length > 0) providers.push("ticketmaster");
    } catch (err) {
      console.error("[searchService] Ticketmaster error:", err);
      events = mockEvents({ ...request, destination: { ...request.destination, city: effectiveCity }, dates: { start_date: startDate, end_date: endDate } });
      providers.push("mock");
    }
  } else {
    events = mockEvents({
      ...request,
      destination: { ...request.destination, city: effectiveCity },
      dates: { start_date: startDate, end_date: endDate },
    });
    providers.push("mock");
  }

  const golfCourses = mockGolf({
    ...request,
    destination: { ...request.destination, city: effectiveCity },
  });
  const hotels = mockHotels({
    ...request,
    destination: { ...request.destination, city: effectiveCity },
  });
  if (!providers.includes("mock")) providers.push("mock");

  return {
    destination: { city: effectiveCity, state, start_date: startDate, end_date: endDate },
    events,
    golf_courses: golfCourses,
    hotels,
    meta: {
      providers,
      cached: false,
      generated_at: now,
      request_id: buildRequestId(),
    },
  };
}
