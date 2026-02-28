import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// Helper to bypass strict typing until auto-generated types update
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Music, MapPin } from "lucide-react";

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      navigate("/");
    }
  }, [user, isAdmin, authLoading, navigate]);

  if (authLoading) return <div className="container mx-auto px-4 py-16 text-center">Loading...</div>;
  if (!isAdmin) return null;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="font-serif text-3xl font-bold">Admin Panel</h1>
      <p className="mt-1 text-muted-foreground">Manage your concert + golf inventory</p>

      <Tabs defaultValue="packages" className="mt-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="artists">Artists</TabsTrigger>
          <TabsTrigger value="venues">Venues</TabsTrigger>
          <TabsTrigger value="destinations">Destinations</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
        </TabsList>

        <TabsContent value="packages"><AdminPackages /></TabsContent>
        <TabsContent value="events"><AdminEvents /></TabsContent>
        <TabsContent value="courses"><AdminCourses /></TabsContent>
        <TabsContent value="artists"><AdminArtists /></TabsContent>
        <TabsContent value="venues"><AdminVenues /></TabsContent>
        <TabsContent value="destinations"><AdminDestinations /></TabsContent>
        <TabsContent value="bookings"><AdminBookings /></TabsContent>
      </Tabs>
    </div>
  );
}

// --- Generic CRUD helpers ---
function useCrud<T extends { id: string }>(table: string, selectQuery = "*") {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await db.from(table).select(selectQuery).order("created_at", { ascending: false });
    if (data) setItems(data as T[]);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const remove = async (id: string) => {
    const { error } = await db.from(table).delete().eq("id", id);
    if (error) toast.error("Delete failed: " + error.message);
    else { toast.success("Deleted"); refresh(); }
  };

  return { items, loading, refresh, remove };
}

