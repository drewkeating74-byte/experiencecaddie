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
  Clock,
  Building2,
} from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  ticketmaster: "Ticketmaster",
  google_places: "Google Places",
  "Google Hotels": "Google Hotels",
  "Google": "Google",
};

const PUBLIC_ACCESS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  likely_public: { label: "Likely public", variant: "default" },
  unknown: { label: "Access unclear", variant: "secondary" },
  likely_private: { label: "Possibly private", variant: "outline" },
};

function humanizeProvider(provider?: string): string | null {
  if (!provider) return null;
  if (provider === "mock") return import.meta.env.DEV ? "Sample data" : null;
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFreshness(asOf?: string, generatedAt?: string): string {
  const ts = asOf || generatedAt;
  if (!ts) return "Built recently";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return "Built today";
  if (diffHours < 24) return "Built recently";
  return `Data as of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
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

  const hasRow1 = drive_time_minutes != null || distance_miles != null || public_access_confidence || humanizeProvider(provider);

  return (
    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
      {hasRow1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {drive_time_minutes != null && (
            <span className="inline-flex items-center gap-1" title="Drive time from search center">
              <Car className="h-3.5 w-3 shrink-0" />
              {drive_time_minutes} min
            </span>
          )}
          {distance_miles != null && (
            <span className="inline-flex items-center gap-1" title="Distance from search center">
              <MapPin className="h-3.5 w-3 shrink-0" />
              {distance_miles} mi
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
                {humanizeProvider(provider)}
              </Badge>
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
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
        <span className="inline-flex items-center gap-1" title="Data freshness">
          <Clock className="h-3.5 w-3 shrink-0" />
          {formatFreshness(as_of, generatedAt)}
        </span>
      </div>
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {displayProvider && (
          <span className="inline-flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
              {displayProvider}
            </Badge>
          </span>
        )}
        <span className="inline-flex items-center gap-1" title="Data freshness">
          <Clock className="h-3.5 w-3 shrink-0" />
          {formatFreshness(undefined, generatedAt)}
        </span>
      </div>
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
