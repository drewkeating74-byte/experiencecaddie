/**
 * Ticketmaster Discovery API helpers — shared by search + generate-itinerary
 * so concert dates/venues match live TM data, not LLM guesses.
 */
import { getMetroByCity, type MetroConfig } from "./golfCities.ts";

const BASE_URL = "https://app.ticketmaster.com/discovery/v2";

export type TMVenue = {
  name?: string;
  city?: { name?: string };
  state?: { name?: string; stateCode?: string };
  location?: { latitude?: string; longitude?: string };
};

export type TMEvent = {
  id?: string;
  name?: string;
  url?: string;
  images?: Array<{ url?: string; width?: number }>;
  dates?: { start?: { localDate?: string; localTime?: string } };
  priceRanges?: Array<{ min?: number; max?: number }>;
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  _embedded?: {
    venues?: TMVenue[];
    attractions?: Array<{
      name?: string;
      /** Number of future events the artist/attraction has scheduled on TM — proxy for touring popularity. */
      upcomingEvents?: { _total?: number };
    }>;
  };
};

type TMResponse = { _embedded?: { events?: TMEvent[] } };

export type ConcertOutboundLink = {
  url: string;
  provider: string;
  category: "concert";
  link_type: "direct_event" | "provider_search" | "provider_event";
  label: string;
  is_verified: boolean;
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

export type TicketmasterEventResult = {
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
  source_url: string;
  book_url: string;
  book_link: ConcertOutboundLink;
  price_min?: number;
  price_max?: number;
  provider: "ticketmaster";
};

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function normalizeCityToken(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Drop TM rows where the venue is not in the requested metro (keyword search can return other cities). */
export function venueCityMatchesRequest(requestedCity: string, venueCity: string | undefined): boolean {
  if (!requestedCity?.trim() || requestedCity === "flexible" || requestedCity === "Various") return true;
  if (!venueCity?.trim()) return false;
  const a = normalizeCityToken(requestedCity);
  const b = normalizeCityToken(venueCity);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  const aw = a.split(" ").filter((w) => w.length > 2);
  const bw = b.split(" ").filter((w) => w.length > 2);
  return aw.some((w) => bw.includes(w)) || bw.some((w) => aw.includes(w));
}

function venueInMetroRadius(
  metro: MetroConfig | null,
  venueLat: number | undefined,
  venueLng: number | undefined
): boolean {
  if (!metro || venueLat == null || venueLng == null) return false;
  const d = haversineMiles(metro.center.lat, metro.center.lng, venueLat, venueLng);
  return d <= metro.searchRadiusMiles + 18;
}

/** City name match OR venue coords within supported metro radius (e.g. Del Valle / COTA vs "Austin"). */
export function venueMatchesUserCity(
  requestedCity: string,
  venue: TMVenue | undefined
): boolean {
  const vCity = venue?.city?.name;
  if (venueCityMatchesRequest(requestedCity, vCity)) return true;
  const metro = getMetroByCity(requestedCity);
  const lat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : undefined;
  const lng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : undefined;
  return venueInMetroRadius(metro, lat, lng);
}

/** True if the venue sits in the given catalog metro (anchor city or radius). */
export function eventVenueBelongsToMetro(venue: TMVenue | undefined, metro: MetroConfig): boolean {
  const anchor = metro.cities[0] ?? metro.label;
  if (venueMatchesUserCity(anchor, venue)) return true;
  const lat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : undefined;
  const lng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : undefined;
  return venueInMetroRadius(metro, lat, lng);
}

function genreMatchNeedles(raw: string): string[] {
  const t = raw.trim().toLowerCase();
  if (!t) return [];
  const needles = new Set<string>([t, t.replace(/\s*\/\s*/g, " ")]);
  for (const seg of t.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean)) {
    needles.add(seg);
  }
  const alias: Record<string, string[]> = {
    edm: ["electronic", "dance/electronic", "dance electronic", "techno", "house"],
    rap: ["hip-hop", "hip hop"],
    "hip-hop": ["rap", "hip hop"],
    soul: ["r&b", "neo-soul"],
    "r&b": ["soul"],
    blues: ["blues", "blues rock", "jazz"],
    jazz: ["blues"],
    latin: ["reggaeton", "regional mexican", "tropical", "latin pop"],
    americana: ["alt-country", "americana", "folk", "roots", "outlaw country"],
    alternative: ["alt rock", "indie rock", "modern rock"],
    indie: ["indie rock", "indie pop", "indie"],
    "jam band": ["jam band", "jamband", "jam bands"],
    folk: ["folk", "folk rock", "singer-songwriter", "acoustic"],
    "classic rock": ["classic rock", "arena rock"],
  };
  for (const n of [...needles]) {
    for (const x of alias[n] ?? []) needles.add(x);
  }
  return [...needles].filter((n) => n.length > 1);
}

/**
 * TM rarely exposes a real "Jam Band" classification — most jam acts are tagged
 * Rock/Country/Folk. Match and discover by headliner name instead.
 * Exported so Stage 1 discovery can keyword-search these when the chip is Jam Band.
 */
export const KNOWN_JAM_BAND_ARTISTS = [
  "Widespread Panic",
  "Dead & Company",
  "Dave Matthews Band",
  "Billy Strings",
  "String Cheese Incident",
  "Phish",
  "Gov't Mule",
  "Trey Anastasio",
  "Umphrey's McGee",
  "Goose",
  "My Morning Jacket",
  "The Disco Biscuits",
  "Lettuce",
  "Greensky Bluegrass",
  "Moe.",
  "Lotus",
  "Twiddle",
  "Pigeons Playing Ping Pong",
  "The Wood Brothers",
  "Trampled By Turtles",
  "Kitchen Dwellers",
  "Railroad Earth",
  "Yonder Mountain String Band",
  "The Infamous Stringdusters",
  "JRAD",
  "Joe Russo's Almost Dead",
  "Billy & The Kids",
  "Bob Weir",
  "Oteil & Friends",
  "Dopapod",
  "Spafford",
  "Eggy",
];

/**
 * Mainstream / radio-country headliners for the Country chip.
 * TM often tags bluegrass/jam acts as Country — seed these names so the picker
 * surfaces Combs/Wallen-style inventory instead of jam crossover.
 */
export const KNOWN_COUNTRY_ARTISTS = [
  "Morgan Wallen",
  "Luke Combs",
  "Zach Bryan",
  "Chris Stapleton",
  "Cody Johnson",
  "Kane Brown",
  "Jelly Roll",
  "Lainey Wilson",
  "Bailey Zimmerman",
  "Megan Moroney",
  "HARDY",
  "Eric Church",
  "Parker McCollum",
  "Koe Wetzel",
  "Luke Bryan",
  "Thomas Rhett",
  "Jason Aldean",
  "Carrie Underwood",
  "Kacey Musgraves",
  "Tyler Childers",
  "Riley Green",
  "Zach Top",
  "Ella Langley",
  "Shaboozey",
  "Post Malone",
  "Brooks & Dunn",
  "George Strait",
  "Tim McGraw",
  "Keith Urban",
  "Dierks Bentley",
  "Jordan Davis",
  "Old Dominion",
  "Dan + Shay",
  "Sam Hunt",
  "Brett Young",
  "Chase Rice",
  "Tucker Wetmore",
];

/** @deprecated use KNOWN_JAM_BAND_ARTISTS */
const JAM_BAND_ARTIST_NAMES = KNOWN_JAM_BAND_ARTISTS;

export function genreTokensRequestJamBand(genreTokens: string[]): boolean {
  return genreTokens.some(genreTokenIsJamBandLike);
}

function genreTokenIsCountryLike(raw: string): boolean {
  return genreMatchNeedles(raw).some((n) => n === "country");
}

export function genreTokensRequestCountry(genreTokens: string[]): boolean {
  return genreTokens.some(genreTokenIsCountryLike);
}

/** Country chip alone should not surface jam/bluegrass headliners TM mis-tags as Country. */
function shouldExcludeJamFromCountry(genreTokens: string[]): boolean {
  return genreTokensRequestCountry(genreTokens) && !genreTokensRequestJamBand(genreTokens);
}

function countryArtistMatchesName(artist: string | null | undefined): boolean {
  const hay = (artist ?? "").toLowerCase().trim();
  if (!hay) return false;
  return KNOWN_COUNTRY_ARTISTS.some((name) => hay.includes(name.toLowerCase()));
}

function looksLikeBluegrassCrossover(blob: string): boolean {
  return /\bbluegrass\b|\bjamband\b|\bjam band\b/.test(blob);
}

function blobContainsToken(blob: string, token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (t.includes(" ")) return blob.includes(t);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(blob);
}

function genreTokenIsJamBandLike(raw: string): boolean {
  return genreMatchNeedles(raw).some((n) =>
    ["jam band", "jamband", "jam bands"].includes(n)
  );
}

function jamBandArtistMatchesName(artist: string | null | undefined): boolean {
  const hay = (artist ?? "").toLowerCase().trim();
  if (!hay) return false;
  return JAM_BAND_ARTIST_NAMES.some((name) => hay.includes(name.toLowerCase()));
}

function catalogGenreBlobMatchesToken(blob: string, raw: string): boolean {
  const needles = genreMatchNeedles(raw);
  if (!needles.length) return false;
  if (genreTokenIsEdmLike(raw)) {
    return needles.some((n) => blob.includes(n.replace(/\//g, " ")));
  }
  if (needles.some((n) => blob.includes(n))) return true;
  const words = raw
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length > 1) return words.every((w) => blobContainsToken(blob, w));
  return false;
}

function eventClassificationBlob(event: TMEvent): string {
  const parts = (event.classifications ?? [])
    .flatMap((c) => [c.segment?.name, c.genre?.name, c.subGenre?.name])
    .filter(Boolean) as string[];
  return parts.join(" ").toLowerCase().replace(/\//g, " ").replace(/\s+/g, " ");
}

function genreTokenIsEdmLike(raw: string): boolean {
  return genreMatchNeedles(raw).some((needle) =>
    ["edm", "electronic", "dance/electronic", "dance electronic", "techno", "house"].includes(needle)
  );
}

function genreTokensRequestEdm(genreTokens: string[]): boolean {
  return genreTokens.some(genreTokenIsEdmLike);
}

function eventLooksLikePerformingArtsNoise(event: TMEvent): boolean {
  const classifications = eventClassificationBlob(event);
  const title = (event.name ?? "").toLowerCase();
  return (
    /\b(arts theatre|arts & theatre|ballet|classical|opera|orchestra|symphony|performance art|children's theatre|theatre|theater)\b/.test(
      classifications
    ) ||
    /\b(nutcracker|ballet|orchestra|symphony|opera)\b/.test(title)
  );
}

/** Best-effort genre filter using TM classifications + event title (comma-separated UI genres). */
export function tmEventMatchesGenreTokens(event: TMEvent, genreTokens: string[]): boolean {
  if (!genreTokens.length) return true;
  if (genreTokensRequestEdm(genreTokens) && eventLooksLikePerformingArtsNoise(event)) return false;
  const artist = event._embedded?.attractions?.[0]?.name ?? event.name ?? "";
  if (shouldExcludeJamFromCountry(genreTokens)) {
    if (jamBandArtistMatchesName(artist) && !countryArtistMatchesName(artist)) return false;
  }
  const classificationBlob = eventClassificationBlob(event);
  const blob = `${classificationBlob} ${event.name ?? ""}`.toLowerCase().replace(/\s+/g, " ");
  if (shouldExcludeJamFromCountry(genreTokens) && looksLikeBluegrassCrossover(blob) && !countryArtistMatchesName(artist)) {
    return false;
  }
  if (genreTokens.some((raw) => catalogGenreBlobMatchesToken(blob, raw))) return true;
  if (genreTokens.some(genreTokenIsJamBandLike) && jamBandArtistMatchesName(artist)) return true;
  if (genreTokensRequestCountry(genreTokens) && countryArtistMatchesName(artist)) return true;
  return false;
}

/** Genre filter for discovery_shows rows and catalog packages (no TM event object). */
export function catalogRowMatchesGenreTokens(
  row: {
    genre?: string | null;
    subgenre?: string | null;
    artist?: string | null;
    event_name?: string | null;
  },
  genreTokens: string[],
): boolean {
  if (!genreTokens.length) return true;
  const blob = `${row.genre ?? ""} ${row.subgenre ?? ""} ${row.event_name ?? ""} ${row.artist ?? ""}`
    .toLowerCase()
    .replace(/\//g, " ")
    .replace(/\s+/g, " ");
  if (shouldExcludeJamFromCountry(genreTokens)) {
    if (jamBandArtistMatchesName(row.artist) && !countryArtistMatchesName(row.artist)) return false;
    if (looksLikeBluegrassCrossover(blob) && !countryArtistMatchesName(row.artist)) return false;
  }
  if (genreTokens.some((raw) => catalogGenreBlobMatchesToken(blob, raw))) return true;
  if (genreTokens.some(genreTokenIsJamBandLike) && jamBandArtistMatchesName(row.artist)) return true;
  if (genreTokensRequestCountry(genreTokens) && countryArtistMatchesName(row.artist)) return true;
  return false;
}

function tmEventGenreMatchConfidence(event: TMEvent, genreTokens: string[]): "none" | "title" | "classification" {
  if (!genreTokens.length) return "classification";
  if (genreTokensRequestEdm(genreTokens) && eventLooksLikePerformingArtsNoise(event)) return "none";
  const classificationBlob = eventClassificationBlob(event);
  const titleBlob = (event.name ?? "").toLowerCase().replace(/\s+/g, " ");
  for (const raw of genreTokens) {
    const needles = genreMatchNeedles(raw);
    if (!needles.length) continue;
    if (needles.some((n) => classificationBlob.includes(n))) return "classification";
    if (genreTokenIsEdmLike(raw)) continue;
    if (needles.some((n) => titleBlob.includes(n))) return "title";
  }
  return "none";
}

export function tmEventMatchesArtistQuery(event: TMEvent, artist: string | undefined): boolean {
  if (!artist?.trim()) return true;
  const needle = artist.trim().toLowerCase();
  const pool: string[] = [];
  if (event.name) pool.push(event.name);
  for (const att of event._embedded?.attractions ?? []) {
    if (att?.name) pool.push(att.name);
  }
  const hay = pool.join(" ").toLowerCase();
  if (hay.includes(needle)) return true;
  const tokens = needle.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return true;
  return tokens.every((t) => hay.includes(t));
}

/** Web search for this specific show — surfaces StubHub, AXS, venue, resale, etc. */
export function buildGoogleTicketsSearchUrl(params: {
  performer: string;
  city: string;
  venue?: string;
  dateYmd?: string;
}): string {
  let datePart = "";
  const ymd = params.dateYmd?.trim();
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const d = new Date(ymd + "T12:00:00Z");
    if (!isNaN(d.getTime())) {
      datePart = d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
  }
  const parts = [
    params.performer.trim(),
    params.venue?.trim(),
    params.city.trim(),
    datePart,
    "tickets",
  ].filter((p): p is string => Boolean(p && p.length > 0));
  const q = parts.length ? parts.join(" ") : "concert tickets";
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function isUsableTicketmasterEventUrl(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const u = url.trim();
  if (!u.startsWith("https://")) return false;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.replace(/^www\./, "");
    return host === "ticketmaster.com" || host.endsWith(".ticketmaster.com");
  } catch {
    return false;
  }
}

export function mapTmEventToResult(
  event: TMEvent,
  fallbackCity: string,
  fallbackState?: string
): TicketmasterEventResult {
  const venue = event._embedded?.venues?.[0];
  const attraction = event._embedded?.attractions?.[0];
  const eventName = event.name ?? attraction?.name ?? "Concert";
  const artistName = attraction?.name ?? event.name ?? "Concert";
  const localDate = event.dates?.start?.localDate ?? "";
  const localTime = event.dates?.start?.localTime ?? "20:00:00";
  const dateTime = localDate ? `${localDate}T${localTime}` : "";
  const priceRange = event.priceRanges?.[0];
  const lat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : undefined;
  const lng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : undefined;
  const city = venue?.city?.name ?? fallbackCity;
  const state = venue?.state?.stateCode ?? venue?.state?.name ?? fallbackState;
  const useDirectUrl = isUsableTicketmasterEventUrl(event.url);
  const venueName = venue?.name;
  const ticketUrl = useDirectUrl
    ? event.url!.trim()
    : buildGoogleTicketsSearchUrl({
        performer: eventName,
        city,
        venue: venueName,
        dateYmd: localDate,
      });

  const book_link: ConcertOutboundLink = useDirectUrl
    ? {
        url: ticketUrl,
        provider: "Ticketmaster",
        category: "concert",
        link_type: "direct_event",
        label: "Tickets",
        is_verified: false,
        confidence: "low",
        disclaimer: undefined,
      }
    : {
        url: ticketUrl,
        provider: "Google",
        category: "concert",
        link_type: "provider_search",
        label: "Find tickets",
        is_verified: false,
        confidence: "medium",
        disclaimer: "Opens Google results for this show and date (multiple ticket options may appear)",
      };

  return {
    id: event.id ?? `tm_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: eventName,
    date_time: dateTime,
    venue: {
      name: venue?.name ?? "Venue",
      city,
      state,
      lat,
      lng,
      capacity: undefined,
    },
    image_url: event.images?.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
    source_url: ticketUrl,
    book_url: ticketUrl,
    book_link,
    price_min: priceRange?.min,
    price_max: priceRange?.max,
    provider: "ticketmaster",
  };
}

// ── Ticketmaster rate limiting ──────────────────────────────────────────────
// TM's spike-arrest policy is 5 req/sec with burst=1 — i.e. requests must be
// evenly spaced (~200ms apart). ANY concurrency triggers HTTP 429, which is why
// the per-metro fan-out (and a naive concurrent nationwide fetch) silently
// returned zero events. We serialize every TM events call through evenly-spaced
// slots, with a 429 backoff retry, so multi-call discovery paths don't starve.
const TM_MIN_INTERVAL_MS = 230;
let tmNextSlot = 0;
async function tmAcquireSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, tmNextSlot);
  tmNextSlot = slot + TM_MIN_INTERVAL_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** Fetch TM events.json with rate-limit spacing + 429 backoff; returns events. */
async function tmFetchEvents(url: string, attempt = 0): Promise<TMEvent[]> {
  await tmAcquireSlot();
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    const text = await res.text();
    // Retry only the transient per-second spike-arrest. Daily quota exhaustion
    // ("QuotaViolation") cannot recover within a request, so fail fast.
    if (res.status === 429 && /spike arrest/i.test(text) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return tmFetchEvents(url, attempt + 1);
    }
    throw new Error(`Ticketmaster API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as TMResponse;
  return data._embedded?.events ?? [];
}

export async function fetchTicketmasterEvents(params: {
  artist?: string;
  city?: string;
  state?: string;
  startDate: string;
  endDate: string;
  size?: number;
  /** Ticketmaster DMA id — when set, scopes events to that market (preferred for catalog metros). */
  dmaId?: number | null;
}): Promise<TMEvent[]> {
  const apiKey = Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY");
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY or TICKETMASTER_CONSUMER_KEY not set");
  const url = new URL(`${BASE_URL}/events.json`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("classificationName", "Music");
  url.searchParams.set("size", String(params.size ?? 20));
  url.searchParams.set("sort", "date,asc");
  if (params.artist?.trim()) url.searchParams.set("keyword", params.artist.trim());
  if (params.dmaId != null && params.dmaId > 0) {
    url.searchParams.set("dmaId", String(params.dmaId));
  } else {
    if (params.city?.trim() && params.city !== "flexible") url.searchParams.set("city", params.city.trim());
    if (params.state?.trim()) url.searchParams.set("stateCode", params.state.trim().toUpperCase().slice(0, 2));
  }
  url.searchParams.set("startDateTime", `${params.startDate}T00:00:00Z`);
  url.searchParams.set("endDateTime", `${params.endDate}T23:59:59Z`);
  return tmFetchEvents(url.toString());
}

async function fetchTicketmasterEventsPage(params: {
  artist?: string;
  city?: string;
  state?: string;
  startDate: string;
  endDate: string;
  size: number;
  page: number;
  dmaId?: number | null;
  classificationName?: string;
}): Promise<TMEvent[]> {
  const apiKey = Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY");
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY or TICKETMASTER_CONSUMER_KEY not set");
  const url = new URL(`${BASE_URL}/events.json`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("classificationName", params.classificationName?.trim() || "Music");
  url.searchParams.set("size", String(params.size));
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("sort", "date,asc");
  if (params.artist?.trim()) url.searchParams.set("keyword", params.artist.trim());
  if (params.dmaId != null && params.dmaId > 0) {
    url.searchParams.set("dmaId", String(params.dmaId));
  } else {
    if (params.city?.trim() && params.city !== "flexible") url.searchParams.set("city", params.city.trim());
    if (params.state?.trim()) url.searchParams.set("stateCode", params.state.trim().toUpperCase().slice(0, 2));
  }
  url.searchParams.set("startDateTime", `${params.startDate}T00:00:00Z`);
  url.searchParams.set("endDateTime", `${params.endDate}T23:59:59Z`);
  return tmFetchEvents(url.toString());
}

function daysBetween(aYmd: string, bYmd: string): number {
  const a = new Date(aYmd + "T12:00:00").getTime();
  const b = new Date(bYmd + "T12:00:00").getTime();
  return Math.round(Math.abs(a - b) / (24 * 60 * 60 * 1000));
}

/** Parse LLM / user date strings to YYYY-MM-DD when possible. */
export function parseFlexibleDateToYmd(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const m = parseInt(us[1], 10);
    const d = parseInt(us[2], 10);
    const y = parseInt(us[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2024 && y <= 2035) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const t = Date.parse(s);
  if (!isNaN(t)) {
    return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Resolve artist + city + date window to a single Ticketmaster-backed event row.
 * Uses venue city OR metro-radius so suburbs (e.g. COTA) still match "Austin".
 */
export async function resolveConcertFromTicketmaster(params: {
  artist: string;
  city: string;
  startDate: string;
  endDate: string;
  dateHintYmd?: string | null;
}): Promise<TicketmasterEventResult | null> {
  const artist = params.artist?.trim();
  const city = params.city?.trim();
  if (!artist || !city || city === "flexible") return null;

  const metro = getMetroByCity(city);
  const state = metro?.state;

  let tmRaw: TMEvent[];
  try {
    tmRaw = await fetchTicketmasterEvents({
      artist,
      city,
      state,
      startDate: params.startDate.slice(0, 10),
      endDate: params.endDate.slice(0, 10),
      size: 30,
    });
  } catch (e) {
    console.error("[TM_RESOLVE] fetch failed:", e);
    return null;
  }

  const filtered = tmRaw.filter((e) => {
    const v = e._embedded?.venues?.[0];
    if (!venueMatchesUserCity(city, v)) {
      console.log(`[TM_RESOLVE] skip city: event="${e.name}" venueCity="${v?.city?.name}"`);
      return false;
    }
    if (!tmEventMatchesArtistQuery(e, artist)) {
      console.log(`[TM_RESOLVE] skip artist: event="${e.name}" want="${artist}"`);
      return false;
    }
    const ymd = e.dates?.start?.localDate ?? "";
    if (!isWeekendGetawayYmd(ymd)) {
      console.log(`[TM_RESOLVE] skip weekday: event="${e.name}" date="${ymd}"`);
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    console.log(`[TM_RESOLVE] no events for artist="${artist}" city="${city}"`);
    return null;
  }

  const hint = params.dateHintYmd?.trim() || null;
  let chosen: TMEvent;
  if (hint && /^\d{4}-\d{2}-\d{2}$/.test(hint)) {
    const scored = filtered
      .map((e) => {
        const d = e.dates?.start?.localDate ?? "";
        return { e, dist: d ? daysBetween(hint, d) : 999 };
      })
      .sort((a, b) => a.dist - b.dist);
    chosen = scored[0].e;
    console.log(`[TM_RESOLVE] picked by date hint ${hint} → ${chosen.dates?.start?.localDate} (${scored[0].dist}d off)`);
  } else {
    chosen = filtered.sort((a, b) => {
      const da = a.dates?.start?.localDate ?? "";
      const db = b.dates?.start?.localDate ?? "";
      return da.localeCompare(db);
    })[0];
    console.log(`[TM_RESOLVE] picked earliest: ${chosen.dates?.start?.localDate}`);
  }

  return mapTmEventToResult(chosen, city, state);
}

function discoverEventDedupeKey(c: { event: TMEvent; metro: MetroConfig; ymd: string }): string {
  const id = c.event.id?.trim();
  if (id) return `id:${id}`;
  const art = c.event._embedded?.attractions?.[0]?.name ?? c.event.name ?? "";
  return `f:${c.metro.slug}|${c.ymd}|${art}`;
}

type DiscoveryCandidate = {
  metro: MetroConfig;
  event: TMEvent;
  ymd: string;
  score: number;
  artist: string;
  city: string;
};

const DISCOVERY_WARM_WEATHER_METROS = new Set([
  "las-vegas",
  "phoenix",
  "dallas",
  "austin",
  "nashville",
  "atlanta",
  "charlotte",
  "tampa",
  "miami",
  "san-diego",
  "los-angeles",
  "new-orleans",
  "palm-springs",
  "orlando",
  "houston",
]);

// Golf-weekend target audience skews toward Country, Rock, and Classic Rock.
// Hip-Hop removed; Classic Rock added to surface Springsteen, Eagles, Stones-era acts.
const DEFAULT_SURPRISE_GENRES = ["Country", "Rock", "Classic Rock", "Pop"];

function eventMonth(ymd: string): number {
  return Number(ymd.slice(5, 7));
}

export function isWeekendGetawayYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return day === 0 || day >= 4;
}

function eventIsSeasonallyPlayable(metro: MetroConfig, ymd: string): boolean {
  if (DISCOVERY_WARM_WEATHER_METROS.has(metro.slug)) return true;
  const month = eventMonth(ymd);
  if (metro.region === "Midwest" || metro.region === "Northeast") return month >= 5 && month <= 9;
  if (metro.slug === "denver" || metro.slug === "seattle" || metro.slug === "portland") return month >= 5 && month <= 10;
  return month >= 4 && month <= 10;
}

function eventLooksLikeAddOn(event: TMEvent): boolean {
  return /parking|upgrade|club access|vip|lounge|fast lane|testing|do not purchase|parkwhiz|add-on|2-day ticket|cannot split|suite|premium|pass|tailgate|tribute|experience|immersive|jabbawockeez|blue man group|cirque|magic|piano man|sin city|male revue|burlesque|drag brunch/i.test(
    event.name ?? ""
  );
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function venueTypeScore(name: string | undefined): number {
  const venue = name ?? "";
  if (/stadium|field/i.test(venue)) return 35;
  if (/arena|center|centre|garden|forum|sphere/i.test(venue)) return 30;
  // Amphitheaters, pavilions, and outdoor venues score above arenas for the golf audience —
  // outdoor settings align naturally with the lifestyle and tend to draw top touring acts.
  if (/amphitheat(er|re)|pavilion|outdoors|fairgrounds|lawn|park/i.test(venue)) return 38;
  if (/theatre|theater|hall|ballroom|club/i.test(venue)) return 10;
  return 0;
}

/**
 * Maps the headliner's `upcomingEvents._total` (returned by TM Discovery API) to a
 * popularity bonus. An artist with 100+ future tour dates is on a major national tour;
 * one with fewer than 10 is likely regional. This rewards bigger-name acts without
 * requiring a separate TM Attractions API call.
 */
function attractionPopularityScore(event: TMEvent): number {
  const total = event._embedded?.attractions?.[0]?.upcomingEvents?._total ?? 0;
  if (total >= 100) return 30; // major national/world tour (Zach Bryan, Morgan Wallen tier)
  if (total >= 50)  return 20; // active national tour
  if (total >= 20)  return 12; // moderate touring schedule
  if (total >= 10)  return 6;  // some touring
  return 0;
}

function scoreDiscoveryConcert(event: TMEvent, metro: MetroConfig, ymd: string, genreTokens: string[]): number {
  const res = mapTmEventToResult(event, metro.cities[0], metro.state);
  const venue = event._embedded?.venues?.[0];
  const genreConfidence = tmEventGenreMatchConfidence(event, genreTokens);
  let score = 0;
  if (res.book_link.link_type === "direct_event") score += 45;
  if (res.image_url) score += 25;
  if (event._embedded?.attractions?.[0]?.name) score += 25;
  if (res.price_min != null || res.price_max != null) score += 15;
  score += venueTypeScore(venue?.name ?? res.venue.name);
  score += attractionPopularityScore(event);
  if (genreConfidence === "classification") score += 35;
  if (genreConfidence === "title") score += 10;
  if (DISCOVERY_WARM_WEATHER_METROS.has(metro.slug) && eventMonth(ymd) >= 10) score += 12;
  const daysFromStart = Math.max(0, daysBetween(ymd, new Date().toISOString().slice(0, 10)));
  score += Math.max(0, 20 - Math.min(daysFromStart, 180) / 18);
  return score;
}

async function fetchDiscoveryGenreEvents(params: {
  city?: string;
  state?: string;
  startDate: string;
  endDate: string;
  dmaId?: number | null;
  genreTokens: string[];
}): Promise<TMEvent[]> {
  // "Jam Band" is not a reliable TM classification — search known headliners instead
  // of keyword "jam band", which returns almost nothing useful.
  // Country also seeds headliner keywords so mainstream radio country outranks
  // bluegrass/jam acts TM often classifies as Country.
  const jamMode = genreTokensRequestJamBand(params.genreTokens);
  const countryMode = genreTokensRequestCountry(params.genreTokens) && !jamMode;
  const keywordQueries = jamMode
    ? KNOWN_JAM_BAND_ARTISTS.slice(0, 12)
    : countryMode
    ? KNOWN_COUNTRY_ARTISTS.slice(0, 12)
    : Array.from(
        new Set(
          params.genreTokens.flatMap((g) =>
            g
              .toLowerCase()
              .split(/\s*\/\s*|,\s*/)
              .flatMap((part) => genreMatchNeedles(part))
              .filter((part) => part.length > 2 && !part.includes("/"))
          )
        )
      ).slice(0, 4);
  const classificationQueries = jamMode
    ? ["Rock", "Country", "Folk"]
    : countryMode
    ? ["Country"]
    : keywordQueries.slice(0, 3);
  const requests = [
    fetchTicketmasterEventsPage({ ...params, size: 50, page: 0 }),
    fetchTicketmasterEventsPage({ ...params, size: 50, page: 1 }),
    ...keywordQueries.flatMap((artist) => [
      fetchTicketmasterEventsPage({ ...params, artist, size: 50, page: 0 }),
      fetchTicketmasterEventsPage({ ...params, artist, size: 50, page: 1 }),
    ]),
    ...classificationQueries.flatMap((classificationName) => [
      fetchTicketmasterEventsPage({ ...params, classificationName, size: 50, page: 0 }),
      fetchTicketmasterEventsPage({ ...params, classificationName, size: 50, page: 1 }),
    ]),
  ];
  const pages = await Promise.allSettled(requests);
  const byId = new Map<string, TMEvent>();
  for (const page of pages) {
    if (page.status !== "fulfilled") continue;
    for (const event of page.value) {
      byId.set(event.id ?? `${event.name}|${event.dates?.start?.localDate}`, event);
    }
  }
  return [...byId.values()];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      try {
        results[idx] = { status: "fulfilled", value: await mapper(items[idx]) };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function pickBestDiverseConcerts(cands: DiscoveryCandidate[], maxReturn: number): DiscoveryCandidate[] {
  const byDedupe = new Map<string, DiscoveryCandidate>();
  for (const c of cands) {
    const dk = discoverEventDedupeKey(c);
    const existing = byDedupe.get(dk);
    if (!existing || c.score > existing.score) byDedupe.set(dk, c);
  }
  const pool = Array.from(byDedupe.values()).sort((a, b) => b.score - a.score || a.ymd.localeCompare(b.ymd));
  const picked: DiscoveryCandidate[] = [];
  const usedMetros = new Set<string>();
  const usedCities = new Set<string>();
  const usedArtists = new Set<string>();
  // Year-month bucket so the final set spreads from near to further-out dates
  // instead of clustering in one busy month.
  const usedMonths = new Set<string>();
  const monthOf = (c: DiscoveryCandidate) => c.ymd.slice(0, 7);

  const passes = [
    (c: DiscoveryCandidate) => !usedMetros.has(c.metro.slug) && !usedArtists.has(c.artist.toLowerCase()) && !usedMonths.has(monthOf(c)),
    (c: DiscoveryCandidate) => !usedCities.has(c.city.toLowerCase()) && !usedArtists.has(c.artist.toLowerCase()) && !usedMonths.has(monthOf(c)),
    (c: DiscoveryCandidate) => !usedMetros.has(c.metro.slug) && !usedArtists.has(c.artist.toLowerCase()),
    (c: DiscoveryCandidate) => !usedCities.has(c.city.toLowerCase()) && !usedArtists.has(c.artist.toLowerCase()),
    (c: DiscoveryCandidate) => !usedMetros.has(c.metro.slug),
    (c: DiscoveryCandidate) => !usedCities.has(c.city.toLowerCase()),
    (c: DiscoveryCandidate) => !usedArtists.has(c.artist.toLowerCase()),
    () => true,
  ];

  for (const pass of passes) {
    for (const c of pool) {
      if (picked.length >= maxReturn) break;
      if (picked.some((p) => discoverEventDedupeKey(p) === discoverEventDedupeKey(c))) continue;
      if (!pass(c)) continue;
      picked.push(c);
      usedMetros.add(c.metro.slug);
      usedCities.add(c.city.toLowerCase());
      usedArtists.add(c.artist.toLowerCase());
      usedMonths.add(monthOf(c));
    }
  }

  return picked;
}

function tmEventToDiscoverOption(event: TMEvent, metro: MetroConfig, score = 0): Record<string, unknown> {
  const res = mapTmEventToResult(event, metro.cities[0], metro.state);
  const venue = event._embedded?.venues?.[0];
  const artist = event._embedded?.attractions?.[0]?.name ?? res.name;
  return {
    id: event.id ?? discoverEventDedupeKey({ event, metro, ymd: res.date_time.slice(0, 10) }),
    artist,
    city: res.venue.city,
    venue: venue?.name ?? res.venue.name,
    date: res.date_time.slice(0, 10),
    url: res.book_url,
    _score: score,
    _verified_ticketmaster: true,
  };
}

export type DiscoveryShowRow = {
  tm_event_id: string;
  artist: string;
  event_name: string;
  metro_slug: string;
  city: string;
  venue: string;
  event_date: string;
  genre: string | null;
  ticket_url: string | null;
  image_url: string | null;
  min_price: number | null;
  max_price: number | null;
  score: number;
};

/**
 * Gather upcoming weekend concerts across catalog metros via a few paginated
 * NATIONWIDE Ticketmaster calls per genre (filtered to metros client-side).
 * Rate-limited and quota-friendly (~tens of calls). Used by the scheduled
 * refresh-discovery job to populate the discovery_shows cache so user-facing
 * discovery never hits Ticketmaster live.
 */
export async function fetchNationwideDiscoveryShows(params: {
  metros: MetroConfig[];
  startDate: string;
  endDate: string;
  genreTokens: string[];
  pagesPerGenre?: number;
  /** Optional out-param for operational diagnostics (request/rejection counts). */
  stats?: Record<string, unknown>;
}): Promise<DiscoveryShowRow[]> {
  const { metros, startDate, endDate, genreTokens } = params;
  const pagesPerGenre = params.pagesPerGenre ?? 4;
  const genreList = (genreTokens.length > 0 ? genreTokens : ["Music"]).slice(0, 12);
  const jamMode = genreTokensRequestJamBand(genreList);
  const countryMode = genreTokensRequestCountry(genreList) && !jamMode;
  // Classification "Jam Band" is unreliable on TM — keep a light classification
  // attempt, then fill via known jam headliner keyword pages.
  // Country seeds mainstream headliners so cache isn't dominated by bluegrass/jam.
  type NationwideReq = { classificationName?: string; artist?: string; page: number };
  const reqs: NationwideReq[] = [];
  for (const g of genreList) {
    for (let page = 0; page < pagesPerGenre; page++) {
      reqs.push({ classificationName: g, page });
    }
  }
  if (jamMode) {
    for (const artist of KNOWN_JAM_BAND_ARTISTS.slice(0, 20)) {
      reqs.push({ artist, page: 0 });
      reqs.push({ artist, page: 1 });
    }
  } else if (countryMode) {
    for (const artist of KNOWN_COUNTRY_ARTISTS.slice(0, 16)) {
      reqs.push({ artist, page: 0 });
      reqs.push({ artist, page: 1 });
    }
  }

  const pages = await mapWithConcurrency(reqs, 3, (r) =>
    fetchTicketmasterEventsPage({
      classificationName: r.classificationName,
      artist: r.artist,
      startDate,
      endDate,
      size: 199,
      page: r.page,
    })
  );

  const byId = new Map<string, TMEvent>();
  let rejected = 0;
  let firstError = "";
  for (const p of pages) {
    if (p.status !== "fulfilled") {
      rejected++;
      if (!firstError) firstError = String((p as PromiseRejectedResult).reason).slice(0, 250);
      continue;
    }
    for (const e of p.value) byId.set(e.id ?? `${e.name}|${e.dates?.start?.localDate}`, e);
  }
  if (params.stats) {
    params.stats.requests = reqs.length;
    params.stats.rejected = rejected;
    params.stats.distinctEvents = byId.size;
    params.stats.firstError = firstError;
    params.stats.jamMode = jamMode;
    params.stats.countryMode = countryMode;
  }

  const rows: DiscoveryShowRow[] = [];
  for (const e of byId.values()) {
    const id = e.id?.trim();
    if (!id) continue;
    const v = e._embedded?.venues?.[0];
    const metro = metros.find((m) => eventVenueBelongsToMetro(v, m));
    if (!metro) continue;
    const ymd = e.dates?.start?.localDate ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (!isWeekendGetawayYmd(ymd)) continue;
    if (!eventIsSeasonallyPlayable(metro, ymd)) continue;
    if (eventLooksLikeAddOn(e)) continue;
    const score = scoreDiscoveryConcert(e, metro, ymd, genreList);
    const mapped = mapTmEventToResult(e, metro.cities[0], metro.state);
    const classification = e.classifications?.[0];
    const genreParts = [classification?.genre?.name, classification?.subGenre?.name].filter(Boolean);
    const genre = genreParts.length ? genreParts.join(" / ") : null;
    rows.push({
      tm_event_id: id,
      artist: e._embedded?.attractions?.[0]?.name ?? e.name ?? "",
      event_name: e.name ?? "",
      metro_slug: metro.slug,
      city: v?.city?.name ?? metro.cities[0],
      venue: v?.name ?? mapped.venue.name ?? "",
      event_date: ymd,
      genre,
      ticket_url: mapped.book_url ?? null,
      image_url: mapped.image_url ?? null,
      min_price: mapped.price_min ?? null,
      max_price: mapped.price_max ?? null,
      score: Math.round(score),
    });
  }
  return rows;
}

/**
 * Discovery picker: real Ticketmaster events only, scoped to catalog golf metros.
 * Genre / artist filtering is best-effort against TM classifications + titles.
 */
export async function discoverConcertsFromCatalogMetros(params: {
  metros: MetroConfig[];
  startDate: string;
  endDate: string;
  artistKeyword?: string;
  genreTokens: string[];
  maxReturn: number;
  excludeEventIds?: string[];
  searchDepth?: number;
  /** Internal: accumulate weekday-dropped artist shows across depth levels */
  _weekdayDropRef?: { count: number };
}): Promise<Array<Record<string, unknown>>> {
  const apiKey = Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY");
  if (!apiKey) {
    console.warn("[DISCOVER_TM] TICKETMASTER key missing — discover returns empty");
    return [];
  }

  const { metros, startDate, endDate, artistKeyword, maxReturn } = params;
  const excludeIds = new Set((params.excludeEventIds ?? []).map((id) => id.trim()).filter(Boolean));
  const searchDepth = params.searchDepth ?? 0;

  // ── Artist fast path ────────────────────────────────────────────────────────
  // For a named artist we make ONE nationwide TM call (countryCode=US, no DMA/city)
  // then filter results to our catalog metros client-side.  The previous approach
  // (concurrency-5 fan-out across 40+ metros) hit TM's 5 req/sec spike-arrest limit
  // and silently dropped ~35 of 40 metro fetches with HTTP 429 errors.
  if (artistKeyword) {
    let events: TMEvent[] = [];
    try {
      events = await fetchTicketmasterEvents({
        artist: artistKeyword,
        startDate,
        endDate,
        size: 200, // no geo filter → countryCode=US only
      });
      console.log(`[DISCOVER_TM] nationwide artist="${artistKeyword}" depth=${searchDepth} tmHits=${events.length}`);
    } catch (err) {
      console.warn("[DISCOVER_TM] nationwide artist fetch failed:", err instanceof Error ? err.message : String(err));
    }

    const cands: DiscoveryCandidate[] = [];
    let droppedByVenue = 0, droppedByArtistMatch = 0, droppedByWeekend = 0, droppedBySeasonal = 0, droppedByAddOn = 0;

    for (const e of events) {
      const v = e._embedded?.venues?.[0];
      // Find which of our target metros this venue belongs to (if any).
      const metro = metros.find((m) => eventVenueBelongsToMetro(v, m));
      if (!metro) { droppedByVenue++; continue; }
      if (!tmEventMatchesArtistQuery(e, artistKeyword)) { droppedByArtistMatch++; continue; }
      const ymd = e.dates?.start?.localDate ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      if (!isWeekendGetawayYmd(ymd)) { droppedByWeekend++; continue; }
      if (!eventIsSeasonallyPlayable(metro, ymd)) { droppedBySeasonal++; continue; }
      if (eventLooksLikeAddOn(e)) { droppedByAddOn++; continue; }
      const score = scoreDiscoveryConcert(e, metro, ymd, []);
      const artist = e._embedded?.attractions?.[0]?.name ?? e.name ?? "";
      const city = v?.city?.name ?? metro.cities[0];
      cands.push({ metro, event: e, ymd, score, artist, city });
    }

    console.log(
      `[DISCOVER_TM] artist="${artistKeyword}" depth=${searchDepth} passed=${cands.length}` +
      ` dropped: venue=${droppedByVenue} artistMatch=${droppedByArtistMatch}` +
      ` weekend=${droppedByWeekend} seasonal=${droppedBySeasonal} addOn=${droppedByAddOn}`
    );
    if (params._weekdayDropRef && droppedByWeekend > 0) {
      params._weekdayDropRef.count += droppedByWeekend;
    }

    const preferred = cands.filter((c) => !excludeIds.has(c.event.id ?? discoverEventDedupeKey(c)));
    let picked = pickBestDiverseConcerts(preferred, maxReturn);
    if (picked.length < maxReturn && searchDepth < 1) {
      const pickedIds = new Set(picked.map((c) => c.event.id ?? discoverEventDedupeKey(c)));
      const overflow = await discoverConcertsFromCatalogMetros({
        metros,
        startDate: addDaysYmd(endDate, 1),
        endDate: addDaysYmd(endDate, 180),
        artistKeyword,
        genreTokens: [],
        maxReturn: maxReturn - picked.length,
        excludeEventIds: [...excludeIds, ...pickedIds],
        searchDepth: searchDepth + 1,
        _weekdayDropRef: params._weekdayDropRef,
      });
      return [...picked.map((c) => tmEventToDiscoverOption(c.event, c.metro, c.score)), ...overflow]
        .sort((a, b) => (Number(b._score ?? 0) - Number(a._score ?? 0)) || String(a.date || "").localeCompare(String(b.date || "")))
        .slice(0, maxReturn);
    }
    return picked
      .map((c) => tmEventToDiscoverOption(c.event, c.metro, c.score))
      .sort((a, b) => (Number(b._score ?? 0) - Number(a._score ?? 0)) || String(a.date || "").localeCompare(String(b.date || "")));
  }
  // ── End artist fast path ─────────────────────────────────────────────────────

  const isDefaultSurpriseSearch = params.genreTokens.length === 0;
  const genreTokens = isDefaultSurpriseSearch
    ? DEFAULT_SURPRISE_GENRES
    : params.genreTokens;

  const cands: DiscoveryCandidate[] = [];
  let tmTotalHits = 0;
  let droppedByVenue = 0;
  let droppedByArtistMatch = 0;
  let droppedByWeekend = 0;
  let droppedBySeasonal = 0;
  let droppedByAddOn = 0;

  // Shared candidate filter. metroHint is set for per-metro (city-scoped) fetches;
  // for nationwide results we resolve the venue's metro client-side.
  const ingest = (events: TMEvent[], metroHint: MetroConfig | null) => {
    for (const e of events) {
      const v = e._embedded?.venues?.[0];
      const metro = metroHint ?? metros.find((m) => eventVenueBelongsToMetro(v, m)) ?? null;
      if (!metro || !eventVenueBelongsToMetro(v, metro)) { droppedByVenue++; continue; }
      if (genreTokens.length > 0 && !tmEventMatchesGenreTokens(e, genreTokens)) { droppedByArtistMatch++; continue; }
      const ymd = e.dates?.start?.localDate ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      if (!isWeekendGetawayYmd(ymd)) { droppedByWeekend++; continue; }
      if (!eventIsSeasonallyPlayable(metro, ymd)) { droppedBySeasonal++; continue; }
      if (eventLooksLikeAddOn(e)) { droppedByAddOn++; continue; }
      const score = scoreDiscoveryConcert(e, metro, ymd, genreTokens);
      const artist = e._embedded?.attractions?.[0]?.name ?? e.name ?? "";
      const city = v?.city?.name ?? metro.cities[0];
      cands.push({ metro, event: e, ymd, score, artist, city });
    }
  };

  if (metros.length > 6) {
    // Nationwide genre fast path (no specific city). A few paginated nationwide
    // calls per genre, filtered to catalog metros client-side — mirrors the artist
    // fast path. The previous per-metro fan-out fired ~16–32 TM calls per metro
    // across 40+ metros, tripping TM's 5 req/sec spike-arrest limit and silently
    // dropping most fetches, which starved the pool and broke "Show different options".
    const genreList = (genreTokens.length > 0 ? genreTokens : ["Music"]).slice(0, 6);
    const jamMode = !artistKeyword && genreTokensRequestJamBand(genreList);
    const countryMode = !artistKeyword && genreTokensRequestCountry(genreList) && !jamMode;
    type NationwideReq = { classificationName?: string; artist?: string; page: number };
    const reqs: NationwideReq[] = [];
    for (const g of genreList) {
      for (let page = 0; page < 3; page++) reqs.push({ classificationName: g, page });
    }
    // Jam Band chip: TM classification is empty/noisy — keyword known headliners.
    if (jamMode) {
      for (const artist of KNOWN_JAM_BAND_ARTISTS.slice(0, 14)) {
        reqs.push({ artist, page: 0 });
      }
    } else if (countryMode) {
      for (const artist of KNOWN_COUNTRY_ARTISTS.slice(0, 14)) {
        reqs.push({ artist, page: 0 });
      }
    }
    const pages = await mapWithConcurrency(reqs, 4, (r) =>
      fetchTicketmasterEventsPage({
        classificationName: r.classificationName,
        artist: r.artist,
        startDate,
        endDate,
        size: 199,
        page: r.page,
      })
    );
    const byId = new Map<string, TMEvent>();
    for (const p of pages) {
      if (p.status !== "fulfilled") continue;
      for (const e of p.value) byId.set(e.id ?? `${e.name}|${e.dates?.start?.localDate}`, e);
    }
    tmTotalHits = byId.size;
    ingest([...byId.values()], null);
  } else {
    // City-scoped search (few metros): per-metro genre fetch stays well under the
    // rate limit and benefits from city/DMA targeting.
    const settled = await mapWithConcurrency(metros, 5, async (metro) => {
      const events = await fetchDiscoveryGenreEvents({
        city: metro.cities[0],
        state: metro.state,
        startDate,
        endDate,
        genreTokens,
      });
      return { metro, events };
    });
    for (const s of settled) {
      if (s.status !== "fulfilled") {
        console.log("[DISCOVER_TM] metro fetch rejected:", s.reason);
        continue;
      }
      const { metro, events } = s.value;
      tmTotalHits += events.length;
      ingest(events, metro);
    }
  }

  // Log filter breakdown so Edge Function logs can diagnose zero-result artist searches.
  if (artistKeyword || tmTotalHits > 0) {
    console.log(
      `[DISCOVER_TM] artist="${artistKeyword ?? "(genre)"}" depth=${params.searchDepth ?? 0}` +
      ` tmHits=${tmTotalHits} passed=${cands.length}` +
      ` dropped: venue=${droppedByVenue} artistMatch=${droppedByArtistMatch}` +
      ` weekend=${droppedByWeekend} seasonal=${droppedBySeasonal} addOn=${droppedByAddOn}`
    );
  }

  // Accumulate weekday drops so the caller can surface a helpful hint when 0 results.
  if (params._weekdayDropRef && droppedByWeekend > 0) {
    params._weekdayDropRef.count += droppedByWeekend;
  }

  const preferred = cands.filter((c) => !excludeIds.has(c.event.id ?? discoverEventDedupeKey(c)));
  let picked = pickBestDiverseConcerts(preferred, maxReturn);
  if (picked.length < maxReturn && searchDepth < 1) {
    const pickedIds = new Set(picked.map((c) => c.event.id ?? discoverEventDedupeKey(c)));
    const overflow = await discoverConcertsFromCatalogMetros({
      metros,
      startDate: addDaysYmd(endDate, 1),
      endDate: addDaysYmd(endDate, 180),
      artistKeyword,
      genreTokens,
      maxReturn: maxReturn - picked.length,
      excludeEventIds: [...excludeIds, ...pickedIds],
      searchDepth: searchDepth + 1,
      _weekdayDropRef: params._weekdayDropRef,
    });
    return [...picked.map((c) => tmEventToDiscoverOption(c.event, c.metro, c.score)), ...overflow]
      .sort((a, b) => (Number(b._score ?? 0) - Number(a._score ?? 0)) || String(a.date || "").localeCompare(String(b.date || "")))
      .slice(0, maxReturn);
  }
  return picked
    .map((c) => tmEventToDiscoverOption(c.event, c.metro, c.score))
    .sort((a, b) => (Number(b._score ?? 0) - Number(a._score ?? 0)) || String(a.date || "").localeCompare(String(b.date || "")));
}

/** After Perplexity discovery — keep only options that Ticketmaster confirms in-window. */
export async function verifyDiscoveryConcertOptions(
  options: Record<string, unknown>[],
  discStart: string,
  discEnd: string
): Promise<Record<string, unknown>[]> {
  const results = await Promise.all(
    options.map(async (raw) => {
      const artist = String(raw.artist || "").trim();
      const city = String(raw.city || "").trim();
      if (!artist || !city) return null;
      const dateRaw = String(raw.date || raw.event_date || raw.eventDate || "").trim();
      const hint = parseFlexibleDateToYmd(dateRaw);
      const resolved = await resolveConcertFromTicketmaster({
        artist,
        city,
        startDate: discStart,
        endDate: discEnd,
        dateHintYmd: hint,
      });
      if (!resolved) {
        console.log(`[DISCOVER_VERIFY] dropped unverified: ${artist} @ ${city}`);
        return null;
      }
      const ymd = resolved.date_time.slice(0, 10);
      if (ymd < discStart || ymd > discEnd) {
        console.log(`[DISCOVER_VERIFY] TM date ${ymd} outside [${discStart}, ${discEnd}] for ${artist} @ ${city}`);
        return null;
      }
      return {
        artist,
        city: resolved.venue.city,
        venue: resolved.venue.name,
        date: ymd,
        url: resolved.book_url,
        _verified_ticketmaster: true,
      };
    })
  );
  return results.filter((x): x is Record<string, unknown> => x != null);
}
