import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import type { Event } from "@/types/database";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Music, MapPin, Calendar, Search, ExternalLink } from "lucide-react";

export default function Events() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    db
      .from("events")
      .select("*, artists(*), venues(*)")
      .gte("event_date", new Date().toISOString().split("T")[0])
      .order("event_date", { ascending: true })
      .then(({ data }) => {
        if (data) setEvents(data as unknown as Event[]);
        setLoading(false);
      });
  }, []);

  const filtered = events.filter((e) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return e.name.toLowerCase().includes(s) || e.artists?.name?.toLowerCase().includes(s) || e.venues?.name?.toLowerCase().includes(s);
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="font-serif text-3xl font-bold">Upcoming Concerts</h1>
      <p className="mt-1 text-muted-foreground">Live music events for your next trip</p>

      <div className="relative mt-6 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by artist or venue..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="mt-12 text-center text-muted-foreground">Loading events...</div>
      ) : filtered.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((event) => (
            <Card key={event.id} className="group overflow-hidden border-border/50 transition-all hover:shadow-lg">
              <div className="relative aspect-[16/10] overflow-hidden">
                <img src={event.image_url || "/placeholder.svg"} alt={event.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                {event.availability_status && (
                  <Badge className="absolute right-3 top-3" variant={event.availability_status === "available" ? "default" : "secondary"}>
                    {event.availability_status}
                  </Badge>
                )}
              </div>
              <CardContent className="p-4">
                <h3 className="font-serif text-lg font-semibold">{event.name}</h3>
                {event.artists && <p className="mt-1 flex items-center gap-1 text-sm text-accent font-medium"><Music className="h-3.5 w-3.5" />{event.artists.name}</p>}
                {event.venues && <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{event.venues.name}{event.venues.city ? `, ${event.venues.city}` : ""}</p>}
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                {(event.min_price || event.max_price) && (
                  <p className="mt-2 font-semibold">${event.min_price}{event.max_price ? ` – $${event.max_price}` : ""}</p>
                )}
                {event.ticket_url && (
                  <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Get Tickets <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-12 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Music className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 font-serif text-xl font-semibold">No Events Yet</h3>
          <p className="mt-2 text-muted-foreground">Concert listings coming soon!</p>
        </div>
      )}
    </div>
  );
}
