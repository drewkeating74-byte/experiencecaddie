/**
 * Outbound link architecture — apps/web/src/lib/outboundLinks.ts
 *
 * HOTELS
 * - Package- or admin-supplied `hotel_url` (override) wins: direct links to Booking,
 *   Marriott, a specific property, etc. Users go straight to that page.
 * - Otherwise we build a Google Maps search URL (property + city + optional dates) so
 *   people land on Google’s place/listing experience, not OTAs like Expedia.
 * - `isAffiliate` stays false until we have a partner whose deep links preserve that UX.
 *   When we do, set `isAffiliate` / `affiliateSource` in `buildHotelUrl` only.
 *
 * TICKETS & GOLF
 * - `buildTicketUrl` / `buildGolfUrl` pass through URLs with provider inference.
 *   `isAffiliate` is false; future ticket/golf partners wrap URLs inside these functions.
 *
 * OutboundLinkContext (placement for analytics)
 * - homepage: featured package grid on `/`
 * - package_card: a specific package tile (e.g. homepage card; treat `/packages/:id` detail CTAs as this when linking to external booking for that package)
 * - packages_page: `/packages` list interactions
 * - itinerary: `/itinerary/:id` Bronze/Silver/Gold outbound buttons
 * - planner_result: concert picker, discovery, and planner-adjacent surfaces (e.g. dev search preview)
 *
 * Analytics: with enriched `logEvent` extras you can answer:
 * - Which artists/cities drive the most ticket clicks? (artist_name, city, event_date in extra)
 * - Which context produces the most hotel clicks? (extra.context)
 * - Do package hotel_url overrides outperform generic Google Hotels? (hotel_link_source)
 *
 * ---------------------------------------------------------------------------
 * TODO — future hotel affiliates (Expedia, Awin, etc.)
 *
 * `buildHotelUrl()` is the single integration point. Add branching on env or partner
 * config here only; do not scatter affiliate logic in UI components.
 *
 * Any affiliate URL must still give users a usable hotel search (destination + dates).
 * Do not replace the Google Maps fallback with a profile page or generic landing
 * that removes search utility. If a partner only offers a weak link, keep Google Hotels
 * as fallback or primary until a deep link exists.
 * ---------------------------------------------------------------------------
 */

export type OutboundLinkContext =
  | "homepage"
  | "package_card"
  | "packages_page"
  | "itinerary"
  | "planner_result";

export type OutboundLinkCategory = "hotel" | "ticket" | "golf";

/** How the hotel URL was produced — for analytics and CTA copy. */
export type HotelLinkSource = "override" | "google_hotels" | "booking_com";

export interface BuiltOutboundLink {
  url: string;
  provider: string;
  category: OutboundLinkCategory;
  isAffiliate: boolean;
  affiliateSource?: string;
  context: OutboundLinkContext;
  /** Set for hotel category only. */
  hotelLinkSource?: HotelLinkSource;
}

export interface HotelLinkParams {
  context: OutboundLinkContext;
  packageId?: string;
  destination: string;
  checkIn?: string;
  checkOut?: string;
  /** Reserved: omitting from search query keeps copy readable; add when UX is proven. */
  adults?: number;
  overrideUrl?: string | null;
}

/**
 * Single integration point for hotel URLs (including future affiliate wrapping).
 *
 * When VITE_BOOKINGCOM_AWIN_ID is configured, all hotel clicks route through
 * Booking.com via the AWIN affiliate network (publisher ID from env).
 * Commission is earned when the user completes a booking on Booking.com.
 * The destination (hotel name + city) is used as the Booking.com search query
 * so users land on a pre-filtered results page for that specific property.
 */
export function buildHotelUrl(params: HotelLinkParams): BuiltOutboundLink {
  const awinId = (import.meta.env.VITE_BOOKINGCOM_AWIN_ID as string | undefined)?.trim();

  if (awinId) {
    return {
      url: buildBookingComAwinUrl(params.destination, params.checkIn, params.checkOut, awinId),
      provider: "Booking.com",
      category: "hotel",
      isAffiliate: true,
      affiliateSource: "booking_com_awin",
      context: params.context,
      hotelLinkSource: "booking_com",
    };
  }

  const override = params.overrideUrl?.trim();
  // Package/admin "hotel" links are often pasted Expedia/Booking search URLs — send users to Google Hotels instead.
  if (override && !shouldReplaceOtaHotelUrl(override)) {
    return {
      url: override,
      provider: inferHotelProvider(override),
      category: "hotel",
      isAffiliate: false,
      context: params.context,
      hotelLinkSource: "override",
    };
  }

  const url = buildGoogleMapsHotelSearchUrl(
    params.destination,
    params.checkIn,
    params.checkOut
  );

  return {
    url,
    provider: "Google Maps",
    category: "hotel",
    isAffiliate: false,
    context: params.context,
    hotelLinkSource: "google_hotels",
  };
}

