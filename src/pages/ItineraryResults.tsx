import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Hotel, Home, Music, MapPin, Utensils, ExternalLink, Copy, Share2, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

const db = supabase as any;

const TIER_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  BRONZE: { bg: "bg-amber-900/5", border: "border-amber-700/30", badge: "bg-amber-700 text-white" },
  SILVER: { bg: "bg-slate-300/10", border: "border-slate-400/40", badge: "bg-slate-500 text-white" },
  GOLD: { bg: "bg-yellow-500/10", border: "border-yellow-500/40", badge: "bg-yellow-500 text-black" },
};

export default function ItineraryResults() {
  const { id } = useParams<{ id: string }>();
  const [itinerary, setItinerary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    db.from("itineraries")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }: any) => {
        if (data) setItinerary(data);
        if (error) toast.error("Itinerary not found");
        setLoading(false);
      });
  }, [id]);

  const trackClick = async (tier: string, vendor: string, label: string, url: string) => {
    // Fire and forget click tracking
    supabase.functions.invoke("track-click", {
      body: { itinerary_id: id, package_tier: tier, vendor, label, target_url: url },
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyShareLink = () => {
    if (itinerary?.share_slug) {
      const url = `${window.location.origin}/share/${itinerary.share_slug}`;
      navigator.clipboard.writeText(url);
      toast.success("Share link copied!");
    }
  };

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!itinerary) return <div className="container mx-auto px-4 py-16 text-center">Itinerary not found</div>;

  if (itinerary.status === "generating") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <h2 className="font-serif text-2xl font-bold">Still generating...</h2>
        <p className="text-muted-foreground">This should only take a few seconds</p>
      </div>
    );
  }

  if (itinerary.status === "error") {
    return (
      <div className="container mx-auto max-w-xl px-4 py-16 text-center">
        <h2 className="font-serif text-2xl font-bold text-destructive">Generation Failed</h2>
        <p className="mt-2 text-muted-foreground">Something went wrong. Please try again.</p>
        <Button asChild className="mt-6 rounded-full"><Link to="/experience">Try Again</Link></Button>
      </div>
    );
  }

  const result = itinerary.result_json;
  if (!result) return <div className="container mx-auto px-4 py-16 text-center">No results yet</div>;

  const summary = result.summary;
  const packages = result.packages || [];

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/experience"><ArrowLeft className="mr-2 h-4 w-4" /> New Trip</Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyShareLink}>
            <Share2 className="mr-2 h-4 w-4" /> Share
          </Button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold md:text-4xl">{summary.title}</h1>
          {summary.vibe && <p className="mt-2 text-lg text-muted-foreground">{summary.vibe}</p>}
          {summary.estimated_total_range_usd && (
            <p className="mt-2 text-sm text-muted-foreground">
              Estimated total: ${summary.estimated_total_range_usd[0]?.toLocaleString()} – ${summary.estimated_total_range_usd[1]?.toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Tier Tabs */}
      <Tabs defaultValue={packages[0]?.tier || "BRONZE"}>
        <TabsList className="mx-auto mb-6 grid w-full max-w-md grid-cols-3">
          {packages.map((pkg: any) => (
            <TabsTrigger key={pkg.tier} value={pkg.tier} className="font-serif">
              {pkg.tier === "BRONZE" ? "🥉" : pkg.tier === "SILVER" ? "🥈" : "🥇"} {pkg.tier}
            </TabsTrigger>
          ))}
        </TabsList>

        {packages.map((pkg: any) => {
          const style = TIER_STYLES[pkg.tier] || TIER_STYLES.BRONZE;
          return (
            <TabsContent key={pkg.tier} value={pkg.tier}>
              <div className={`rounded-xl border-2 ${style.border} ${style.bg} p-6 space-y-6`}>
                <div className="flex items-center justify-between">
                  <Badge className={style.badge}>{pkg.tier}</Badge>
                  {pkg.estimated_total_usd && (
                    <span className="font-serif text-xl font-bold">
                      ${pkg.estimated_total_usd[0]?.toLocaleString()} – ${pkg.estimated_total_usd[1]?.toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Lodging */}
                {(pkg.lodging?.length > 0 || pkg.hotels?.length > 0) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 font-serif text-lg">
                        <Hotel className="h-5 w-5 text-primary" /> Lodging
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(pkg.lodging || pkg.hotels || []).map((h: any, i: number) => (
                        <div key={i} className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{h.name}</p>
                              {h.type && (
                                <Badge variant="secondary" className="text-xs">
                                  {h.type === "vacation_rental" ? "Rental" : h.type === "golf_resort" ? "Golf Resort" : "Hotel"}
                                </Badge>
                              )}
                            </div>
                            {h.area && <p className="text-sm text-muted-foreground">{h.area}</p>}
                            {h.why && <p className="text-sm text-muted-foreground italic">{h.why}</p>}
                            {h.price_per_night && <p className="text-sm font-medium">{h.price_per_night}/night</p>}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => trackClick(pkg.tier, "hotel", h.name, h.url)}
                          >
                            Book <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Events */}
                {pkg.events?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 font-serif text-lg">
                        <Music className="h-5 w-5 text-accent" /> Events
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {pkg.events.map((e: any, i: number) => (
                        <div key={i} className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium">{e.name}</p>
                            {e.venue && <p className="text-sm text-muted-foreground">{e.venue}</p>}
                            {e.date_time && <p className="text-sm text-muted-foreground">{e.date_time}</p>}
                            {e.price_range && <p className="text-sm font-medium">{e.price_range}</p>}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => trackClick(pkg.tier, "ticket", e.name, e.url)}
                          >
                            Tickets <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Golf */}
                {pkg.golf?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 font-serif text-lg">
                        ⛳ Golf
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {pkg.golf.map((g: any, i: number) => (
                        <div key={i} className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium">{g.name}</p>
                            {g.why && <p className="text-sm text-muted-foreground italic">{g.why}</p>}
                            {g.green_fee && <p className="text-sm font-medium">{g.green_fee}</p>}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => trackClick(pkg.tier, "golf", g.name, g.url)}
                          >
                            Tee Times <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Extras */}
                {pkg.extras?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 font-serif text-lg">
                        <Utensils className="h-5 w-5 text-primary" /> Extras
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {pkg.extras.map((x: any, i: number) => (
                        <div key={i} className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium">{x.name}</p>
                            <Badge variant="secondary" className="text-xs">{x.type}</Badge>
                            {x.why && <p className="mt-1 text-sm text-muted-foreground italic">{x.why}</p>}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => trackClick(pkg.tier, "experience", x.name, x.url)}
                          >
                            View <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Day-by-Day Itinerary */}
                {pkg.itinerary?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="font-serif text-lg">Day-by-Day Plan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {pkg.itinerary.map((day: any, i: number) => (
                        <div key={i}>
                          <h4 className="font-semibold">{day.day}</h4>
                          <ul className="mt-1 space-y-1">
                            {(day.plan || []).map((item: string, j: number) => (
                              <li key={j} className="text-sm text-muted-foreground">• {item}</li>
                            ))}
                          </ul>
                          {i < pkg.itinerary.length - 1 && <Separator className="mt-3" />}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {pkg.safety_notes && (
                  <p className="text-xs text-muted-foreground italic">⚠️ {pkg.safety_notes}</p>
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Disclaimer */}
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Prices and availability change. You'll book directly with providers. No booking handled by Experience Caddie.
      </p>
    </div>
  );
}
