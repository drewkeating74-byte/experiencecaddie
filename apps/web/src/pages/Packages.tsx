import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import type { Package } from "@/types/database";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Music, MapPin, Calendar, Search, Check, ArrowRight, RefreshCw } from "lucide-react";
import { DEFAULT_PACKAGE_IMAGE } from "@/lib/constants";
import { logEvent } from "@/lib/analytics";
import {
  comparePublicSoonestEventFirst,
  getPackageInventoryStatus,
  daysUntilExpiration,
} from "@/lib/packageFreshness";

// Promoted packages carry denormalized fields instead of FK-joined relations.
// These helpers resolve the right value regardless of package source.
function pkgEventDate(pkg: Package): string | null {
  return (pkg as any).event_date ?? pkg.events?.event_date ?? null;
}
function pkgArtistName(pkg: Package): string | null {
  return (pkg as any).artist_name ?? pkg.events?.artists?.name ?? pkg.events?.name ?? null;
}
function pkgCity(pkg: Package): string | null {
  return (pkg as any).city ?? pkg.destinations?.city ?? pkg.destinations?.name ?? null;
}
function pkgGolfName(pkg: Package): string | null {
  return (pkg as any).golf_course_name ?? pkg.golf_courses?.name ?? null;
}

function getIncludes(pkg: Package): string[] {
  const items: string[] = [];
  if (pkg.events || (pkg as any).event_name) items.push("Concert tickets");
  if (pkg.golf_courses || pkgGolfName(pkg)) {
    const holes = pkg.golf_courses?.holes || 18;
    items.push(`${holes} holes golf w/ cart`);
  }
  if (pkg.destinations || pkgCity(pkg)) items.push("2 nights hotel");
  return items;
}