/**
 * Build a Booking.com search URL wrapped in an AWIN affiliate tracking link.
 * The destination is used as the search query (e.g. "Hotel Van Zandt Austin TX").
 * AWIN merchant ID 6776 = Booking.com North America.
 */
function buildBookingComAwinUrl(
  destination: string,
  checkIn: string | undefined,
  checkOut: string | undefined,
  awinId: string
): string {
  const bookingUrl = new URL("https://www.booking.com/searchresults.html");
  bookingUrl.searchParams.set("ss", destination.trim() || "hotels");
  if (checkIn) bookingUrl.searchParams.set("checkin", checkIn);
  if (checkOut) bookingUrl.searchParams.set("checkout", checkOut);
  bookingUrl.searchParams.set("group_adults", "2");
  bookingUrl.searchParams.set("no_rooms", "1");
  bookingUrl.searchParams.set("lang", "en-us");

  const awinUrl = new URL("https://www.awin1.com/cread.php");
  awinUrl.searchParams.set("awinmid", "6776"); // Booking.com North America AWIN merchant ID
  awinUrl.searchParams.set("awinid", awinId);
  awinUrl.searchParams.set("ued", bookingUrl.toString());
  return awinUrl.toString();
}

/**
 * Google Maps hotel discovery — `query` examples after encoding:
 * - destination only: "Austin hotels"
 * - + check-in: "Austin 2026-04-11 hotels"
 * - + range: "Austin 2026-04-11 to 2026-04-13 hotels"
 */
