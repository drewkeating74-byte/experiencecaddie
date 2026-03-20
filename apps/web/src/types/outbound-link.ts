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
  if (u.includes("searchresults") || (u.includes("/search") && (u.includes("q=") || u.includes("ss=")))) return "provider_search";
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
      url: category === "concert" ? "https://www.ticketmaster.com/" : category === "hotel" ? "https://www.booking.com/" : "https://www.golfnow.com/",
      provider: category === "concert" ? "Ticketmaster" : category === "hotel" ? "Booking.com" : "GolfNow",
      category,
      link_type: "manual_fallback",
      label: category === "concert" ? "Find tickets" : category === "hotel" ? "Check rates" : "Tee times",
      is_verified: false,
      confidence: "low",
    };
  }

  if (typeof input === "string") {
    const url = input.trim();
    const provider = inferProviderFromUrl(url, category);
    const linkType = inferLinkTypeFromUrl(url, category);

    if (category === "concert") {
      return {
        url,
        provider,
        category: "concert",
        link_type: linkType,
        label: "Find tickets",
        is_verified: false,
        confidence: linkType === "provider_search" ? "medium" : "medium",
        disclaimer: linkType === "provider_search" ? "Opens Ticketmaster search results for this event" : undefined,
      };
    }
    if (category === "hotel") {
      const label = "Check rates";
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
    categoryResolved === "concert" ? "https://www.ticketmaster.com/"
    : categoryResolved === "hotel" ? "https://www.booking.com/"
    : "https://www.golfnow.com/";
  const url = (typeof partial.url === "string" ? partial.url : "").trim() || fallbackUrl;

  return {
    url,
    provider: partial.provider ?? inferProviderFromUrl(url, categoryResolved),
    category: categoryResolved,
    link_type: partial.link_type ?? inferLinkTypeFromUrl(url, categoryResolved),
    label: partial.label ?? (categoryResolved === "concert" ? "Find tickets" : categoryResolved === "hotel" ? "Check rates" : categoryResolved === "golf" ? "Tee times" : "View options"),
    is_verified: partial.is_verified ?? false,
    confidence: partial.confidence ?? "medium",
    source_name: partial.source_name,
    fetched_at: partial.fetched_at,
    disclaimer: partial.disclaimer,
  };
}
