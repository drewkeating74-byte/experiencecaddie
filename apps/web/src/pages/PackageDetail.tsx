import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Package } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Music, MapPin, Calendar, Clock, Car, Users, ArrowLeft, ExternalLink } from "lucide-react";
import { DEFAULT_PACKAGE_IMAGE } from "@/lib/constants";
import { toast } from "sonner";
import {
  buildHotelUrl,
  buildTicketUrl,
  buildGolfUrl,
  getHotelOutboundCtaLabel,
  getHotelOutboundHelperText,
  getTicketOutboundCtaLabel,
  getGolfOutboundCtaLabel,
} from "@/lib/outboundLinks";
import { logEvent } from "@/lib/analytics";

export default function PackageDetail() {
  const { id } = useParams<{ id: string }>();
  const [pkg, setPkg] = useState<Package | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    supabase
      .from("packages")
      .select("*, events(*, artists(*), venues(*)), golf_courses(*), destinations(*)")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (data) setPkg(data as unknown as Package);
        if (error) toast.error("Package not found");
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">Loading...</div>;
  if (!pkg) return <div className="container mx-auto px-4 py-16 text-center">Package not found</div>;

  const event = pkg.events;
  const course = pkg.golf_courses;
  const destination = pkg.destinations;
  const cityLabel = destination?.city || destination?.name || "";
  const checkIn = event?.event_date ? String(event.event_date).slice(0, 10) : undefined;
  const checkOut = checkIn
    ? (() => {
        const d = new Date(checkIn + "T12:00:00");
        d.setDate(d.getDate() + 2);
        return d.toISOString().slice(0, 10);
      })()
    : undefined;

  const hotelBuilt =
    cityLabel || (pkg as { hotel_url?: string | null }).hotel_url
      ? buildHotelUrl({
          context: "package_card",
          packageId: pkg.id,
          destination: cityLabel || "hotels",
          checkIn,
          checkOut,
          overrideUrl: (pkg as { hotel_url?: string | null }).hotel_url ?? null,
        })
      : null;

  const hotelHelperText =
    hotelBuilt &&
    getHotelOutboundHelperText({
      hotelLinkSource: hotelBuilt.hotelLinkSource,
      cityDisplay: cityLabel,
      checkIn,
      checkOut,
    });

  return (
    <div className="container mx-auto px-4 py-8">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          <div className="overflow-hidden rounded-lg">
            <img
              src={pkg.image_url || event?.image_url || DEFAULT_PACKAGE_IMAGE}
              alt={pkg.name}
              className="aspect-[16/9] w-full object-cover"
            />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{pkg.category}</Badge>
              {destination && <Badge variant="outline"><MapPin className="mr-1 h-3 w-3" />{destination.name}</Badge>}
            </div>
            <h1 className="mt-3 font-serif text-3xl font-bold md:text-4xl">{pkg.name}</h1>
            {pkg.description && <p className="mt-3 text-muted-foreground leading-relaxed">{pkg.description}</p>}
          </div>

          {/* Concert details */}
          {event && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-serif">
                  <Music className="h-5 w-5 text-accent" /> Concert Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Event</span>
                  <span className="font-medium">{event.name}</span>
                </div>
                {event.artists && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Artist</span>
                    <span className="font-medium">{event.artists.name}</span>
                  </div>
                )}
                {event.venues && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Venue</span>
                    <span className="font-medium">{event.venues.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(event.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                {event.event_time && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time</span>
                    <span className="font-medium flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{event.event_time}</span>
                  </div>
                )}
                {event.ticket_url && (() => {
                  const t = buildTicketUrl({
                    context: "package_card",
                    packageId: pkg.id,
                    url: event.ticket_url,
                  });
                  return (
                    <div className="mt-2 space-y-1">
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        onClick={() =>
                          logEvent({
                            event_type: "ticket_link_clicked",
                            package_id: pkg.id,
                            artist_name: event.artists?.name ?? event.name ?? undefined,
                            metro_slug: cityLabel
                              ? cityLabel.toLowerCase().replace(/[\s,]+/g, "-")
                              : undefined,
                            context: "package_card",
                            extra: {
                              category: "ticket",
                              provider: t.provider,
                              city: cityLabel || undefined,
                              event_date: event.event_date
                                ? String(event.event_date).slice(0, 10)
                                : undefined,
                            },
                          })
                        }
                      >
                        {getTicketOutboundCtaLabel(t.provider)} <ExternalLink className="h-3 w-3" />
                      </a>
                      <p className="text-xs text-muted-foreground">Opens the ticket provider in a new tab.</p>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Golf details */}
          {course && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-serif">
                  ⛳ Golf Course
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Course</span>
                  <span className="font-medium">{course.name}</span>
                </div>
                {course.holes && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Holes</span>
                    <span className="font-medium">{course.holes}</span>
                  </div>
                )}
                {(course.green_fee_min || course.green_fee_max) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Green Fees</span>
                    <span className="font-medium">
                      ${course.green_fee_min}{course.green_fee_max ? ` – $${course.green_fee_max}` : ""}
                    </span>
                  </div>
                )}
                {course.rating && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rating / Slope</span>
                    <span className="font-medium">{course.rating}{course.slope ? ` / ${course.slope}` : ""}</span>
                  </div>
                )}
                {course.guest_policy && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Guest Policy</span>
                    <span className="font-medium">{course.guest_policy}</span>
                  </div>
                )}
                {course.booking_url && (() => {
                  const g = buildGolfUrl({
                    context: "package_card",
                    packageId: pkg.id,
                    url: course.booking_url,
                  });
                  return (
                    <div className="mt-2 space-y-1">
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        onClick={() =>
                          logEvent({
                            event_type: "golf_link_clicked",
                            package_id: pkg.id,
                            artist_name: event?.artists?.name ?? event?.name ?? undefined,
                            metro_slug: cityLabel
                              ? cityLabel.toLowerCase().replace(/[\s,]+/g, "-")
                              : undefined,
                            context: "package_card",
                            extra: {
                              category: "golf",
                              provider: g.provider,
                              city: cityLabel || undefined,
                              event_date: event?.event_date
                                ? String(event.event_date).slice(0, 10)
                                : undefined,
                            },
                          })
                        }
                      >
                        {getGolfOutboundCtaLabel(g.provider)} <ExternalLink className="h-3 w-3" />
                      </a>
                      <p className="text-xs text-muted-foreground">Opens the golf provider in a new tab.</p>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {hotelBuilt && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-serif">Stay</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(pkg as { hotel_name?: string | null }).hotel_name && (
                  <p className="text-sm font-medium">{(pkg as { hotel_name?: string | null }).hotel_name}</p>
                )}
                <a
                  href={hotelBuilt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  onClick={() =>
                    logEvent({
                      event_type: "hotel_link_clicked",
                      package_id: pkg.id,
                      artist_name: event?.artists?.name ?? event?.name ?? undefined,
                      metro_slug: cityLabel
                        ? cityLabel.toLowerCase().replace(/[\s,]+/g, "-")
                        : undefined,
                      context: "package_card",
                      extra: {
                        category: "hotel",
                        provider: hotelBuilt.provider,
                        city: cityLabel || undefined,
                        event_date: event?.event_date
                          ? String(event.event_date).slice(0, 10)
                          : undefined,
                        hotel_link_source: hotelBuilt.hotelLinkSource,
                      },
                    })
                  }
                >
                  {getHotelOutboundCtaLabel(hotelBuilt.hotelLinkSource, cityLabel)}{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
                {hotelHelperText && (
                  <p className="text-xs text-muted-foreground">{hotelHelperText}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Itinerary */}
          {pkg.itinerary_json && (
            <Card>
              <CardHeader>
                <CardTitle className="font-serif">Sample Itinerary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(Array.isArray(pkg.itinerary_json) ? pkg.itinerary_json as Array<{ title?: string; description?: string }> : []).map((day, i) => (
                    <div key={i}>
                      <h4 className="font-semibold">{day.title || `Day ${i + 1}`}</h4>
                      <p className="text-sm text-muted-foreground">{day.description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar - Booking */}
        <div className="lg:col-span-1">
          <Card className="sticky top-20 border-primary/20">
            <CardContent className="p-6 space-y-4">
              <div className="text-center">
                <div className="flex items-baseline justify-center gap-2">
                  <span className="font-serif text-3xl font-bold">${pkg.price}</span>
                  {pkg.original_price && pkg.original_price > pkg.price && (
                    <span className="text-lg text-muted-foreground line-through">${pkg.original_price}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">per person</p>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                {event?.event_date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                )}
                {destination && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{destination.city || destination.name}</span>
                  </div>
                )}
                {pkg.drive_time_minutes && (
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    <span>{pkg.drive_time_minutes} min drive between venues</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
