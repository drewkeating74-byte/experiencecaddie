/**
 * Outbound link model for trust-first booking URLs.
 * Used for concerts, hotels, and golf across search results and itineraries.
 */

export type OutboundLinkCategory = "concert" | "hotel" | "golf";

export type OutboundLinkType =
  | "direct_event"
  | "direct_listing"
  | "provider_search"
  | "affiliate_redirect"
  | "manual_fallback";

export type OutboundLinkConfidence = "high" | "medium" | "low";

export type OutboundLink = {
  url: string;
  provider: string;
  category: OutboundLinkCategory;
  link_type: OutboundLinkType;
  label: string;
  is_verified: boolean;
  confidence: OutboundLinkConfidence;
  source_name?: string;
  fetched_at?: string;
  disclaimer?: string;
};

/** Input: either a plain string URL (legacy) or an existing OutboundLink object. */
export type OutboundLinkInput = string | Partial<OutboundLink> | null | undefined;

function inferProviderFromUrl(url: string, category: OutboundLinkCategory): string {
  const u = url.toLowerCase();
  if (u.includes("google.com/search") && category === "concert") return "Google";
  if (u.includes("google.com/travel/hotels")) return "Google Hotels";
  if (u.includes("ticketmaster.com")) return "Ticketmaster";
  if (u.includes("livenation.com")) return "Live Nation";
  if (u.includes("seatgeek.com")) return "SeatGeek";
  if (u.includes("stubhub.com")) return "StubHub";
  if (u.includes("booking.com")) return "Booking.com";
  if (u.includes("expedia.com")) return "Expedia";
  if (u.includes("hotels.com")) return "Hotels.com";
  if (u.includes("golfnow.com")) return "GolfNow";
  if (u.includes("teeoff.com")) return "TeeOff";
  if (u.includes("google.com/maps") || u.includes("maps.google")) return "Google Maps";
  return "External";
}

function inferLinkTypeFromUrl(url: string, category: OutboundLinkCategory): OutboundLinkType {
  const u = url.toLowerCase();
  if (u.includes("searchresults") || u.includes("google.com/travel/hotels") || (u.includes("google.com/search") && u.includes("q=")) || (u.includes("/search") && (u.includes("q=") || u.includes("ss=")))) return "provider_search";
  if (u.includes("/event/") || u.includes("-tickets/")) return "direct_event";
  if (u.includes("/hotel/") && (u.includes("booking.com") || u.includes("expedia.com") || u.includes("hotels.com"))) return "direct_listing";
  if (category === "golf") {
    if (u.includes("golfnow.com/search") || u.includes("teeoff.com/search") || (u.includes("/search") && u.includes("golf"))) return "provider_search";
    if (u.includes("google.com/maps") || u.includes("maps.google") || u.includes("place_id")) return "direct_listing";
    if (u.includes("golfnow.com") || u.includes("teeoff.com")) return "direct_listing";
  }
  if (u.includes("awin1.com") || u.includes("affiliate")) return "affiliate_redirect";
  return "manual_fallback";
}

/**
 * Normalizes a raw URL string or partial link object into a full OutboundLink.
 * Handles legacy result_json entries that only store plain string URLs.
 */
export function normalizeOutboundLink(
  input: OutboundLinkInput,
  category: OutboundLinkCategory
): OutboundLink {
  if (input == null || (typeof input === "string" && !input.trim())) {
    return {
      url: category === "concert" ? "https://www.google.com/search?q=concerts+tickets" : category === "hotel" ? "https://www.google.com/travel/hotels?q=hotels" : "https://www.golfnow.com/",
      provider: category === "concert" ? "Google" : category === "hotel" ? "Google Hotels" : "GolfNow",
      category,
      link_type: "manual_fallback",
      label: category === "concert" ? "Search tickets" : category === "hotel" ? "Search hotels" : "Tee times",
      is_verified: false,
      confidence: "low",
    };
  }

  if (typeof input === "string") {
    const url = input.trim();
    const provider = inferProviderFromUrl(url, category);
    const linkType = inferLinkTypeFromUrl(url, category);

    if (category === "concert") {
      const isDirectEvent = linkType === "direct_event";
      const isGoogleSearch = provider === "Google" && linkType === "provider_search";
      const label = isDirectEvent ? "Tickets" : isGoogleSearch ? "Search tickets" : "Find tickets";
      const disclaimer = isDirectEvent
        ? undefined
        : isGoogleSearch
        ? "Opens ticket search results across multiple vendors; availability is not confirmed in Experience Caddie"
        : linkType === "provider_search"
        ? "Opens Ticketmaster search results for this event"
        : undefined;
      return {
        url,
        provider,
        category: "concert",
        link_type: linkType,
        label,
        is_verified: false,
        confidence: isDirectEvent ? "high" : "medium",
        disclaimer,
      };
    }
    if (category === "hotel") {
      const label = linkType === "provider_search" ? "Search hotels" : "Check rates";
      const disclaimer = linkType === "provider_search"
        ? "Opens hotel search results; availability and rates are not confirmed in Experience Caddie"
        : linkType === "manual_fallback"
        ? "Opens an external hotel options page"
        : undefined;
      return {
        url,
        provider,
        category: "hotel",
        link_type: linkType,
        label,
        is_verified: false,
        confidence: linkType === "provider_search" ? "medium" : linkType === "direct_listing" ? "low" : "low",
        disclaimer,
      };
    }
    if (category === "golf") {
      const label =
        linkType === "provider_search"
          ? "Search tee times"
          : linkType === "manual_fallback"
          ? "View options"
          : "Tee times";
      const disclaimer =
        linkType === "provider_search"
          ? "Opens external golf search results; tee time availability is not confirmed in Experience Caddie"
          : linkType === "manual_fallback"
          ? "Opens an external golf options page"
          : undefined;
      return {
        url,
        provider,
        category: "golf",
        link_type: linkType,
        label,
        is_verified: false,
        confidence: linkType === "provider_search" ? "medium" : linkType === "direct_listing" ? "medium" : "low",
        disclaimer,
      };
    }
  }

  const partial = input as Partial<OutboundLink>;
  const categoryResolved = partial.category ?? category;
  const fallbackUrl =
    categoryResolved === "concert" ? "https://www.google.com/search?q=concerts+tickets"
    : categoryResolved === "hotel" ? "https://www.google.com/travel/hotels?q=hotels"
    : "https://www.golfnow.com/";
  const url = (typeof partial.url === "string" ? partial.url : "").trim() || fallbackUrl;

  return {
    url,
    provider: partial.provider ?? inferProviderFromUrl(url, categoryResolved),
    category: categoryResolved,
    link_type: partial.link_type ?? inferLinkTypeFromUrl(url, categoryResolved),
    label: partial.label ?? (categoryResolved === "concert" ? "Search tickets" : categoryResolved === "hotel" ? "Search hotels" : categoryResolved === "golf" ? "Tee times" : "View options"),
    is_verified: partial.is_verified ?? false,
    confidence: partial.confidence ?? "medium",
    source_name: partial.source_name,
    fetched_at: partial.fetched_at,
    disclaimer: partial.disclaimer,
  };
}
