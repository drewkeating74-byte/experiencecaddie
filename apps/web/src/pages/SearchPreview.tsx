import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GolfTrustPanel, EventTrustPanel } from "@/components/TrustPanel";
import { normalizeOutboundLink } from "@/types/outbound-link";
import {
  buildHotelUrl,
  buildTicketUrl,
  buildGolfUrl,
  getHotelOutboundCtaLabel,
  getTicketOutboundCtaLabel,
  getGolfOutboundCtaLabel,
} from "@/lib/outboundLinks";
import { logEvent } from "@/lib/analytics";
import { fetchSearch, type SearchResponse } from "@/lib/api/search";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const today = new Date();
const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const toDate = (d: Date) => d.toISOString().split("T")[0];

export default function SearchPreview() {
  const [city, setCity] = useState("Austin");
  const [startDate, setStartDate] = useState(toDate(today));
  const [endDate, setEndDate] = useState(toDate(inTwoDays));
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SearchResponse | null>(null);

  const handleSearch = async () => {
    if (!city.trim()) {
      toast.error("Enter a city");
      return;
    }
    setLoading(true);
    try {
      const result = await fetchSearch({
        destination: { city: city.trim() },
        dates: { start_date: startDate, end_date: endDate },
      });
      setData(result);
    } catch (err: any) {
      toast.error(err?.message || "Search failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10 space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold">API Search Preview</h1>
        <p className="text-muted-foreground">Hits `/api/search` and renders snake_case responses.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Search inputs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="start-date">Start date</Label>
            <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="end-date">End date</Label>
            <Input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Button onClick={handleSearch} disabled={loading} className="rounded-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run search"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.events.map((event) => (
                <div key={event.id} className="rounded-lg border border-border/50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{event.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {event.venue?.name}
                        {event.venue?.city && ` · ${event.venue.city}${event.venue?.state ? `, ${event.venue.state}` : ""}`}
                      </p>
                      {event.venue?.capacity && (
                        <p className="text-xs text-muted-foreground">Capacity: {event.venue.capacity}</p>
                      )}
                    </div>
                    {(event.book_url || event.book_link?.url) && (() => {
                      const raw = normalizeOutboundLink(event.book_link || event.book_url, "concert");
                      const t = buildTicketUrl({
                        context: "planner_result",
                        url: raw.url,
                        provider: raw.provider,
                      });
                      return (
                        <Button asChild size="sm" variant="outline" className="shrink-0">
                          <a
                            href={t.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() =>
                              logEvent({
                                event_type: "ticket_link_clicked",
                                context: "planner_result",
                                extra: {
                                  category: "ticket",
                                  provider: t.provider,
                                  city: city,
                                  label: getTicketOutboundCtaLabel(t.provider),
                                },
                              })
                            }
                          >
                            {getTicketOutboundCtaLabel(t.provider)}
                          </a>
                        </Button>
                      );
                    })()}
                  </div>
                  <EventTrustPanel
                    venue={event.venue}
                    date_time={event.date_time}
                    provider={event.provider}
                    generatedAt={data.meta?.generated_at}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Golf</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.golf_courses.map((course) => {
                if (!course.book_link?.url && !course.book_url) return null;
                const link = normalizeOutboundLink(course.book_link || course.book_url, "golf");
                return (
                <div key={course.id} className="rounded-lg border border-border/50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{course.name}</p>
                      {(course.city || course.state) && (
                        <p className="text-sm text-muted-foreground">
                          {[course.city, course.state].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {course.tee_time_window && (
                        <p className="text-xs text-muted-foreground">
                          Tee window: {course.tee_time_window.start}–{course.tee_time_window.end}
                        </p>
                      )}
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0">
                      <a href={link.url} target="_blank" rel="noreferrer">
                        {getOutboundLinkDisplayLabel(link)}
                      </a>
                    </Button>
                  </div>
                  <GolfTrustPanel
                    drive_time_minutes={course.drive_time_minutes}
                    distance_miles={course.distance_miles}
                    public_access_confidence={course.public_access_confidence}
                    provider={course.provider}
                    source_url={course.source_url}
                    maps_url={course.google_maps_uri}
                    as_of={course.as_of}
                    generatedAt={data.meta?.generated_at}
                    placeId={course.id}
                    lat={course.lat}
                    lng={course.lng}
                  />
                </div>
              );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Hotels</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.hotels.map((hotel) => {
                if (!hotel.book_link?.url && !hotel.book_url) return null;
                const rawUrl =
                  (typeof hotel.book_url === "string" && hotel.book_url.trim()
                    ? hotel.book_url.trim()
                    : typeof hotel.book_link?.url === "string"
                      ? hotel.book_link.url.trim()
                      : "") || null;
                const destination =
                  [hotel.name, city].filter(Boolean).join(" ").trim() || city || "hotels";
                const b = buildHotelUrl({
                  context: "planner_result",
                  destination,
                  checkIn: startDate,
                  checkOut: endDate,
                  overrideUrl: rawUrl,
                });
                const h = { url: b.url, provider: b.provider, hotelLinkSource: b.hotelLinkSource ?? "google_hotels" };
                const cta = getHotelOutboundCtaLabel(h.hotelLinkSource, city);
                return (
                  <div key={hotel.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{hotel.name}</p>
                      {hotel.stars && <p className="text-sm text-muted-foreground">{hotel.stars} stars</p>}
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0">
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          logEvent({
                            event_type: "hotel_link_clicked",
                            context: "planner_result",
                            extra: {
                              category: "hotel",
                              provider: h.provider,
                              city,
                              hotel_link_source: h.hotelLinkSource ?? "override",
                              label: cta,
                            },
                          })
                        }
                      >
                        {cta}
                      </a>
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
