/**
 * outboundLinks.ts — central builder for all monetizable outbound links.
 *
 * This is the single source of truth for generating hotel, ticket, and golf
 * booking URLs. Every outbound click in the app should go through one of these
 * builders so affiliate tracking, provider attribution, and analytics are
 * consistent across homepage, package cards, itinerary results, and planner output.
 *
 * ─── AFFILIATE CONFIGURATION ────────────────────────────────────────────────
 *
 * Hotels (Expedia):
 *   Add the following to apps/web/.env.local (never commit this file):
 *
 *     # Option A — Expedia direct affiliate (AFFCID / AFFLID params appended to search URL):
 *     VITE_EXPEDIA_AFFILIATE_TYPE=direct
 *     VITE_EXPEDIA_AFFILIATE_PARAMS=AFFCID=YOUR_CODE&AFFLID=YOUR_ID
 *
 *     # Option B — CJ Affiliate deep-link wrapper (wraps destination URL as ?url= param):
 *     VITE_EXPEDIA_AFFILIATE_TYPE=cj
 *     VITE_EXPEDIA_AFFILIATE_BASE=https://www.tkqlhce.com/click-XXXXXXXX-XXXXXXXXXX
 *
 *     # Option C — Expedia Travel Creator (generic landing page, no deep-link support):
 *     VITE_EXPEDIA_AFFILIATE_TYPE=creator
 *     VITE_EXPEDIA_AFFILIATE_BASE=https://www.expedia.com/your-creator-link
 *
 *   If no env vars are set, plain Expedia Hotel-Search URLs are returned (no affiliate).
 *   See bottom of this file for where to drop in each format.
 *
 * Tickets (Ticketmaster):
 *   No affiliate program active yet. Links are passed through unchanged and
 *   tagged as non-affiliate. When an affiliate relationship is established:
 *     VITE_TICKETMASTER_AFFILIATE_ID=your_id
 *   Update buildTicketUrl() below to wrap accordingly.
 *
 * Golf (GolfNow):
 *   No affiliate program active yet. When approved:
 *     VITE_GOLFNOW_AFFILIATE_ID=your_id
 *   Update buildGolfUrl() below to wrap accordingly.
 *
 * ─── ANALYTICS ──────────────────────────────────────────────────────────────
 *
 * Every builder accepts a context so analytics events are scoped to placement:
 *   'homepage' | 'package_card' | 'packages_page' | 'itinerary' | 'planner_result'
 *
 * The caller is responsible for firing logEvent() after click; the builder
 * returns the metadata needed for the event payload.
 */

export type OutboundLinkContext =
  | "homepage"
  | "package_card"
  | "packages_page"
  | "itinerary"
  | "planner_result";

export type OutboundLinkCategory = "hotel" | "ticket" | "golf";

export interface BuiltOutboundLink {
  /** Final URL to open in a new tab */
  url: string;
  /** Human-readable provider name (e.g. "Expedia", "Ticketmaster") */
  provider: string;
  category: OutboundLinkCategory;
  /** True when an affiliate parameter is embedded in the URL */
  isAffiliate: boolean;
  /** Affiliate program identifier for reporting (e.g. "expedia_cj") */
  affiliateSource?: string;
  /** Placement context — pass through to analytics */
  context: OutboundLinkContext;
}

// ─── Hotel / Expedia ────────────────────────────────────────────────────────

export interface HotelLinkParams {
  context: OutboundLinkContext;
  packageId?: string;
  /** e.g. "Austin, TX" or "Nashville" */
  destination: string;
  /** YYYY-MM-DD check-in */
  checkIn?: string;
  /** YYYY-MM-DD check-out */
  checkOut?: string;
  adults?: number;
  /**
   * Package-level hotel URL override stored in packages.hotel_url.
   * When present this takes precedence over a generated Expedia search link.
   */
  overrideUrl?: string | null;
}

