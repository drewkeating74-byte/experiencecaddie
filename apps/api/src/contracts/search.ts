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
    start_date: string; // YYYY-MM-DD
    end_date: string; // YYYY-MM-DD
  };
  group_size?: number;
  budget_tier?: "low" | "mid" | "high";
  tee_time_window?: {
    start: string; // HH:mm
    end: string; // HH:mm
  };
};

export type EventResult = {
  id: string;
  name: string;
  date_time: string; // ISO string
  venue: {
    name: string;
    city: string;
    state?: string;
    lat?: number;
    lng?: number;
    capacity?: number;
  };
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
  lat?: number;
  lng?: number;
  public_access?: boolean;
  rating?: number;
  tee_time_window?: {
    start: string; // HH:mm
    end: string; // HH:mm
  };
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
  lat?: number;
  lng?: number;
  stars?: number;
  rating?: number;
  image_url?: string;
  source_url?: string;
  book_url?: string;
  price_min?: number;
  price_max?: number;
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
    start_date: string; // YYYY-MM-DD
    end_date: string; // YYYY-MM-DD
  };
  events: EventResult[];
  golf_courses: GolfCourseResult[];
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
    generated_at: string; // ISO string
    request_id: string;
  };
};
