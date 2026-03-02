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
  destination: {
    city: string;
    state?: string;
    lat?: number;
    lng?: number;
  };
  dates: {
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  };
  groupSize?: number;
  budgetTier?: "low" | "mid" | "high";
  teeTimeWindow?: {
    start: string; // HH:mm
    end: string; // HH:mm
  };
};

export type EventResult = {
  id: string;
  name: string;
  dateTime: string; // ISO string
  venue: {
    name: string;
    city: string;
    state?: string;
    lat?: number;
    lng?: number;
    capacity?: number;
  };
  imageUrl?: string;
  sourceUrl?: string;
  bookUrl?: string;
  priceMin?: number;
  priceMax?: number;
  provider: Provider;
};

export type GolfCourseResult = {
  id: string;
  name: string;
  city: string;
  state?: string;
  lat?: number;
  lng?: number;
  publicAccess?: boolean;
  rating?: number;
  teeTimeWindow?: {
    start: string; // HH:mm
    end: string; // HH:mm
  };
  imageUrl?: string;
  sourceUrl?: string;
  bookUrl?: string;
  priceMin?: number;
  priceMax?: number;
  provider: Provider;
};

export type HotelResult = {
  id: string;
  name: string;
  city: string;
  state?: string;
  lat?: number;
  lng?: number;
  stars?: number;
  rating?: number;
  imageUrl?: string;
  sourceUrl?: string;
  bookUrl?: string;
  priceMin?: number;
  priceMax?: number;
  provider: Provider;
};

export type ItineraryItemType =
  | "arrival"
  | "golf"
  | "concert"
  | "food"
  | "hang"
  | "depart";

export type SearchResponse = {
  destination: {
    city: string;
    state?: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  };
  events: EventResult[];
  golfCourses: GolfCourseResult[];
  hotels: HotelResult[];
  itinerary?: {
    summary: string;
    days: Array<{
      date: string; // YYYY-MM-DD
      items: Array<{
        time?: string; // "18:30"
        title: string;
        type: ItineraryItemType;
        notes?: string;
      }>;
    }>;
  };
  meta: {
    providers: Provider[];
    cached: boolean;
    generatedAt: string; // ISO string
    requestId: string;
  };
};
