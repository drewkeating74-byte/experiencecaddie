/**
 * Persists venues to Supabase (from Ticketmaster and other sources).
 * Uses source + source_id for upserts.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export type VenueToUpsert = {
  source: string;
  source_id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  lat?: number;
  lng?: number;
  capacity?: number;
};

export async function upsertVenues(venues: VenueToUpsert[]): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || venues.length === 0) return;

  const now = new Date().toISOString();
  for (const v of venues) {
    const { data: existing } = await supabase
      .from("venues")
      .select("id")
      .eq("source", v.source)
      .eq("source_id", v.source_id)
      .maybeSingle();

    const row = {
      source: v.source,
      source_id: v.source_id,
      name: v.name,
      address: v.address,
      city: v.city,
      state: v.state,
      country: v.country ?? "United States",
      lat: v.lat,
      lng: v.lng,
      capacity: v.capacity,
      last_refreshed_at: now,
      updated_at: now,
    };

    if (existing) {
      const { error } = await supabase.from("venues").update(row).eq("id", existing.id);
      if (error) console.error("[venueService] update error:", error.message);
    } else {
      const { error } = await supabase.from("venues").insert(row);
      if (error) console.error("[venueService] insert error:", error.message);
    }
  }
}