function buildGoogleMapsHotelSearchUrl(
  destination: string,
  checkIn?: string,
  checkOut?: string
): string {
  const dest = destination.trim();
  const base = dest ? `${dest} hotels` : "hotels";

  if (checkIn && checkOut && checkOut !== checkIn) {
    const q = `${dest ? `${dest} ` : ""}${checkIn} to ${checkOut} hotels`.trim();
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  if (checkIn) {
    const q = `${dest ? `${dest} ` : ""}${checkIn} hotels`.trim();
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(base)}`;
}

/** Pass through — property or brand sites users expect to land on directly. */
const DIRECT_HOTEL_BRAND_HOSTS = new Set([
  "marriott.com",
  "hilton.com",
  "hyatt.com",
  "ihg.com",
  "choicehotels.com",
  "wyndhamhotels.com",
  "bestwestern.com",
  "accor.com",
  "radissonhotels.com",
  "omnihotels.com",
  "loewshotels.com",
  "sonesta.com",
]);

/**
 * True when the URL should be replaced with a Google Hotels search (OTA / affiliate
 * wrappers). Direct hotel brand sites (marriott.com, hilton.com, …) stay false.
 */
export function shouldReplaceOtaHotelUrl(url: string): boolean {
  if (!url || typeof url !== "string") return true;
  const raw = url.trim();
  const u = raw.toLowerCase();
  if (!u.startsWith("http")) return true;

  // Shorteners / redirects often wrap Expedia/Booking; host alone misses these.
  const otaInFullString =
    /(^|\/\/|\.)(expedia\.(com|net|[a-z]{2,3})|booking\.com|hotels\.com|hotel\.com|agoda\.com|priceline\.com|orbitz\.com|travelocity\.com|trip\.com|vrbo\.com|trivago\.com|momondo\.com|kayak\.com|hometogo\.com)\b/i.test(
      u
    ) || /\b(awin1\.com|linksynergy\.com|shareasale\.com|anrdoezrs\.net|ojrq\.net|dpbolvw\.net|kqzyfj\.com|jdoqocy\.com|goto\.target)\b/i.test(
      u
    );
  if (
    otaInFullString &&
    !u.includes("google.com/travel/hotels") &&
    !u.includes("google.com/maps") &&
    !u.includes("maps.google")
  ) {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.replace(/^www\./, "");
      const base = host.replace(/^m\./, "");
      if (DIRECT_HOTEL_BRAND_HOSTS.has(base) || [...DIRECT_HOTEL_BRAND_HOSTS].some((d) => base === d || base.endsWith("." + d))) {
        return false;
      }
    } catch {
      /* fall through */
    }
    return true;
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./, "");
    const base = host.replace(/^m\./, "");
    if (DIRECT_HOTEL_BRAND_HOSTS.has(base) || [...DIRECT_HOTEL_BRAND_HOSTS].some((d) => base === d || base.endsWith("." + d))) {
      return false;
    }
    const ota = [
      "booking.com",
      "expedia.com",
      "hotels.com",
      "hotel.com",
      "agoda.com",
      "priceline.com",
      "orbitz.com",
      "travelocity.com",
      "trip.com",
      "vrbo.com",
      "trivago.com",
      "momondo.com",
      "hometogo.com",
    ];
    if (ota.some((d) => base === d || base.endsWith("." + d))) return true;
    if (host === "awin1.com" || host.endsWith(".awin1.com")) return true;
    if (host.includes("expedia.")) return true;
    if (host.includes("linksynergy.com") || host.includes("shareasale.com")) return true;
    if (/^kayak\.com$/i.test(base) || base.endsWith(".kayak.com")) return true;
    return false;
  } catch {
    return true;
  }
}

/** Single label for all hotel outbound buttons (city/search details stay in the URL). */
export function getHotelOutboundCtaLabel(
  _hotelLinkSource: HotelLinkSource | undefined,
  _cityDisplay: string
): string {
  void _hotelLinkSource;
  void _cityDisplay;
  return "View hotels";
}

/** Short, consistent label; destination stays in the URL. */
export function getTicketOutboundCtaLabel(_provider: string): string {
  void _provider;
  return "View tickets";
}

/** Short, consistent label; destination stays in the URL. */
export function getGolfOutboundCtaLabel(_provider: string): string {
  void _provider;
  return "View golf";
}

function inferHotelProvider(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("google.com/maps") || u.includes("maps.google")) return "Google Maps";
  if (u.includes("google.com/travel/hotels")) return "Google Hotels";
  if (u.includes("expedia.com")) return "Expedia";
  if (u.includes("hotels.com")) return "Hotels.com";
  if (u.includes("booking.com")) return "Booking.com";
  if (u.includes("marriott.com")) return "Marriott";
  if (u.includes("hilton.com")) return "Hilton";
  return "Hotel";
}

export interface TicketLinkParams {
  context: OutboundLinkContext;
  packageId?: string;
  url: string;
  provider?: string;
}

export function buildTicketUrl(params: TicketLinkParams): BuiltOutboundLink {
  return {
    url: params.url,
    provider: params.provider ?? inferTicketProvider(params.url),
    category: "ticket",
    isAffiliate: false,
    context: params.context,
  };
}

function inferTicketProvider(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("google.com/search")) return "Google";
  if (u.includes("ticketmaster.com")) return "Ticketmaster";
  if (u.includes("livenation.com")) return "Live Nation";
  if (u.includes("axs.com")) return "AXS";
  if (u.includes("seatgeek.com")) return "SeatGeek";
  if (u.includes("stubhub.com")) return "StubHub";
  return "Tickets";
}

export interface GolfLinkParams {
  context: OutboundLinkContext;
  packageId?: string;
  url: string;
  provider?: string;
}

export function buildGolfUrl(params: GolfLinkParams): BuiltOutboundLink {
  return {
    url: params.url,
    provider: params.provider ?? inferGolfProvider(params.url),
    category: "golf",
    isAffiliate: false,
    context: params.context,
  };
}

function inferGolfProvider(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("golfnow.com")) return "GolfNow";
  if (u.includes("teeoff.com")) return "TeeOff";
  if (u.includes("chronogolf.com")) return "Chronogolf";
  if (u.includes("google.com/maps")) return "Google Maps";
  return "Golf";
}

/*
 * ─── Integration notes (extend without touching call sites) ─────────────────
 *
 * Hotel affiliate: implement inside `buildHotelUrl()` — branch on env or config,
 * return BuiltOutboundLink with url, isAffiliate, affiliateSource, and keep
 * hotelLinkSource accurate for analytics.
 *
 * Ticket / golf affiliate: implement inside `buildTicketUrl` / `buildGolfUrl` the
 * same way; preserve pass-through when no partner is configured.
 *
 * UI components should only call these builders + label helpers; never hardcode
 * partner domains in pages.
 */
