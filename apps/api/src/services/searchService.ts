import crypto from "node:crypto";
import type { SearchRequest, SearchResponse } from "../contracts/search.js";

const buildRequestId = () => crypto.randomUUID();

export const buildSearchResponse = (request: SearchRequest): SearchResponse => {
  const now = new Date().toISOString();
  const teeWindow = request.teeTimeWindow || { start: "07:00", end: "11:00" };

  return {
    destination: {
      city: request.destination.city,
      state: request.destination.state,
      startDate: request.dates.startDate,
      endDate: request.dates.endDate,
    },
    events: [
      {
        id: "event_mock_1",
        name: "Sample Concert",
        dateTime: new Date(`${request.dates.startDate}T20:00:00Z`).toISOString(),
        venue: {
          name: "Mock Arena",
          city: request.destination.city,
          state: request.destination.state,
          capacity: 12000,
          lat: request.destination.lat,
          lng: request.destination.lng,
        },
        imageUrl: "https://images.unsplash.com/flagged/photo-1578703916946-53d0d7e6bbd0?w=1200",
        sourceUrl: "https://www.ticketmaster.com/",
        bookUrl: "https://www.ticketmaster.com/",
        priceMin: 75,
        priceMax: 250,
        provider: "mock",
      },
    ],
    golfCourses: [
      {
        id: "golf_mock_1",
        name: "Mock Golf Club",
        city: request.destination.city,
        state: request.destination.state,
        lat: request.destination.lat,
        lng: request.destination.lng,
        publicAccess: true,
        rating: 4.4,
        teeTimeWindow: teeWindow,
        imageUrl: "https://images.unsplash.com/photo-1500930280485-71c409756852?w=1200",
        sourceUrl: "https://www.golfnow.com/",
        bookUrl: "https://www.golfnow.com/",
        priceMin: 80,
        priceMax: 180,
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
        imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200",
        sourceUrl: "https://www.booking.com/",
        bookUrl: "https://www.booking.com/",
        priceMin: 160,
        priceMax: 320,
        provider: "mock",
      },
    ],
    itinerary: {
      summary: "Mock itinerary based on your search filters.",
      days: [
        {
          date: request.dates.startDate,
          items: [
            { time: "15:00", title: "Arrive and check in", type: "arrival" },
            { time: "18:30", title: "Dinner downtown", type: "food" },
            { time: "20:00", title: "Live concert", type: "concert" },
          ],
        },
        {
          date: request.dates.endDate,
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
      generatedAt: now,
      requestId: buildRequestId(),
    },
  };
};
