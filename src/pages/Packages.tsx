import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import type { Package } from "@/types/database";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Music, MapPin, Calendar, Search } from "lucide-react";

export default function Packages() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const categoryFilter = searchParams.get("category") || "all";
  const [sort, setSort] = useState("date");

  useEffect(() => {
    const fetchPackages = async () => {
      let query = db
        .from("packages")
        .select("*, events(*, artists(*), venues(*)), golf_courses(*), destinations(*)")
        .eq("active", true);

      if (categoryFilter !== "all") {
        query = query.eq("category", categoryFilter);
      }

      const { data } = await query;
      if (data) setPackages(data as unknown as Package[]);
      setLoading(false);
    };
    fetchPackages();
  }, [categoryFilter]);

  const filtered = packages
    .filter((p) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(s) ||
        p.events?.artists?.name?.toLowerCase().includes(s) ||
        p.destinations?.name?.toLowerCase().includes(s) ||
        p.golf_courses?.name?.toLowerCase().includes(s)
      );
    })
    .sort((a, b) => {
      if (sort === "price-low") return a.price - b.price;
      if (sort === "price-high") return b.price - a.price;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="font-serif text-3xl font-bold">Concert + Golf Packages</h1>
      <p className="mt-1 text-muted-foreground">Find your perfect getaway</p>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by artist, destination, course..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Newest</SelectItem>
            <SelectItem value="price-low">Price: Low → High</SelectItem>
            <SelectItem value="price-high">Price: High → Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="mt-12 text-center text-muted-foreground">Loading packages...</div>
      ) : filtered.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pkg) => (
            <Link key={pkg.id} to={`/packages/${pkg.id}`}>
              <Card className="group overflow-hidden border-border/50 transition-all hover:shadow-xl">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={pkg.image_url || pkg.events?.image_url || "/placeholder.svg"}
                    alt={pkg.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  {pkg.original_price && pkg.original_price > pkg.price && (
                    <Badge className="absolute left-3 top-3 bg-accent text-accent-foreground">
                      Save ${(pkg.original_price - pkg.price).toFixed(0)}
                    </Badge>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-serif text-lg font-semibold leading-tight group-hover:text-primary">{pkg.name}</h3>
                  {pkg.destinations && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" /> {pkg.destinations.city || pkg.destinations.name}
                    </p>
                  )}
                  {pkg.events && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Music className="h-3.5 w-3.5" /> {pkg.events.artists?.name || pkg.events.name}
                    </p>
                  )}
                  {pkg.events?.event_date && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" /> {new Date(pkg.events.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
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
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-12 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Music className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 font-serif text-xl font-semibold">No Packages Found</h3>
          <p className="mt-2 text-muted-foreground">Check back soon for new concert + golf packages!</p>
        </div>
      )}
    </div>
  );
}
