/**
 * Ticketmaster Discovery API v2 client for event search.
 * Supports artist (keyword), city (optional), date window (6mo default, 12mo max).
 * https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */

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
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTBD?: boolean };
  };
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  _embedded?: {
    venues?: TMVenue[];
    attractions?: Array<{ name?: string }>;
  };
};

type TMResponse = {
  _embedded?: { events?: TMEvent[] };
  page?: { totalElements?: number };
};

function getApiKey(): string {
  const key = process.env.TICKETMASTER_CONSUMER_KEY || process.env.TICKETMASTER_API_KEY;
  if (!key) throw new Error("TICKETMASTER_CONSUMER_KEY or TICKETMASTER_API_KEY is not set");
  return key;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Apply default (6 months) and max (12 months) date window.
 */
export function resolveDateWindow(startDate?: string, endDate?: string): { start: string; end: string } {
  const today = new Date();
  const todayStr = toYYYYMMDD(today);

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

  // Cap at 12 months
  const maxEnd = addMonths(start, MAX_WINDOW_MONTHS);
  if (end > maxEnd) end = maxEnd;

  return {
    start: toYYYYMMDD(start),
    end: toYYYYMMDD(end),
  };
}

export async function searchEvents(params: {
  artist?: string;
  city?: string;
  state?: string;
  startDate: string;
  endDate: string;
  size?: number;
}): Promise<TMEvent[]> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}/events.json`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("classificationName", "Music");
  url.searchParams.set("size", String(params.size ?? 15));
  url.searchParams.set("sort", "date,asc");

  // Artist search (keyword) - primary when provided
  if (params.artist?.trim()) {
    url.searchParams.set("keyword", params.artist.trim());
  }

  // City (optional) - narrow results
  if (params.city?.trim() && params.city !== "flexible") {
    url.searchParams.set("city", params.city.trim());
  }

  // State (optional) - improves city search
  if (params.state?.trim()) {
    url.searchParams.set("stateCode", params.state.trim().toUpperCase().slice(0, 2));
  }

  // Date window
  url.searchParams.set("startDateTime", `${params.startDate}T00:00:00Z`);
  url.searchParams.set("endDateTime", `${params.endDate}T23:59:59Z`);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ticketmaster API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as TMResponse;
  const events = data._embedded?.events ?? [];
  return events;
}

export function mapEventToResult(
  event: TMEvent,
  fallbackCity: string,
  fallbackState?: string
): {
  id: string;
  name: string;
  date_time: string;
  venue: { name: string; city: string; state?: string; lat?: number; lng?: number; capacity?: number };
  image_url?: string;
  source_url?: string;
  book_url?: string;
  price_min?: number;
  price_max?: number;
  provider: "ticketmaster";
  venueSource?: { sourceId: string; name: string; address?: string; city?: string; state?: string; lat?: number; lng?: number };
} {
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
    venueSource: venue?.id
      ? {
          sourceId: venue.id,
          name: venue.name ?? "Venue",
          address: venue.address?.line1,
          city: venue.city?.name ?? fallbackCity,
          state: venue.state?.stateCode ?? venue.state?.name ?? fallbackState,
          lat,
          lng,
        }
      : undefined,
  };
}