export function buildHotelUrl(params: HotelLinkParams): BuiltOutboundLink {
  // Package-level override wins (e.g. a specific hotel property link)
  if (params.overrideUrl) {
    return {
      url: params.overrideUrl,
      provider: inferHotelProvider(params.overrideUrl),
      category: "hotel",
      isAffiliate: false,
      context: params.context,
    };
  }

  const searchUrl = buildExpediaSearchUrl(
    params.destination,
    params.checkIn,
    params.checkOut,
    params.adults ?? 2
  );

  // ── Affiliate wrapping ──────────────────────────────────────────────────
  // Read config from Vite env vars (set in .env.local — never commit)
  const affiliateType = (import.meta.env.VITE_EXPEDIA_AFFILIATE_TYPE as string | undefined) ?? "";
  const affiliateBase = (import.meta.env.VITE_EXPEDIA_AFFILIATE_BASE as string | undefined) ?? "";
  const affiliateParams = (import.meta.env.VITE_EXPEDIA_AFFILIATE_PARAMS as string | undefined) ?? "";

  // Option B — CJ Affiliate: wrap destination URL
  // Set VITE_EXPEDIA_AFFILIATE_TYPE=cj
  //     VITE_EXPEDIA_AFFILIATE_BASE=https://www.tkqlhce.com/click-XXXX-XXXX
  if (affiliateType === "cj" && affiliateBase) {
    return {
      url: `${affiliateBase}?url=${encodeURIComponent(searchUrl)}`,
      provider: "Expedia",
      category: "hotel",
      isAffiliate: true,
      affiliateSource: "expedia_cj",
      context: params.context,
    };
  }

  // Option A — Expedia direct affiliate: append AFFCID/AFFLID params
  // Set VITE_EXPEDIA_AFFILIATE_TYPE=direct
  //     VITE_EXPEDIA_AFFILIATE_PARAMS=AFFCID=US.PARTNER.XXX&AFFLID=XXXXXXXX
  if (affiliateType === "direct" && affiliateParams) {
    const separator = searchUrl.includes("?") ? "&" : "?";
    return {
      url: `${searchUrl}${separator}${affiliateParams}`,
      provider: "Expedia",
      category: "hotel",
      isAffiliate: true,
      affiliateSource: "expedia_direct",
      context: params.context,
    };
  }

  // Option C — Expedia Travel Creator (no deep-link; use generic landing page)
  // Set VITE_EXPEDIA_AFFILIATE_TYPE=creator
  //     VITE_EXPEDIA_AFFILIATE_BASE=https://www.expedia.com/your-creator-link
  if (affiliateType === "creator" && affiliateBase) {
    return {
      url: affiliateBase,
      provider: "Expedia",
      category: "hotel",
      isAffiliate: true,
      affiliateSource: "expedia_creator",
      context: params.context,
    };
  }

  // No affiliate configured — plain Expedia search (still useful, just untracked)
  return {
    url: searchUrl,
    provider: "Expedia",
    category: "hotel",
    isAffiliate: false,
    context: params.context,
  };
}

/** Builds an Expedia Hotel-Search URL with destination and optional dates. */
function buildExpediaSearchUrl(
  destination: string,
  checkIn?: string,
  checkOut?: string,
  adults = 2
): string {
  const params = new URLSearchParams({ destination });
  if (checkIn) params.set("startDate", checkIn);
  if (checkOut) params.set("endDate", checkOut);
  params.set("adults", String(adults));
  return `https://www.expedia.com/Hotel-Search?${params.toString()}`;
}

function inferHotelProvider(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("expedia.com")) return "Expedia";
  if (u.includes("hotels.com")) return "Hotels.com";
  if (u.includes("booking.com")) return "Booking.com";
  if (u.includes("marriott.com")) return "Marriott";
  if (u.includes("hilton.com")) return "Hilton";
  return "Hotel";
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export interface TicketLinkParams {
  context: OutboundLinkContext;
  packageId?: string;
  /** Confirmed direct event URL (e.g. ticketmaster.com/event/...) */
  url: string;
  provider?: string;
}

export function buildTicketUrl(params: TicketLinkParams): BuiltOutboundLink {
  // ── Future affiliate hook ───────────────────────────────────────────────
  // When a Ticketmaster affiliate relationship is established:
  //   const affiliateId = import.meta.env.VITE_TICKETMASTER_AFFILIATE_ID;
  //   if (affiliateId) {
  //     return { url: `${params.url}?wt.mc_id=${affiliateId}`, isAffiliate: true, ... };
  //   }
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

// ─── Golf ───────────────────────────────────────────────────────────────────

export interface GolfLinkParams {
  context: OutboundLinkContext;
  packageId?: string;
  /** Course booking URL from the database */
  url: string;
  provider?: string;
}

export function buildGolfUrl(params: GolfLinkParams): BuiltOutboundLink {
  // ── Future affiliate hook ───────────────────────────────────────────────
  // When a GolfNow affiliate relationship is established:
  //   const affiliateId = import.meta.env.VITE_GOLFNOW_AFFILIATE_ID;
  //   if (affiliateId && params.url.includes("golfnow.com")) {
  //     return { url: `${params.url}?affiliateid=${affiliateId}`, isAffiliate: true, ... };
  //   }
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
