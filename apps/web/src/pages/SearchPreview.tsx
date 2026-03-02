import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
                <div key={event.id} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{event.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {event.venue?.name} · {event.date_time}
                    </p>
                    {event.venue?.capacity && (
                      <p className="text-xs text-muted-foreground">Capacity: {event.venue.capacity}</p>
                    )}
                  </div>
                  {event.book_url && (
                    <Button asChild size="sm" variant="outline">
                      <a href={event.book_url} target="_blank" rel="noreferrer">
                        Tickets
                      </a>
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Golf</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.golf_courses.map((course) => (
                <div key={course.id} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{course.name}</p>
                    {course.tee_time_window && (
                      <p className="text-sm text-muted-foreground">
                        Tee window: {course.tee_time_window.start}–{course.tee_time_window.end}
                      </p>
                    )}
                    {course.public_access != null && (
                      <p className="text-xs text-muted-foreground">
                        Public access: {course.public_access ? "Yes" : "No"}
                      </p>
                    )}
                  </div>
                  {course.book_url && (
                    <Button asChild size="sm" variant="outline">
                      <a href={course.book_url} target="_blank" rel="noreferrer">
                        Tee times
                      </a>
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Hotels</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.hotels.map((hotel) => (
                <div key={hotel.id} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{hotel.name}</p>
                    {hotel.stars && <p className="text-sm text-muted-foreground">{hotel.stars} stars</p>}
                  </div>
                  {hotel.book_url && (
                    <Button asChild size="sm" variant="outline">
                      <a href={hotel.book_url} target="_blank" rel="noreferrer">
                        Book
                      </a>
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
