import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Plus, Trash2, Edit, Copy } from "lucide-react";
import { normalizeOptionalHttpUrl } from "@/lib/httpUrl";
import {
  getPackageInventoryStatus,
  getAdminExpirationLabel,
  suggestExpiresAtFromEventDate,
  parseYmd,
  EXPIRING_SOON_DAYS,
  type PackageFreshnessInput,
} from "@/lib/packageFreshness";

type PkgRow = PackageFreshnessInput & {
  id: string;
  name: string;
  price: number;
  created_at: string;
  updated_at: string;
  featured?: boolean | null;
  events?: {
    name?: string;
    event_date?: string;
    artists?: { name?: string };
    venues?: { name?: string };
  } | null;
  golf_courses?: { name?: string } | null;
  destinations?: { name?: string; city?: string } | null;
};

const emptyForm = () => ({
  name: "",
  event_id: "",
  golf_course_id: "",
  destination_id: "",
  price: "",
  original_price: "",
  category: "Golf + Concert",
  featured: false,
  active: true,
  description: "",
  image_url: "",
  hotel_name: "",
  hotel_url: "",
  package_start_date: "",
  package_end_date: "",
  expires_at: "",
});

type FormState = ReturnType<typeof emptyForm>;

type ListFilter = "all" | "active" | "featured" | "expired" | "expiring_soon" | "inactive";
type ListSort = "event_date" | "created_at" | "expires_at";

