/**
 * Trust panel components for event and golf result cards.
 * Displays provenance, feasibility, and freshness to build user confidence.
 */
import { Badge } from "@/components/ui/badge";
import {
  Car,
  MapPin,
  Map,
  ExternalLink,
  Shield,
  Calendar,
  Building2,
} from "lucide-react";

// Google Places API ToS requires displaying "Powered by Google" attribution
// alongside any results that include data sourced from the Places API.
// https://cloud.google.com/maps-platform/terms — Section 3.2.3
function PoweredByGoogle() {
  return (
    <a
      href="https://www.google.com/maps"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
      aria-label="Powered by Google Maps"
    >
      <svg viewBox="0 0 60 20" className="h-3 w-auto" aria-hidden="true" fill="none">
        <text x="0" y="15" fontFamily="Arial,sans-serif" fontSize="12" fontWeight="bold">
          <tspan fill="#4285F4">G</tspan><tspan fill="#EA4335">o</tspan><tspan fill="#FBBC05">o</tspan><tspan fill="#4285F4">g</tspan><tspan fill="#34A853">l</tspan><tspan fill="#EA4335">e</tspan>
        </text>
      </svg>
      <span>Maps</span>
    </a>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  ticketmaster: "Ticketmaster",
  google_places: "Google Places",
  "Google Hotels": "Google Hotels",
  "Google Maps": "Google Maps",
  "Google": "Google",
  "Booking.com": "Booking.com",
  "Expedia": "Expedia",
  "Hotels.com": "Hotels.com",
};

const PUBLIC_ACCESS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  likely_public: { label: "Open to the public", variant: "default" },
  unknown: { label: "Public access unclear", variant: "secondary" },
  likely_private: { label: "May require membership", variant: "outline" },
};

function humanizeProvider(provider?: string): string | null {
  if (!provider) return null;
  if (provider === "mock") return import.meta.env.DEV ? "Sample data" : null;
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCheckedDate(iso?: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return null;
  }
}

export function GolfTrustPanel({
  drive_time_minutes,
  distance_miles,
  public_access_confidence,
  provider,
  source_url,
  maps_url,
  as_of,
  generatedAt,
  placeId,
  lat,
  lng,
}: {
  drive_time_minutes?: number;
  distance_miles?: number;
  public_access_confidence?: "likely_public" | "unknown" | "likely_private";
  provider?: string;
  source_url?: string;
  maps_url?: string;
  as_of?: string;
  generatedAt?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}) {
  const mapUrl =
    maps_url
      ? maps_url
      : placeId?.replace(/^places\//, "").startsWith("ChIJ")
        ? `https://www.google.com/maps/search/?api=1&query_place_id=${placeId.replace(/^places\//, "")}`
        : lat != null && lng != null
          ? `https://www.google.com/maps?q=${lat},${lng}`
          : undefined;

  const checkedDate = formatCheckedDate(as_of ?? generatedAt);
  const hasRow1 = drive_time_minutes != null || distance_miles != null || public_access_confidence || humanizeProvider(provider) || checkedDate;

  return (
    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
      {hasRow1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {drive_time_minutes != null && (
            <span className="inline-flex items-center gap-1" title="Drive time from venue area">
              <Car className="h-3.5 w-3 shrink-0" />
              About {drive_time_minutes} min from venue
            </span>
          )}
          {distance_miles != null && (
            <span className="inline-flex items-center gap-1" title="Distance from venue area">
              <MapPin className="h-3.5 w-3 shrink-0" />
              ~{distance_miles} mi away
            </span>
          )}
          {public_access_confidence && (
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3 shrink-0" />
              <Badge variant={PUBLIC_ACCESS_LABELS[public_access_confidence]?.variant ?? "secondary"} className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {PUBLIC_ACCESS_LABELS[public_access_confidence]?.label ?? public_access_confidence.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </Badge>
            </span>
          )}
          {humanizeProvider(provider) && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3 shrink-0" />
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                via {humanizeProvider(provider)}
              </Badge>
            </span>
          )}
          {checkedDate && (
            <span className="inline-flex items-center gap-1" title="When this data was last fetched">
              <Calendar className="h-3.5 w-3 shrink-0" />
              Checked {checkedDate}
            </span>
          )}
        </div>
      )}
      {mapUrl && (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <Map className="h-3.5 w-3 shrink-0" />
          Open in Google Maps
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {provider === "google_places" && <PoweredByGoogle />}
    </div>
  );
}

export function HotelTrustPanel({
  provider,
  generatedAt,
  dataProvider,
}: {
  provider?: string;
  generatedAt?: string;
  /** The data source for hotel discovery (e.g. "google_places"). Separate from the
   *  booking provider — hotels are discovered via Google Places but booked via Booking.com. */
  dataProvider?: string;
}) {
  const displayProvider = humanizeProvider(provider);
  const checkedDate = formatCheckedDate(generatedAt);
  const isGooglePlacesData = dataProvider === "google_places";

  if (!displayProvider && !checkedDate && !isGooglePlacesData) return null;

  return (
    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {displayProvider && (
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3 shrink-0" />
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
              via {displayProvider}
            </Badge>
          </span>
        )}
        {checkedDate && (
          <span className="inline-flex items-center gap-1" title="When this data was last fetched">
            <Calendar className="h-3.5 w-3 shrink-0" />
            Checked {checkedDate}
          </span>
        )}
      </div>
      {isGooglePlacesData && <PoweredByGoogle />}
    </div>
  );
}

export function EventTrustPanel({
  venue,
  date_time,
  provider,
  generatedAt,
}: {
  venue?: { name?: string; city?: string; state?: string };
  date_time?: string;
  provider?: string;
  generatedAt?: string;
}) {
  const venueStr = venue
    ? [venue.name, venue.city, venue.state].filter(Boolean).join(", ")
    : null;

  const displayProvider = humanizeProvider(provider);
  const checkedDate = formatCheckedDate(generatedAt);

  return (
    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
      {(venueStr || date_time) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {venueStr && (
            <span className="inline-flex items-center gap-1" title="Venue">
              <Building2 className="h-3.5 w-3 shrink-0" />
              {venueStr}
            </span>
          )}
          {date_time && (
            <span className="inline-flex items-center gap-1" title="Date & time">
              <Calendar className="h-3.5 w-3 shrink-0" />
              {formatEventDateTime(date_time)}
            </span>
          )}
        </div>
      )}
      {(displayProvider || checkedDate) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {displayProvider && (
            <span className="inline-flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                via {displayProvider}
              </Badge>
            </span>
          )}
          {checkedDate && (
            <span className="inline-flex items-center gap-1" title="When this data was last fetched">
              <Calendar className="h-3.5 w-3 shrink-0" />
              Checked {checkedDate}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatEventDateTime(dateTime: string): string {
  try {
    const d = new Date(dateTime);
    if (isNaN(d.getTime())) return dateTime;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateTime;
  }
}