// --- Destinations ---
function AdminDestinations() {
  const { items, loading, refresh, remove } = useCrud<any>("destinations");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "", country: "", description: "" });

  const save = async () => {
    const { error } = await db.from("destinations").insert(form);
    if (error) toast.error(error.message);
    else { toast.success("Destination added"); setOpen(false); setForm({ name: "", city: "", state: "", country: "", description: "" }); refresh(); }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Destinations</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Destination</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                <div><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                <div><Label>Country</Label><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
              </div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button onClick={save} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p>Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>City</TableHead><TableHead>State</TableHead><TableHead>Country</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.city}</TableCell>
                  <TableCell>{d.state}</TableCell>
                  <TableCell>{d.country}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => remove(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Artists ---
function AdminArtists() {
  const { items, loading, refresh, remove } = useCrud<any>("artists");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", genre: "", subgenre: "", description: "" });

  const save = async () => {
    const { error } = await db.from("artists").insert(form);
    if (error) toast.error(error.message);
    else { toast.success("Artist added"); setOpen(false); setForm({ name: "", genre: "", subgenre: "", description: "" }); refresh(); }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Artists</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Artist</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Genre</Label><Input value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} /></div>
                <div><Label>Subgenre</Label><Input value={form.subgenre} onChange={(e) => setForm({ ...form, subgenre: e.target.value })} /></div>
              </div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button onClick={save} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p>Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Genre</TableHead><TableHead>Subgenre</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.genre}</TableCell>
                  <TableCell>{a.subgenre}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Venues ---
function AdminVenues() {
  const { items, loading, refresh, remove } = useCrud<any>("venues");
  const [destinations, setDestinations] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "", country: "", address: "", destination_id: "", capacity: "" });

  useEffect(() => {
    db.from("destinations").select("id, name").then(({ data }: any) => { if (data) setDestinations(data); });
  }, []);

  const save = async () => {
    const { error } = await db.from("venues").insert({
      ...form,
      destination_id: form.destination_id || null,
      capacity: form.capacity ? parseInt(form.capacity) : null,
    });
    if (error) toast.error(error.message);
    else { toast.success("Venue added"); setOpen(false); setForm({ name: "", city: "", state: "", country: "", address: "", destination_id: "", capacity: "" }); refresh(); }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Venues</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Venue</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                <div><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                <div><Label>Country</Label><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
              </div>
              <div><Label>Destination</Label>
                <Select value={form.destination_id} onValueChange={(v) => setForm({ ...form, destination_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                  <SelectContent>{destinations.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Capacity</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
              <Button onClick={save} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p>Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>City</TableHead><TableHead>State</TableHead><TableHead>Capacity</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((v: any) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell>{v.city}</TableCell>
                  <TableCell>{v.state}</TableCell>
                  <TableCell>{v.capacity}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => remove(v.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Events ---
function AdminEvents() {
  const { items, loading, refresh, remove } = useCrud<any>("events", "*, artists(name), venues(name)");
  const [artists, setArtists] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", artist_id: "", venue_id: "", event_date: "", event_time: "", description: "", ticket_url: "", min_price: "", max_price: "" });

  useEffect(() => {
    db.from("artists").select("id, name").then(({ data }: any) => { if (data) setArtists(data); });
    db.from("venues").select("id, name").then(({ data }: any) => { if (data) setVenues(data); });
  }, []);

  const save = async () => {
    const { error } = await db.from("events").insert({
      ...form,
      artist_id: form.artist_id || null,
      venue_id: form.venue_id || null,
      min_price: form.min_price ? parseFloat(form.min_price) : null,
      max_price: form.max_price ? parseFloat(form.max_price) : null,
    });
    if (error) toast.error(error.message);
    else { toast.success("Event added"); setOpen(false); setForm({ name: "", artist_id: "", venue_id: "", event_date: "", event_time: "", description: "", ticket_url: "", min_price: "", max_price: "" }); refresh(); }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Events</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Event</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Event Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Artist</Label>
                <Select value={form.artist_id} onValueChange={(v) => setForm({ ...form, artist_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select artist" /></SelectTrigger>
                  <SelectContent>{artists.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Venue</Label>
                <Select value={form.venue_id} onValueChange={(v) => setForm({ ...form, venue_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select venue" /></SelectTrigger>
                  <SelectContent>{venues.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Date</Label><Input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></div>
                <div><Label>Time</Label><Input type="time" value={form.event_time} onChange={(e) => setForm({ ...form, event_time: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Min Price</Label><Input type="number" value={form.min_price} onChange={(e) => setForm({ ...form, min_price: e.target.value })} /></div>
                <div><Label>Max Price</Label><Input type="number" value={form.max_price} onChange={(e) => setForm({ ...form, max_price: e.target.value })} /></div>
              </div>
              <div><Label>Ticket URL</Label><Input value={form.ticket_url} onChange={(e) => setForm({ ...form, ticket_url: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button onClick={save} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p>Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Artist</TableHead><TableHead>Venue</TableHead><TableHead>Date</TableHead><TableHead>Price</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>{e.artists?.name}</TableCell>
                  <TableCell>{e.venues?.name}</TableCell>
                  <TableCell>{e.event_date}</TableCell>
                  <TableCell>{e.min_price ? `$${e.min_price}` : "—"}{e.max_price ? ` – $${e.max_price}` : ""}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => remove(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Golf Courses ---
function AdminCourses() {
  const { items, loading, refresh, remove } = useCrud<any>("golf_courses");
  const [destinations, setDestinations] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "", country: "", address: "", destination_id: "", holes: "18", green_fee_min: "", green_fee_max: "", public_access: true, description: "", booking_url: "" });

  useEffect(() => {
    db.from("destinations").select("id, name").then(({ data }: any) => { if (data) setDestinations(data); });
  }, []);

  const save = async () => {
    const { error } = await db.from("golf_courses").insert({
      ...form,
      destination_id: form.destination_id || null,
      holes: parseInt(form.holes) || 18,
      green_fee_min: form.green_fee_min ? parseFloat(form.green_fee_min) : null,
      green_fee_max: form.green_fee_max ? parseFloat(form.green_fee_max) : null,
    });
    if (error) toast.error(error.message);
    else { toast.success("Course added"); setOpen(false); setForm({ name: "", city: "", state: "", country: "", address: "", destination_id: "", holes: "18", green_fee_min: "", green_fee_max: "", public_access: true, description: "", booking_url: "" }); refresh(); }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Golf Courses</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Golf Course</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                <div><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                <div><Label>Country</Label><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
              </div>
              <div><Label>Destination</Label>
                <Select value={form.destination_id} onValueChange={(v) => setForm({ ...form, destination_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                  <SelectContent>{destinations.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Holes</Label><Input type="number" value={form.holes} onChange={(e) => setForm({ ...form, holes: e.target.value })} /></div>
                <div><Label>Min Fee</Label><Input type="number" value={form.green_fee_min} onChange={(e) => setForm({ ...form, green_fee_min: e.target.value })} /></div>
                <div><Label>Max Fee</Label><Input type="number" value={form.green_fee_max} onChange={(e) => setForm({ ...form, green_fee_max: e.target.value })} /></div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.public_access} onCheckedChange={(v) => setForm({ ...form, public_access: v })} />
                <Label>Public Access</Label>
              </div>
              <div><Label>Booking URL</Label><Input value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button onClick={save} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p>Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>City</TableHead><TableHead>Holes</TableHead><TableHead>Fees</TableHead><TableHead>Public</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.city}, {c.state}</TableCell>
                  <TableCell>{c.holes}</TableCell>
                  <TableCell>{c.green_fee_min ? `$${c.green_fee_min}` : "—"}{c.green_fee_max ? `–$${c.green_fee_max}` : ""}</TableCell>
                  <TableCell>{c.public_access ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Packages ---
function AdminPackages() {
  const { items, loading, refresh, remove } = useCrud<any>("packages", "*, events(name), golf_courses(name), destinations(name)");
  const [events, setEvents] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [destinations, setDestinations] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", event_id: "", golf_course_id: "", destination_id: "", price: "", original_price: "", category: "weekend", featured: false, description: "" });

  useEffect(() => {
    db.from("events").select("id, name").then(({ data }: any) => { if (data) setEvents(data); });
    db.from("golf_courses").select("id, name").then(({ data }: any) => { if (data) setCourses(data); });
    db.from("destinations").select("id, name").then(({ data }: any) => { if (data) setDestinations(data); });
  }, []);

  const save = async () => {
    const { error } = await db.from("packages").insert({
      ...form,
      event_id: form.event_id || null,
      golf_course_id: form.golf_course_id || null,
      destination_id: form.destination_id || null,
      price: parseFloat(form.price),
      original_price: form.original_price ? parseFloat(form.original_price) : null,
    });
    if (error) toast.error(error.message);
    else { toast.success("Package added"); setOpen(false); setForm({ name: "", event_id: "", golf_course_id: "", destination_id: "", price: "", original_price: "", category: "weekend", featured: false, description: "" }); refresh(); }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Packages</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Package</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Package Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Event</Label>
                <Select value={form.event_id} onValueChange={(v) => setForm({ ...form, event_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                  <SelectContent>{events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Golf Course</Label>
                <Select value={form.golf_course_id} onValueChange={(v) => setForm({ ...form, golf_course_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Destination</Label>
                <Select value={form.destination_id} onValueChange={(v) => setForm({ ...form, destination_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                  <SelectContent>{destinations.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Price</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
                <div><Label>Original Price</Label><Input type="number" value={form.original_price} onChange={(e) => setForm({ ...form, original_price: e.target.value })} /></div>
              </div>
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekend">Weekend</SelectItem>
                    <SelectItem value="vip">VIP</SelectItem>
                    <SelectItem value="budget">Budget</SelectItem>
                    <SelectItem value="midweek">Midweek</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.featured} onCheckedChange={(v) => setForm({ ...form, featured: v })} />
                <Label>Featured</Label>
              </div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button onClick={save} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p>Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Event</TableHead><TableHead>Course</TableHead><TableHead>Price</TableHead><TableHead>Category</TableHead><TableHead>Featured</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.events?.name}</TableCell>
                  <TableCell>{p.golf_courses?.name}</TableCell>
                  <TableCell>${p.price}</TableCell>
                  <TableCell><Badge variant="secondary">{p.category}</Badge></TableCell>
                  <TableCell>{p.featured ? "⭐" : "—"}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Bookings (read only for admin) ---
function AdminBookings() {
  const { items, loading } = useCrud<any>("bookings", "*, packages(name)");

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="font-serif">Bookings</CardTitle></CardHeader>
      <CardContent>
        {loading ? <p>Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Package</TableHead><TableHead>Date</TableHead><TableHead>Guests</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.packages?.name}</TableCell>
                  <TableCell>{b.event_date || b.booking_date}</TableCell>
                  <TableCell>{b.guests}</TableCell>
                  <TableCell>${b.total_price}</TableCell>
                  <TableCell><Badge>{b.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
