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
  destination: {
    city?: string;
    state?: string;
    lat?: number;
    lng?: number;
  };
  dates: {
    start_date: string;
    end_date: string;
  };
  group_size?: number;
  budget_tier?: "low" | "mid" | "high";
  tee_time_window?: { start: string; end: string };
};

export type EventResult = {
  id: string;
  name: string;
  date_time: string;
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

export type SearchResponse = {
  destination: { city: string; state?: string; start_date: string; end_date: string };
  events: EventResult[];
  golf_courses: GolfCourseResult[];
  hotels: HotelResult[];
  meta: {
    providers: Provider[];
    cached: boolean;
    generated_at: string;
    request_id: string;
  };
};
