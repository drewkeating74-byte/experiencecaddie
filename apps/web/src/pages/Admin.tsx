import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Edit, ExternalLink } from "lucide-react";
import { normalizeOptionalHttpUrl } from "@/lib/httpUrl";
import { AdminPackagesManager } from "@/components/admin/AdminPackagesManager";
import type { KnownTable } from "@/lib/adminTableFetch";
import { fetchAllIdNamePairs, fetchAllPaged } from "@/lib/adminTableFetch";

export default function Admin() {
  const { user, isAdmin, loading: authLoading, adminChecked } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && adminChecked && (!user || !isAdmin)) {
      navigate("/");
    }
  }, [user, isAdmin, authLoading, adminChecked, navigate]);

  if (authLoading || !adminChecked) return <div className="container mx-auto px-4 py-16 text-center">Loading...</div>;
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

        <div className="mt-4 mb-2">
          <button
            onClick={() => navigate("/admin/golf-review")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Open Golf Course Reviewer →
          </button>
        </div>

        <TabsContent value="packages"><AdminPackagesManager /></TabsContent>
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
function useCrud<T extends { id: string }>(table: KnownTable, selectQuery = "*") {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = await fetchAllPaged<T>((from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from(table) as any)
          .select(selectQuery)
          .order("created_at", { ascending: false })
          .range(from, to),
      );
      setItems(rows);
    } catch (e: unknown) {
      toast.error(`Failed to load ${String(table)}: ${e instanceof Error ? e.message : String(e)}`);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table) as any).delete().eq("id", id);
    if (error) toast.error("Delete failed: " + (error as { message: string }).message);
    else {
      toast.success("Deleted");
      refresh();
    }
  };

  return { items, loading, refresh, remove };
}

const FK_EMPTY = "__none__";