export function AdminPackagesManager() {
  const [items, setItems] = useState<PkgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<{ id: string; name: string; event_date: string }[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [destinations, setDestinations] = useState<{ id: string; name: string; city?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<PkgRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [listSort, setListSort] = useState<ListSort>("event_date");

  const refresh = async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from("packages") as any)
      .select("*, events(name, event_date, artists(name), venues(name)), golf_courses(name), destinations(name, city))")
      .order("updated_at", { ascending: false });
    if (data) setItems(data as PkgRow[]);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    supabase.from("events").select("id, name, event_date").order("event_date").then(({ data }) => {
      if (data) setEvents(data);
    });
    supabase.from("golf_courses").select("id, name").order("name").then(({ data }) => {
      if (data) setCourses(data);
    });
    supabase.from("destinations").select("id, name, city").order("name").then(({ data }) => {
      if (data) setDestinations(data);
    });
  }, []);

  const eventDateById = useMemo(() => {
    const m: Record<string, string> = {};
    events.forEach((e) => {
      m[e.id] = e.event_date;
    });
    return m;
  }, [events]);

  const applyEventDefaults = (eventId: string) => {
    const ed = eventDateById[eventId];
    if (!ed) return;
    const ymd = ed.slice(0, 10);
    const ev = parseYmd(ymd);
    if (!ev) return;
    const start = new Date(ev);
    start.setDate(start.getDate() - 1);
    const end = new Date(ev);
    end.setDate(end.getDate() + 1);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const sug = suggestExpiresAtFromEventDate(ymd);
    setForm((f) => ({
      ...f,
      package_start_date: f.package_start_date || startStr,
      package_end_date: f.package_end_date || endStr,
      expires_at: f.expires_at || (sug ? sug.slice(0, 10) : ""),
    }));
  };

  const openAdd = () => {
    setEditItem(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (pkg: PkgRow) => {
    setEditItem(pkg);
    setForm({
      name: pkg.name ?? "",
      event_id: (pkg as { event_id?: string }).event_id ?? "",
      golf_course_id: (pkg as { golf_course_id?: string }).golf_course_id ?? "",
      destination_id: (pkg as { destination_id?: string }).destination_id ?? "",
      price: pkg.price?.toString() ?? "",
      original_price: (pkg as { original_price?: number | null }).original_price?.toString() ?? "",
      category: (pkg as { category?: string }).category ?? "Golf + Concert",
      featured: pkg.featured ?? false,
      active: pkg.active ?? true,
      description: (pkg as { description?: string | null }).description ?? "",
      image_url: (pkg as { image_url?: string | null }).image_url ?? "",
      hotel_name: (pkg as { hotel_name?: string | null }).hotel_name ?? "",
      hotel_url: (pkg as { hotel_url?: string | null }).hotel_url ?? "",
      package_start_date: (pkg as { package_start_date?: string | null }).package_start_date?.slice(0, 10) ?? "",
      package_end_date: (pkg as { package_end_date?: string | null }).package_end_date?.slice(0, 10) ?? "",
      expires_at: pkg.expires_at ? pkg.expires_at.slice(0, 10) : "",
    });
    setOpen(true);
  };

  /** Copy row to a new draft — adjust dates and publish when ready. */
  const duplicateFrom = (pkg: PkgRow) => {
    setEditItem(null);
    setForm({
      ...emptyForm(),
      name: `${pkg.name} (copy)`,
      event_id: (pkg as { event_id?: string }).event_id ?? "",
      golf_course_id: (pkg as { golf_course_id?: string }).golf_course_id ?? "",
      destination_id: (pkg as { destination_id?: string }).destination_id ?? "",
      price: pkg.price?.toString() ?? "",
      original_price: (pkg as { original_price?: number | null }).original_price?.toString() ?? "",
      category: (pkg as { category?: string }).category ?? "Golf + Concert",
      featured: false,
      active: false,
      description: (pkg as { description?: string | null }).description ?? "",
      image_url: (pkg as { image_url?: string | null }).image_url ?? "",
      hotel_name: (pkg as { hotel_name?: string | null }).hotel_name ?? "",
      hotel_url: (pkg as { hotel_url?: string | null }).hotel_url ?? "",
      package_start_date: (pkg as { package_start_date?: string | null }).package_start_date?.slice(0, 10) ?? "",
      package_end_date: (pkg as { package_end_date?: string | null }).package_end_date?.slice(0, 10) ?? "",
      expires_at: "",
    });
    setOpen(true);
    toast.info("Draft created — review dates, then publish.");
  };

  const validateDates = (): string | null => {
    const ps = form.package_start_date.trim();
    const pe = form.package_end_date.trim();
    if (ps && pe) {
      const a = parseYmd(ps);
      const b = parseYmd(pe);
      if (a && b && a > b) return "Trip end must be on or after trip start.";
    }
    const evYmd = form.event_id ? eventDateById[form.event_id]?.slice(0, 10) : null;
    if (evYmd && ps && pe) {
      const ev = parseYmd(evYmd);
      const ws = parseYmd(ps);
      const we = parseYmd(pe);
      if (ev && ws && we && (ev < ws || ev > we)) {
        return "Concert date should fall within the trip start/end window.";
      }
    }
    if (form.expires_at.trim() && pe) {
      const expD = parseYmd(form.expires_at.trim());
      const endD = parseYmd(pe);
      if (expD && endD && expD < endD) {
        return "Expiry date should be on or after the trip end (or extend the trip).";
      }
    }
    return null;
  };

  const save = async () => {
    const err = validateDates();
    if (err) {
      toast.error(err);
      return;
    }
    let hotel_url: string | null = form.hotel_url.trim() || null;
    if (hotel_url) {
      const hr = normalizeOptionalHttpUrl(hotel_url);
      if (!hr.ok) {
        toast.error(`Hotel URL: ${hr.message}`);
        return;
      }
      hotel_url = hr.value;
    }
    let image_url: string | null = form.image_url.trim() || null;
    if (image_url) {
      const ir = normalizeOptionalHttpUrl(image_url);
      if (!ir.ok) {
        toast.error(`Image URL: ${ir.message}`);
        return;
      }
      image_url = ir.value;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      event_id: form.event_id || null,
      golf_course_id: form.golf_course_id || null,
      destination_id: form.destination_id || null,
      price: parseFloat(form.price) || 0,
      original_price: form.original_price ? parseFloat(form.original_price) : null,
      category: form.category,
      featured: form.featured,
      active: form.active,
      description: form.description.trim() || null,
      image_url,
      hotel_name: form.hotel_name.trim() || null,
      hotel_url,
      package_start_date: form.package_start_date.trim() || null,
      package_end_date: form.package_end_date.trim() || null,
      expires_at: form.expires_at.trim()
        ? new Date(form.expires_at.trim() + "T23:59:59").toISOString()
        : null,
    };

    let error: { message?: string } | null = null;
    if (editItem) {
      ({ error } = await (supabase.from("packages") as any).update(payload).eq("id", editItem.id));
    } else {
      ({ error } = await (supabase.from("packages") as any).insert(payload));
    }
    if (error) toast.error(error.message ?? "Save failed");
    else {
      toast.success(editItem ? "Saved" : "Created");
      setOpen(false);
      refresh();
    }
  };

  const remove = async (id: string) => {
    const { error } = await (supabase.from("packages") as any).delete().eq("id", id);
    if (error) toast.error("Delete failed: " + error.message);
    else {
      toast.success("Deleted");
      refresh();
    }
  };

  const toggleField = async (pkg: PkgRow, field: "active" | "featured") => {
    await (supabase.from("packages") as any).update({ [field]: !pkg[field] }).eq("id", pkg.id);
    refresh();
  };

  const now = new Date();

  const filteredSorted = useMemo(() => {
    let rows = [...items];
    const status = (p: PkgRow) => getPackageInventoryStatus(p, now);

    if (listFilter === "active") {
      rows = rows.filter((p) => p.active === true && status(p) !== "expired");
    } else if (listFilter === "featured") {
      rows = rows.filter((p) => p.featured === true);
    } else if (listFilter === "expired") {
      rows = rows.filter((p) => status(p) === "expired");
    } else if (listFilter === "expiring_soon") {
      rows = rows.filter((p) => status(p) === "expiring_soon");
    } else if (listFilter === "inactive") {
      rows = rows.filter((p) => p.active === false);
    }

    rows.sort((a, b) => {
      if (listSort === "created_at") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (listSort === "expires_at") {
        const ea = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
        const eb = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
        return ea - eb;
      }
      const da = a.events?.event_date
        ? new Date(a.events.event_date + "T12:00:00").getTime()
        : Infinity;
      const db = b.events?.event_date
        ? new Date(b.events.event_date + "T12:00:00").getTime()
        : Infinity;
      return da - db;
    });

    return rows;
  }, [items, listFilter, listSort, now]);

  const statusBadge = (pkg: PkgRow) => {
    const s = getPackageInventoryStatus(pkg, now);
    if (s === "inactive") return <Badge variant="outline">Inactive</Badge>;
    if (s === "expired") return <Badge variant="destructive">Expired</Badge>;
    if (s === "expiring_soon")
      return (
        <Badge className="bg-amber-600 text-white" title={`Within ${EXPIRING_SOON_DAYS} days`}>
          Expiring soon
        </Badge>
      );
    return <Badge className="bg-emerald-700 text-white">Live</Badge>;
  };

  const venueLine = (pkg: PkgRow) => pkg.events?.venues?.name ?? "—";
  const cityLine = (pkg: PkgRow) => pkg.destinations?.city || pkg.destinations?.name || "—";

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle className="font-serif">Packages</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground max-w-xl">
            Required: title, event, course, destination, price. Trip dates and expiry keep public inventory accurate.
            Expiry defaults to 2 days after the show when you pick an event — adjust as needed.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-1 h-4 w-4" />
              Add package
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit package" : "New package"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pb-2">
              <div className="rounded-md border border-border/60 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Identity</p>
                <div>
                  <Label>Package title</Label>
                  <p className="text-xs text-muted-foreground mb-1">Shown on cards. Often: Artist + course + city.</p>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Artist + Course | Austin, TX"
                  />
                </div>
              </div>

              <div className="rounded-md border border-border/60 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Concert & place</p>
                <div>
                  <Label>Event</Label>
                  <p className="text-xs text-muted-foreground mb-1">Required — drives concert date and venue on the site.</p>
                  <Select
                    value={form.event_id}
                    onValueChange={(v) => {
                      setForm({ ...form, event_id: v });
                      applyEventDefaults(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select event" />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name} {e.event_date ? `(${e.event_date})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Golf course</Label>
                  <Select
                    value={form.golf_course_id}
                    onValueChange={(v) => setForm({ ...form, golf_course_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent>
                      {courses.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Destination (city)</Label>
                  <Select
                    value={form.destination_id}
                    onValueChange={(v) => setForm({ ...form, destination_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select destination" />
                    </SelectTrigger>
                    <SelectContent>
                      {destinations.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border border-border/60 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trip window (optional)</p>
                <p className="text-xs text-muted-foreground">
                  Fri–Sun style window around the show. Concert date should fall between start and end.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Trip start</Label>
                    <Input
                      type="date"
                      value={form.package_start_date}
                      onChange={(e) => setForm({ ...form, package_start_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Trip end</Label>
                    <Input
                      type="date"
                      value={form.package_end_date}
                      onChange={(e) => setForm({ ...form, package_end_date: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border/60 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hotel (optional)</p>
                <div>
                  <Label>Hotel name</Label>
                  <Input
                    value={form.hotel_name}
                    onChange={(e) => setForm({ ...form, hotel_name: e.target.value })}
                    placeholder="Recommended property label"
                  />
                </div>
                <div>
                  <Label>Hotel booking URL</Label>
                  <Input
                    value={form.hotel_url}
                    onChange={(e) => setForm({ ...form, hotel_url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Price / person ($)</Label>
                  <Input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Original price ($)</Label>
                  <Input
                    type="number"
                    value={form.original_price}
                    onChange={(e) => setForm({ ...form, original_price: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Golf + Concert">Golf + Concert</SelectItem>
                    <SelectItem value="VIP">VIP</SelectItem>
                    <SelectItem value="Budget">Budget</SelectItem>
                    <SelectItem value="Weekend">Weekend</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border border-border/60 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Visibility</p>
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                    <Label>Published</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.featured} onCheckedChange={(v) => setForm({ ...form, featured: v })} />
                    <Label>Featured</Label>
                  </div>
                </div>
                <div>
                  <Label>Expires (last day on site)</Label>
                  <p className="text-xs text-muted-foreground mb-1">
                    After this date the package hides from the homepage and /packages. Default: 2 days after show — change if needed.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="date"
                      className="flex-1 min-w-[140px]"
                      value={form.expires_at}
                      onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                    />
                    {form.event_id && eventDateById[form.event_id] && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          const sug = suggestExpiresAtFromEventDate(
                            eventDateById[form.event_id].slice(0, 10)
                          );
                          if (sug) setForm((f) => ({ ...f, expires_at: sug.slice(0, 10) }));
                        }}
                      >
                        Reset from event (+2d)
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <Label>Image URL</Label>
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                />
              </div>

              <Button onClick={save} className="w-full">
                {editItem ? "Save changes" : "Create package"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground mr-1">Filter:</span>
          {(
            [
              "all",
              "active",
              "featured",
              "expiring_soon",
              "expired",
              "inactive",
            ] as ListFilter[]
          ).map((f) => (
            <Button
              key={f}
              type="button"
              variant={listFilter === f ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs capitalize"
              onClick={() => setListFilter(f)}
            >
              {f.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground mr-1">Sort:</span>
          <Select value={listSort} onValueChange={(v) => setListSort(v as ListSort)}>
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="event_date">Soonest event</SelectItem>
              <SelectItem value="expires_at">Soonest expiration</SelectItem>
              <SelectItem value="created_at">Latest created</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Featured</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSorted.map((p) => (
                  <TableRow
                    key={p.id}
                    className={
                      getPackageInventoryStatus(p, now) === "expired" || p.active === false
                        ? "opacity-60"
                        : ""
                    }
                  >
                    <TableCell>
                      <div className="font-medium text-sm max-w-[200px] leading-snug">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.golf_courses?.name}</div>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{cityLine(p)}</TableCell>
                    <TableCell className="text-sm max-w-[140px] truncate" title={venueLine(p)}>
                      {venueLine(p)}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {p.events?.event_date
                        ? new Date(p.events.event_date + "T12:00:00").toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(p)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{getAdminExpirationLabel(p, now)}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        title="Toggle featured"
                        onClick={() => toggleField(p, "featured")}
                        className="text-lg leading-none"
                      >
                        {p.featured ? "★" : "☆"}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(p)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Duplicate as draft" onClick={() => duplicateFrom(p)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(p.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