export default function Packages() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const categoryFilter = searchParams.get("category") || "all";
  const [sort, setSort] = useState("upcoming");
  const [destination, setDestination] = useState("all");
  const [windowFilter, setWindowFilter] = useState("all"); // "all" | "this-month" | "60-days"
  const navigate = useNavigate();

  function buildItineraryUrl(pkg: Package): string {
    const city = pkgCity(pkg) ?? "";
    const artistName = pkgArtistName(pkg) ?? "";
    const eventDate = pkgEventDate(pkg) ?? "";
    let startDate = "";
    let endDate = "";
    if (eventDate) {
      const d = new Date(eventDate + "T12:00:00");
      const before = new Date(d); before.setDate(d.getDate() - 1);
      const after  = new Date(d); after.setDate(d.getDate() + 1);
      startDate = before.toISOString().slice(0, 10);
      endDate   = after.toISOString().slice(0, 10);
    }
    const params = new URLSearchParams({
      city,
      event_details: artistName,
      budget_tier: "mid",
      group_size: "2",
      auto: "1",
      ...(startDate && { start_date: startDate }),
      ...(endDate   && { end_date: endDate }),
    });
    return `/experience?${params.toString()}`;
  }

  function handlePackageClick(pkg: Package) {
    logEvent({
      event_type: "package_generate_click",
      package_id: pkg.id,
      metro_slug: pkg.destinations?.city?.toLowerCase().replace(/[\s/]+/g, "-") ?? undefined,
      artist_name: pkg.events?.artists?.name ?? pkg.events?.name ?? undefined,
      context: "packages_page",
    });
    navigate(buildItineraryUrl(pkg));
  }

  useEffect(() => {
    const fetchPackages = async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const headers: Record<string, string> = {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      };
      const select = "*, events(*, artists(*), venues(*)), golf_courses(*), destinations(*)";
      const nowIso = new Date().toISOString();
      let url = `${supabaseUrl}/rest/v1/packages?select=${encodeURIComponent(select)}&active=eq.true&or=(expires_at.is.null,expires_at.gt.${nowIso})`;
      if (categoryFilter !== "all") {
        url += `&category=eq.${encodeURIComponent(categoryFilter)}`;
      }
      try {
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (Array.isArray(data)) setPackages(data as unknown as Package[]);
      } catch (e) {
        console.error("Failed to fetch packages:", e);
      }
      setLoading(false);
    };
    fetchPackages();
  }, [categoryFilter]);

  // Derive destination options from data
  const destinations = [...new Set(packages.map(p => p.destinations?.name).filter(Boolean))] as string[];

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const filtered = packages
    .filter((p) => {
      // Always hide packages whose event date has already passed or is today
      const evDate = pkgEventDate(p);
      if (evDate && evDate.slice(0, 10) < tomorrowStr) return false;

      if (search) {
        const s = search.toLowerCase();
        if (!(
          p.name.toLowerCase().includes(s) ||
          p.events?.artists?.name?.toLowerCase().includes(s) ||
          p.destinations?.name?.toLowerCase().includes(s) ||
          p.golf_courses?.name?.toLowerCase().includes(s)
        )) return false;
      }
      if (destination !== "all" && p.destinations?.name !== destination) return false;

      if (windowFilter !== "all") {
        const evd = pkgEventDate(p);
        if (evd) {
          const d = new Date(evd + "T12:00:00");
          if (windowFilter === "this-month" && d > endOfMonth) return false;
          if (windowFilter === "60-days" && d > in60Days) return false;
        }
        // null event_date = evergreen/curated package — always passes time-window filter
      }

      return true;
    })
    .sort((a, b) => {
      if (sort === "price-low") return a.price - b.price;
      if (sort === "price-high") return b.price - a.price;
      return comparePublicSoonestEventFirst(a, b);
    });

  const hasActiveFilters = destination !== "all" || windowFilter !== "all" || search !== "";

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="font-serif text-3xl font-bold">Current Packages</h1>
          <p className="mt-1 text-muted-foreground">
            {packages.length > 0
              ? `${packages.length} verified package${packages.length !== 1 ? "s" : ""} — bookable now`
              : "Verified golf + concert weekends"}
          </p>
        </div>
      </div>

      {/* Quick date-window chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(["all", "this-month", "60-days"] as const).map((key) => {
          const labels = { "all": "All upcoming", "this-month": "This month", "60-days": "Next 60 days" };
          return (
            <button
              key={key}
              onClick={() => setWindowFilter(key)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                windowFilter === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              {labels[key]}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Artist, city, or course..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={destination} onValueChange={setDestination}>
          <SelectTrigger className="w-[165px]">
            <SelectValue placeholder="Destination" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Destinations</SelectItem>
            {destinations.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[165px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upcoming">Soonest First</SelectItem>
            <SelectItem value="price-low">Price: Low → High</SelectItem>
            <SelectItem value="price-high">Price: High → Low</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm"
            onClick={() => { setDestination("all"); setWindowFilter("all"); setSearch(""); }}
            className="text-muted-foreground">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
        )}
      </div>

      {loading ? (
        <div className="mt-12 text-center text-muted-foreground">Loading packages...</div>
      ) : filtered.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pkg) => {
            const extPkg = pkg as Package & { expires_at?: string | null };
            const inv = getPackageInventoryStatus(extPkg);
            const expiringSoon = inv === "expiring_soon";
            const daysLeft = daysUntilExpiration(extPkg);
            return (
            <div key={pkg.id} role="button" tabIndex={0}
              onClick={() => handlePackageClick(pkg)}
              onKeyDown={(e) => e.key === "Enter" && handlePackageClick(pkg)}
              className="cursor-pointer">
              <Card className={`group overflow-hidden border-border/50 transition-all hover:shadow-xl ${expiringSoon ? "opacity-[0.92]" : ""}`}>
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={pkg.image_url || pkg.events?.image_url || DEFAULT_PACKAGE_IMAGE}
                    alt={pkg.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  {(pkg as any).source === "promoted" && (
                    <Badge className="absolute left-3 top-3 bg-primary/90 text-primary-foreground text-[10px]">
                      Community pick
                    </Badge>
                  )}
                  {(pkg as any).source !== "promoted" && pkg.original_price && pkg.original_price > pkg.price && (
                    <Badge className="absolute left-3 top-3 bg-accent text-accent-foreground">
                      Save ${(pkg.original_price - pkg.price).toFixed(0)}
                    </Badge>
                  )}
                  {expiringSoon && daysLeft !== null && (
                    <Badge className="absolute right-3 top-3 bg-orange-500 text-white">
                      {daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                    </Badge>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-serif text-lg font-semibold leading-tight group-hover:text-primary">{pkg.name}</h3>
                  {pkgCity(pkg) && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" /> {pkgCity(pkg)}
                    </p>
                  )}
                  {pkgArtistName(pkg) && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Music className="h-3.5 w-3.5" /> {pkgArtistName(pkg)}
                    </p>
                  )}
                  {pkgEventDate(pkg) && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" /> {new Date(pkgEventDate(pkg)! + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  {getIncludes(pkg).length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {getIncludes(pkg).map((item) => (
                        <li key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Check className="h-3 w-3 shrink-0 text-primary" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <span className="text-xl font-bold">${pkg.price}</span>
                      {pkg.original_price && pkg.original_price > pkg.price && (
                        <span className="ml-2 text-sm text-muted-foreground line-through">${pkg.original_price}</span>
                      )}
                      <span className="ml-1 text-sm text-muted-foreground">/person</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">{pkg.category}</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
            );
          })}
        </div>
      ) : (
        // ── Empty state ─────────────────────────────────────────────────────
        <div className="mt-12 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Music className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <h3 className="mt-4 font-serif text-xl font-semibold">
            {hasActiveFilters ? "No packages match those filters" : "No current packages"}
          </h3>
          <p className="mt-2 max-w-sm mx-auto text-muted-foreground text-sm">
            {hasActiveFilters
              ? "We only show verified packages tied to confirmed tour dates. Try adjusting your filters."
              : "We don't have a verified package for that search right now. Browse what's available or use the planner."}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            {hasActiveFilters && (
              <Button variant="outline" className="rounded-full"
                onClick={() => { setDestination("all"); setWindowFilter("all"); setSearch(""); }}>
                <RefreshCw className="mr-2 h-4 w-4" /> Show all current packages
              </Button>
            )}
            <Button className="rounded-full" onClick={() => navigate("/experience")}>
              Build a custom weekend <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            New packages are added when confirmed tour dates are announced.
          </p>
        </div>
      )}
    </div>
  );
}
