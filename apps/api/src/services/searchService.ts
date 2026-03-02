import crypto from "node:crypto";
import type { SearchRequest, SearchResponse } from "../contracts/search.js";

const buildRequestId = () => crypto.randomUUID();

export const buildSearchResponse = (request: SearchRequest): SearchResponse => {
  const now = new Date().toISOString();
  const teeWindow = request.tee_time_window || { start: "07:00", end: "11:00" };

  return {
    destination: {
      city: request.destination.city,
      state: request.destination.state,
      start_date: request.dates.start_date,
      end_date: request.dates.end_date,
    },
    events: [
      {
        id: "event_mock_1",
        name: "Sample Concert",
        date_time: new Date(`${request.dates.start_date}T20:00:00Z`).toISOString(),
        venue: {
          name: "Mock Arena",
          city: request.destination.city,
          state: request.destination.state,
          capacity: 12000,
          lat: request.destination.lat,
          lng: request.destination.lng,
        },
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
        id: "golf_mock_1",
        name: "Mock Golf Club",
        city: request.destination.city,
        state: request.destination.state,
        lat: request.destination.lat,
        lng: request.destination.lng,
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
        id: "hotel_mock_1",
        name: "Mock Boutique Hotel",
        city: request.destination.city,
        state: request.destination.state,
        lat: request.destination.lat,
        lng: request.destination.lng,
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
    itinerary: {
      summary: "Mock itinerary based on your search filters.",
      days: [
        {
          date: request.dates.start_date,
          items: [
            { time: "15:00", title: "Arrive and check in", type: "arrival" },
            { time: "18:30", title: "Dinner downtown", type: "food" },
            { time: "20:00", title: "Live concert", type: "concert" },
          ],
        },
        {
          date: request.dates.end_date,
          items: [
            { time: "08:00", title: "Tee time", type: "golf" },
            { time: "12:30", title: "Lunch and hang", type: "hang" },
            { time: "16:00", title: "Depart", type: "depart" },
          ],
        },
      ],
    },
    meta: {
      providers: ["mock"],
      cached: false,
      generated_at: now,
      request_id: buildRequestId(),
    },
  };
};