// --- Destinations ---
function AdminDestinations() {
  const { items, loading, refresh, remove } = useCrud<any>("destinations");
  const empty = () => ({ name: "", city: "", state: "", country: "", description: "" });
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  const reset = () => {
    setForm(empty());
    setEditId(null);
  };

  const openAdd = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (d: any) => {
    setEditId(d.id);
    setForm({
      name: d.name ?? "",
      city: d.city ?? "",
      state: d.state ?? "",
      country: d.country ?? "",
      description: d.description ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      country: form.country.trim() || null,
      description: form.description.trim() || null,
    };
    const { error } =
      editId != null
        ? await supabase.from("destinations").update(payload).eq("id", editId)
        : await supabase.from("destinations").insert(payload);
    if (error) toast.error(error.message);
    else {
      toast.success(editId ? "Destination updated" : "Destination added");
      setOpen(false);
      reset();
      refresh();
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Destinations</CardTitle>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editId ? "Edit destination" : "Add destination"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>City</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <Button onClick={save} className="w-full">
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{items.length} destination(s) loaded from the database (paged).</p>
            <div className="max-h-[min(70vh,900px)] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell>{d.city}</TableCell>
                      <TableCell>{d.state}</TableCell>
                      <TableCell>{d.country}</TableCell>
                      <TableCell className="flex justify-end gap-0.5">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(d)} aria-label="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(d.id)} aria-label="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// --- Artists ---
function AdminArtists() {
  const { items, loading, refresh, remove } = useCrud<any>("artists");
  const empty = () => ({ name: "", genre: "", subgenre: "", description: "" });
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  const reset = () => {
    setForm(empty());
    setEditId(null);
  };

  const openAdd = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (a: any) => {
    setEditId(a.id);
    setForm({
      name: a.name ?? "",
      genre: a.genre ?? "",
      subgenre: a.subgenre ?? "",
      description: a.description ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      genre: form.genre.trim() || null,
      subgenre: form.subgenre.trim() || null,
      description: form.description.trim() || null,
    };
    const { error } =
      editId != null
        ? await supabase.from("artists").update(payload).eq("id", editId)
        : await supabase.from("artists").insert(payload);
    if (error) toast.error(error.message);
    else {
      toast.success(editId ? "Artist updated" : "Artist added");
      setOpen(false);
      reset();
      refresh();
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Artists</CardTitle>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editId ? "Edit artist" : "Add artist"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Genre</Label>
                  <Input value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} />
                </div>
                <div>
                  <Label>Subgenre</Label>
                  <Input value={form.subgenre} onChange={(e) => setForm({ ...form, subgenre: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <Button onClick={save} className="w-full">
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{items.length} artist(s) loaded.</p>
            <div className="max-h-[min(70vh,900px)] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Genre</TableHead>
                    <TableHead>Subgenre</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.genre}</TableCell>
                      <TableCell>{a.subgenre}</TableCell>
                      <TableCell className="flex justify-end gap-0.5">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(a)} aria-label="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(a.id)} aria-label="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// --- Venues ---
function AdminVenues() {
  const { items, loading, refresh, remove } = useCrud<any>("venues");
  const [destinations, setDestinations] = useState<{ id: string; name: string | null }[]>([]);
  const empty = () => ({ name: "", city: "", state: "", country: "", address: "", destination_id: "", capacity: "" });
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  useEffect(() => {
    fetchAllIdNamePairs("destinations").then(setDestinations).catch(() => toast.error("Failed to load destinations for dropdowns"));
  }, []);

  const reset = () => {
    setForm(empty());
    setEditId(null);
  };

  const openAdd = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (v: any) => {
    setEditId(v.id);
    setForm({
      name: v.name ?? "",
      city: v.city ?? "",
      state: v.state ?? "",
      country: v.country ?? "",
      address: v.address ?? "",
      destination_id: v.destination_id ?? "",
      capacity: v.capacity != null ? String(v.capacity) : "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      country: form.country.trim() || null,
      address: form.address.trim() || null,
      destination_id: form.destination_id.trim() || null,
      capacity: form.capacity ? parseInt(form.capacity, 10) : null,
    };
    const { error } =
      editId != null
        ? await supabase.from("venues").update(payload).eq("id", editId)
        : await supabase.from("venues").insert(payload);
    if (error) toast.error(error.message);
    else {
      toast.success(editId ? "Venue updated" : "Venue added");
      setOpen(false);
      reset();
      refresh();
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Venues</CardTitle>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editId ? "Edit venue" : "Add venue"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>City</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Destination</Label>
                <Select
                  value={form.destination_id || FK_EMPTY}
                  onValueChange={(v) => setForm({ ...form, destination_id: v === FK_EMPTY ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FK_EMPTY}>(none)</SelectItem>
                    {destinations.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name ?? d.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Capacity</Label>
                <Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </div>
              <Button onClick={save} className="w-full">
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{items.length} venue(s) loaded.</p>
            <div className="max-h-[min(70vh,900px)] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((v: any) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.name}</TableCell>
                      <TableCell>{v.city}</TableCell>
                      <TableCell>{v.state}</TableCell>
                      <TableCell>{v.capacity}</TableCell>
                      <TableCell className="flex justify-end gap-0.5">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(v)} aria-label="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(v.id)} aria-label="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function timeInputValue(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (s.length >= 5 && s[2] === ":") return s.slice(0, 5);
  return s;
}

// --- Events ---
function AdminEvents() {
  const { items, loading, refresh, remove } = useCrud<any>("events", "*, artists(name), venues(name)");
  const [artists, setArtists] = useState<{ id: string; name: string | null }[]>([]);
  const [venues, setVenues] = useState<{ id: string; name: string | null }[]>([]);
  const empty = () => ({
    name: "",
    artist_id: "",
    venue_id: "",
    event_date: "",
    event_time: "",
    description: "",
    ticket_url: "",
    min_price: "",
    max_price: "",
  });
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  useEffect(() => {
    fetchAllIdNamePairs("artists").then(setArtists).catch(() => toast.error("Failed to load artists"));
    fetchAllIdNamePairs("venues").then(setVenues).catch(() => toast.error("Failed to load venues"));
  }, []);

  const reset = () => {
    setForm(empty());
    setEditId(null);
  };

  const openAdd = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (e: any) => {
    setEditId(e.id);
    setForm({
      name: e.name ?? "",
      artist_id: e.artist_id ?? "",
      venue_id: e.venue_id ?? "",
      event_date: String(e.event_date ?? "").slice(0, 10),
      event_time: timeInputValue(e.event_time),
      description: e.description ?? "",
      ticket_url: e.ticket_url ?? "",
      min_price: e.min_price != null ? String(e.min_price) : "",
      max_price: e.max_price != null ? String(e.max_price) : "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.event_date) {
      toast.error("Event name and date are required");
      return;
    }
    let ticket_url: string | null = form.ticket_url.trim() || null;
    if (ticket_url) {
      const r = normalizeOptionalHttpUrl(ticket_url);
      if (!r.ok) {
        toast.error(`Ticket URL: ${r.message}`);
        return;
      }
      ticket_url = r.value;
    }
    const payload = {
      name: form.name.trim(),
      event_date: form.event_date,
      event_time: form.event_time.trim() || null,
      description: form.description.trim() || null,
      ticket_url,
      artist_id: form.artist_id.trim() || null,
      venue_id: form.venue_id.trim() || null,
      min_price: form.min_price ? parseFloat(form.min_price) : null,
      max_price: form.max_price ? parseFloat(form.max_price) : null,
    };
    const { error } =
      editId != null
        ? await supabase.from("events").update(payload).eq("id", editId)
        : await supabase.from("events").insert(payload);
    if (error) toast.error(error.message);
    else {
      toast.success(editId ? "Event updated" : "Event added");
      setOpen(false);
      reset();
      refresh();
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Events</CardTitle>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit event" : "Add event"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Event Name</Label>
                <Input value={form.name} onChange={(x) => setForm({ ...form, name: x.target.value })} />
              </div>
              <div>
                <Label>Artist</Label>
                <Select
                  value={form.artist_id || FK_EMPTY}
                  onValueChange={(v) => setForm({ ...form, artist_id: v === FK_EMPTY ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select artist" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FK_EMPTY}>(none)</SelectItem>
                    {artists.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name ?? a.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Venue</Label>
                <Select
                  value={form.venue_id || FK_EMPTY}
                  onValueChange={(v) => setForm({ ...form, venue_id: v === FK_EMPTY ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select venue" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FK_EMPTY}>(none)</SelectItem>
                    {venues.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name ?? v.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.event_date} onChange={(x) => setForm({ ...form, event_date: x.target.value })} />
                </div>
                <div>
                  <Label>Time</Label>
                  <Input type="time" value={form.event_time} onChange={(x) => setForm({ ...form, event_time: x.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Min Price</Label>
                  <Input type="number" value={form.min_price} onChange={(x) => setForm({ ...form, min_price: x.target.value })} />
                </div>
                <div>
                  <Label>Max Price</Label>
                  <Input type="number" value={form.max_price} onChange={(x) => setForm({ ...form, max_price: x.target.value })} />
                </div>
              </div>
              <div>
                <Label>Ticket URL</Label>
                <Input value={form.ticket_url} onChange={(x) => setForm({ ...form, ticket_url: x.target.value })} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(x) => setForm({ ...form, description: x.target.value })} />
              </div>
              <Button onClick={save} className="w-full">
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{items.length} event(s) loaded.</p>
            <div className="max-h-[min(70vh,900px)] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Artist</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell>{e.artists?.name}</TableCell>
                      <TableCell>{e.venues?.name}</TableCell>
                      <TableCell>{e.event_date}</TableCell>
                      <TableCell>
                        {e.min_price ? `$${e.min_price}` : "—"}
                        {e.max_price ? ` – $${e.max_price}` : ""}
                      </TableCell>
                      <TableCell className="flex justify-end gap-0.5">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(e)} aria-label="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(e.id)} aria-label="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// --- Golf Courses ---
function AdminCourses() {
  const { items, loading, refresh, remove } = useCrud<any>("golf_courses");
  const [destinations, setDestinations] = useState<{ id: string; name: string | null }[]>([]);
  const empty = () => ({
    name: "",
    city: "",
    state: "",
    country: "",
    address: "",
    destination_id: "",
    holes: "18",
    green_fee_min: "",
    green_fee_max: "",
    public_access: true,
    description: "",
    booking_url: "",
  });
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  useEffect(() => {
    fetchAllIdNamePairs("destinations").then(setDestinations).catch(() => toast.error("Failed to load destinations"));
  }, []);

  const reset = () => {
    setForm(empty());
    setEditId(null);
  };

  const openAdd = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (c: any) => {
    setEditId(c.id);
    setForm({
      name: c.name ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      country: c.country ?? "",
      address: c.address ?? "",
      destination_id: c.destination_id ?? "",
      holes: c.holes != null ? String(c.holes) : "18",
      green_fee_min: c.green_fee_min != null ? String(c.green_fee_min) : "",
      green_fee_max: c.green_fee_max != null ? String(c.green_fee_max) : "",
      public_access: c.public_access !== false,
      description: c.description ?? "",
      booking_url: c.booking_url ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    let booking_url: string | null = form.booking_url.trim() || null;
    if (booking_url) {
      const r = normalizeOptionalHttpUrl(booking_url);
      if (!r.ok) {
        toast.error(`Booking URL: ${r.message}`);
        return;
      }
      booking_url = r.value;
    }
    const payload = {
      name: form.name.trim(),
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      country: form.country.trim() || null,
      address: form.address.trim() || null,
      booking_url,
      destination_id: form.destination_id.trim() || null,
      holes: parseInt(form.holes, 10) || 18,
      green_fee_min: form.green_fee_min ? parseFloat(form.green_fee_min) : null,
      green_fee_max: form.green_fee_max ? parseFloat(form.green_fee_max) : null,
      public_access: form.public_access,
      description: form.description.trim() || null,
    };
    const { error } =
      editId != null
        ? await supabase.from("golf_courses").update(payload).eq("id", editId)
        : await supabase.from("golf_courses").insert(payload);
    if (error) toast.error(error.message);
    else {
      toast.success(editId ? "Course updated" : "Course added");
      setOpen(false);
      reset();
      refresh();
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif">Golf Courses</CardTitle>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit golf course" : "Add golf course"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>City</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Destination</Label>
                <Select
                  value={form.destination_id || FK_EMPTY}
                  onValueChange={(v) => setForm({ ...form, destination_id: v === FK_EMPTY ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FK_EMPTY}>(none)</SelectItem>
                    {destinations.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name ?? d.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Holes</Label>
                  <Input type="number" value={form.holes} onChange={(e) => setForm({ ...form, holes: e.target.value })} />
                </div>
                <div>
                  <Label>Min Fee</Label>
                  <Input type="number" value={form.green_fee_min} onChange={(e) => setForm({ ...form, green_fee_min: e.target.value })} />
                </div>
                <div>
                  <Label>Max Fee</Label>
                  <Input type="number" value={form.green_fee_max} onChange={(e) => setForm({ ...form, green_fee_max: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.public_access} onCheckedChange={(v) => setForm({ ...form, public_access: v })} />
                <Label>Public Access</Label>
              </div>
              <div>
                <Label>Booking URL</Label>
                <Input value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <Button onClick={save} className="w-full">
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{items.length} course(s) loaded.</p>
            <div className="max-h-[min(70vh,900px)] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Holes</TableHead>
                    <TableHead>Fees</TableHead>
                    <TableHead>Public</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {c.city}, {c.state}
                      </TableCell>
                      <TableCell>{c.holes}</TableCell>
                      <TableCell>
                        {c.green_fee_min ? `$${c.green_fee_min}` : "—"}
                        {c.green_fee_max ? `–$${c.green_fee_max}` : ""}
                      </TableCell>
                      <TableCell>{c.public_access ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                      <TableCell className="flex justify-end gap-0.5">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(c.id)} aria-label="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
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
        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{items.length} booking(s) loaded.</p>
            <div className="max-h-[min(70vh,900px)] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Package</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Guests</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
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
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
