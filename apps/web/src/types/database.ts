// Manual types until auto-generated types update
export interface Destination {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface Artist {
  id: string;
  name: string;
  genre: string | null;
  subgenre: string | null;
  image_url: string | null;
  description: string | null;
  demographic_fit_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface Venue {
  id: string;
  name: string;
  destination_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: string;
  name: string;
  artist_id: string | null;
  venue_id: string | null;
  event_date: string;
  event_time: string | null;
  timezone: string | null;
  description: string | null;
  image_url: string | null;
  ticket_url: string | null;
  min_price: number | null;
  max_price: number | null;
  currency: string | null;
  availability_status: string | null;
  source_id: string | null;
  source_name: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  artists?: Artist;
  venues?: Venue;
}

export interface GolfCourse {
  id: string;
  name: string;
  destination_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  public_access: boolean | null;
  guest_policy: string | null;
  green_fee_min: number | null;
  green_fee_max: number | null;
  rating: number | null;
  slope: number | null;
  holes: number | null;
  image_url: string | null;
  booking_url: string | null;
  description: string | null;
  place_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Package {
  id: string;
  name: string;
  event_id: string | null;
  golf_course_id: string | null;
  destination_id: string | null;
  description: string | null;
  image_url: string | null;
  price: number;
  original_price: number | null;
  itinerary_json: any;
  drive_time_minutes: number | null;
  distance_miles: number | null;
  category: string | null;
  featured: boolean | null;
  active: boolean | null;
  created_at: string;
  updated_at: string;
  // Joined
  events?: Event;
  golf_courses?: GolfCourse;
  destinations?: Destination;
}

export interface Booking {
  id: string;
  user_id: string;
  package_id: string;
  booking_date: string;
  event_date: string | null;
  guests: number | null;
  total_price: number;
  status: string;
  payment_intent_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  packages?: Package;
}

export interface Profile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}
