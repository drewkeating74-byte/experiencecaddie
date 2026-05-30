// Manual types until auto-generated types update
import type { Json } from "@/integrations/supabase/types";

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
  spotify_id: string | null;
  spotify_popularity: number | null;
  spotify_followers: number | null;
  spotify_synced_at: string | null;
  ticketmaster_demand_score: number | null;
  demand_synced_at: string | null;
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
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  public_access: boolean | null;
  green_fee_min: number | null;
  green_fee_max: number | null;
  rating: number | null;
  holes: number | null;
  image_url: string | null;
  booking_url: string | null;
  place_id: string | null;
  source: string | null;
  source_id: string | null;
  last_refreshed_at: string | null;
  metro: string | null;
  canonical_name: string | null;
  public_access_confidence: "likely_public" | "unknown" | "likely_private" | null;
  normalized_quality_score: number | null;
  tier_hint: "bronze" | "silver" | "gold" | null;
  editorial_boost: number | null;
  active: boolean | null;
  last_verified_at: string | null;
  excluded_reason: string | null;
  user_rating_count: number | null;
  course_type: "public" | "semi_private" | "resort" | "municipal" | "private" | "military" | "unknown" | null;
  par: number | null;
  website_url: string | null;
  tee_time_url: string | null;
  distance_from_center_miles: number | null;
  phone: string | null;
  short_description: string | null;
  vibe: string | null;
  verification_status: "verified" | "unreviewed" | "needs_review" | "excluded";
  verification_method: string | null;
  last_verified_by: string | null;
  last_agent_review_at: string | null;
  verification_evidence_summary: string | null;
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
  itinerary_json: Json | null;
  drive_time_minutes: number | null;
  distance_miles: number | null;
  category: string | null;
  featured: boolean | null;
  active: boolean | null;
  /** Optional curated hotel booking link (direct property / OTA). */
  hotel_url?: string | null;
  hotel_name?: string | null;
  /** Last day the package is bookable on the site (timestamptz from DB). */
  expires_at?: string | null;
  /** Optional Fri–Sun (or similar) window for the trip; event should fall in range. */
  package_start_date?: string | null;
  package_end_date?: string | null;
  verification_status?: "unverified" | "verified" | "needs_review" | "failed_twice" | "expired" | null;
  verification_fail_count?: number | null;
  last_verification_at?: string | null;
  last_verification_failed_at?: string | null;
  last_verification_source?: "ticketmaster" | "perplexity" | "manual" | "system" | null;
  verification_notes?: string | null;
  verification_evidence_url?: string | null;
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
