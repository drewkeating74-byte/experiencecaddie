import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import type { Booking } from "@/types/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, Music } from "lucide-react";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export default function Bookings() {
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth?redirect=/bookings"); return; }

    db
      .from("bookings")
      .select("*, packages(*, events(*, artists(*), venues(*)), golf_courses(*), destinations(*))")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setBookings(data as unknown as Booking[]);
        setLoading(false);
      });
  }, [user, authLoading, navigate]);

  const cancelBooking = async (id: string) => {
    const { error } = await db.from("bookings").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error("Failed to cancel");
    else {
      toast.success("Booking cancelled");
      setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status: "cancelled" } : b));
    }
  };

  if (authLoading || loading) return <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="font-serif text-3xl font-bold">My Bookings</h1>
      <p className="mt-1 text-muted-foreground">Your concert + golf reservations</p>

      {bookings.length > 0 ? (
        <div className="mt-8 space-y-4">
          {bookings.map((booking) => {
            const pkg = booking.packages;
            const event = pkg?.events;
            return (
              <Card key={booking.id}>
                <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1 space-y-1">
                    <h3 className="font-serif text-lg font-semibold">{pkg?.name || "Package"}</h3>
                    {event?.artists && <p className="flex items-center gap-1 text-sm text-muted-foreground"><Music className="h-3.5 w-3.5" />{event.artists.name}</p>}
                    {booking.event_date && <p className="flex items-center gap-1 text-sm text-muted-foreground"><Calendar className="h-3.5 w-3.5" />{new Date(booking.event_date).toLocaleDateString()}</p>}
                    <p className="text-sm text-muted-foreground">Booked: {new Date(booking.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold text-lg">${booking.total_price}</p>
                      <p className="text-xs text-muted-foreground">{booking.guests} guest(s)</p>
                    </div>
                    <Badge className={statusColors[booking.status] || ""}>{booking.status}</Badge>
                    {booking.status === "pending" && (
                      <Button variant="outline" size="sm" onClick={() => cancelBooking(booking.id)}>Cancel</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="mt-12 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 font-serif text-xl font-semibold">No Bookings Yet</h3>
          <p className="mt-2 text-muted-foreground">Browse packages and book your first getaway!</p>
          <Button onClick={() => navigate("/packages")} className="mt-4 rounded-full">Browse Packages</Button>
        </div>
      )}
    </div>
  );
}
