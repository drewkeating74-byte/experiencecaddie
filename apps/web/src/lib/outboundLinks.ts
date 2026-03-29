/**
 * Outbound link architecture — apps/web/src/lib/outboundLinks.ts
 *
 * HOTELS
 * - Package- or admin-supplied `hotel_url` (override) wins: direct links to Booking,
 *   Marriott, a specific property, etc. Users go straight to that page.
 * - Otherwise we build a Google Travel Hotels search URL with destination and optional
 *   check-in/out dates so people land on real results, not an empty storefront.
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
 * Do not replace the Google Hotels fallback with a profile page or generic landing
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
export type HotelLinkSource = "override" | "google_hotels";

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
 */
export function buildHotelUrl(params: HotelLinkParams): BuiltOutboundLink {
  if (params.overrideUrl) {
    return {
      url: params.overrideUrl,
      provider: inferHotelProvider(params.overrideUrl),
      category: "hotel",
      isAffiliate: false,
      context: params.context,
      hotelLinkSource: "override",
    };
  }

  const url = buildGoogleHotelsSearchUrl(
    params.destination,
    params.checkIn,
    params.checkOut
  );

  return {
    url,
    provider: "Google Hotels",
    category: "hotel",
    isAffiliate: false,
    context: params.context,
    hotelLinkSource: "google_hotels",
  };
}

/**
 * Google Travel Hotels `q` string — examples after encoding:
 * - destination only: "Austin hotels"
 * - + check-in: "Austin 2026-04-11 hotels"
 * - + range: "Austin 2026-04-11 to 2026-04-13 hotels"
 */
function buildGoogleHotelsSearchUrl(
  destination: string,
  checkIn?: string,
  checkOut?: string
): string {
  const dest = destination.trim();
  const base = dest ? `${dest} hotels` : "hotels";

  if (checkIn && checkOut && checkOut !== checkIn) {
    const q = `${dest ? `${dest} ` : ""}${checkIn} to ${checkOut} hotels`.trim();
    return `https://www.google.com/travel/hotels?q=${encodeURIComponent(q)}`;
  }
  if (checkIn) {
    const q = `${dest ? `${dest} ` : ""}${checkIn} hotels`.trim();
    return `https://www.google.com/travel/hotels?q=${encodeURIComponent(q)}`;
  }
  return `https://www.google.com/travel/hotels?q=${encodeURIComponent(base)}`;
}

export function getHotelOutboundCtaLabel(
  hotelLinkSource: HotelLinkSource | undefined,
  cityDisplay: string
): string {
  if (hotelLinkSource === "google_hotels") {
    const c = cityDisplay.trim();
    return c ? `View hotels in ${c}` : "View hotels";
  }
  return "View recommended hotel";
}

export function getHotelOutboundHelperText(opts: {
  hotelLinkSource: HotelLinkSource | undefined;
  cityDisplay: string;
  checkIn?: string;
  checkOut?: string;
}): string | null {
  if (opts.hotelLinkSource !== "google_hotels") return null;
  const c = opts.cityDisplay.trim() || "your trip";
  if (opts.checkIn && opts.checkOut && opts.checkOut !== opts.checkIn) {
    return `Opens Google Hotels with ${c} for your dates.`;
  }
  if (opts.checkIn) {
    return `Opens Google Hotels with ${c} for your stay.`;
  }
  return `Opens Google Hotels for ${c}.`;
}

export function getTicketOutboundCtaLabel(provider: string): string {
  const p = provider.trim();
  if (p && p !== "Tickets") return `View tickets on ${p}`;
  return "View tickets";
}

export function getGolfOutboundCtaLabel(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p.includes("google") && p.includes("map")) return "View golf options";
  if (provider && provider !== "Golf") return `View tee times on ${provider}`;
  return "View tee times";
}

function inferHotelProvider(url: string): string {
  const u = url.toLowerCase();
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
