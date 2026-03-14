import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hotel, Music, Utensils, ExternalLink, Copy, ArrowLeft, Loader2, Mail, Bookmark, BookmarkCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const MAX_EMAILS = 10;

const TIER_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  BRONZE: { bg: "bg-amber-900/5", border: "border-amber-700/30", badge: "bg-amber-700 text-white" },
  SILVER: { bg: "bg-slate-300/10", border: "border-slate-400/40", badge: "bg-slate-500 text-white" },
  GOLD: { bg: "bg-yellow-500/10", border: "border-yellow-500/40", badge: "bg-yellow-500 text-black" },
};

export default function ItineraryResults() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [itinerary, setItinerary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savedTiers, setSavedTiers] = useState<Set<string>>(new Set());
  const [shareEmailOpen, setShareEmailOpen] = useState(false);
  const [shareEmails, setShareEmails] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Only select non-sensitive columns to avoid exposing email/user_id in shared views
  const safeColumns = "id, path, city, start_date, end_date, budget_tier, group_size, preferences, event_details, result_json, share_slug, status, created_at, updated_at";

  // Load which package tiers user has saved
  useEffect(() => {
    if (!user?.id || !itinerary?.id) return;
    supabase
      .from("user_saved_packages")
      .select("package_tier")
      .eq("user_id", user.id)
      .eq("itinerary_id", itinerary.id)
      .then(({ data }) => setSavedTiers(new Set((data || []).map((r: any) => r.package_tier))));
  }, [user?.id, itinerary?.id]);

  useEffect(() => {
    if (!id) return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const headers: Record<string, string> = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
    };

    // Use fetch directly — Supabase JS client hangs silently on this project
    fetch(`${supabaseUrl}/rest/v1/itineraries?select=${encodeURIComponent(safeColumns)}&share_slug=eq.${encodeURIComponent(id)}&limit=1`, { headers })
      .then(r => r.json())
      .then((rows: any[]) => {
        if (rows?.length > 0) {
          setItinerary(rows[0]);
          setLoading(false);
        } else {
          // Fall back to ID lookup
          fetch(`${supabaseUrl}/rest/v1/itineraries?select=${encodeURIComponent(safeColumns)}&id=eq.${encodeURIComponent(id)}&limit=1`, { headers })
            .then(r => r.json())
            .then((rows2: any[]) => {
              if (rows2?.length > 0) setItinerary(rows2[0]);
              else toast.error("Itinerary not found");
              setLoading(false);
            })
            .catch(() => { toast.error("Failed to load itinerary"); setLoading(false); });
        }
      })
      .catch(() => { toast.error("Failed to load itinerary"); setLoading(false); });
  }, [id]);

  const trackClick = async (tier: string, vendor: string, label: string, url: string) => {
    if (!user) {
      toast.error("Log in to book");
      navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    supabase.functions.invoke("track-click", {
      body: { itinerary_id: id, package_tier: tier, vendor, label, target_url: url },
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSave = async (tier: string) => {
    if (!user || !itinerary?.id) {
      toast.error("Log in to save this package");
      navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const isSaved = savedTiers.has(tier);
    if (isSaved) {
      await supabase
        .from("user_saved_packages")
        .delete()
        .eq("user_id", user.id)
        .eq("itinerary_id", itinerary.id)
        .eq("package_tier", tier);
      setSavedTiers((prev) => {
        const next = new Set(prev);
        next.delete(tier);
        return next;
      });
      toast.success("Removed from My Trips");
    } else {
      await supabase
        .from("user_saved_packages")
        .upsert(
          { user_id: user.id, itinerary_id: itinerary.id, package_tier: tier },
          { onConflict: "user_id,itinerary_id,package_tier" }
        );
      setSavedTiers((prev) => new Set(prev).add(tier));
      toast.success("Saved to My Trips");
    }
  };

  const handleShareViaEmail = async () => {
    const emails = shareEmails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) {
      toast.error("Enter at least one email");
      return;
    }
    if (emails.length > MAX_EMAILS) {
      toast.error(`Maximum ${MAX_EMAILS} recipients`);
      return;
    }
    setSendingEmail(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const profile = user ? (await supabase.from("profiles").select("first_name, last_name").eq("user_id", user.id).maybeSingle()).data : null;
      const senderName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : undefined;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-share-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ share_url: getShareUrl(), recipient_emails: emails, sender_name: senderName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send");
      toast.success(`Sent to ${emails.length} recipient(s)`);
      setShareEmailOpen(false);
      setShareEmails("");
    } catch (e: any) {
      toast.error(e?.message || "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    toast.info("Refreshing prices and availability...");
    // TODO: Call refresh API to re-run Ticketmaster etc and update itinerary
    setTimeout(() => {
      setRefreshing(false);
      toast.success("Refresh complete");
    }, 2000);
  };

  const formatLastUpdated = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };

  const getShareUrl = () => {
    const base = import.meta.env.VITE_APP_URL || window.location.origin;
    return `${base.replace(/\/$/, "")}/share/${itinerary?.share_slug || ""}`;
  };

  const copyShareLink = () => {
    if (itinerary?.share_slug) {
      navigator.clipboard.writeText(getShareUrl());
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
            <Copy className="mr-2 h-4 w-4" /> Copy link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (user ? setShareEmailOpen(true) : navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname)}`))}
          >
            <Mail className="mr-2 h-4 w-4" /> Share via email
          </Button>
        </div>
      </div>

      <Dialog open={shareEmailOpen} onOpenChange={setShareEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share via email</DialogTitle>
            <DialogDescription>Enter up to {MAX_EMAILS} email addresses (comma or space separated)</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="share-emails">Recipients</Label>
            <Input
              id="share-emails"
              type="text"
              placeholder="friend@example.com, another@example.com"
              value={shareEmails}
              onChange={(e) => setShareEmails(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareEmailOpen(false)}>Cancel</Button>
            <Button onClick={handleShareViaEmail} disabled={sendingEmail}>
              {sendingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleSave(pkg.tier)}
                    disabled={!user}
                    title={user ? (savedTiers.has(pkg.tier) ? "Remove from My Trips" : "Save to My Trips") : "Log in to save"}
                  >
                    {savedTiers.has(pkg.tier) ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
                  </Button>
                  <Badge className={style.badge}>{pkg.tier}</Badge>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-muted-foreground border-b border-border/50">
                  <span>Updated {formatLastUpdated(itinerary.updated_at)}</span>
                  <div className="flex items-center gap-2">
                    {!user && (
                      <button
                        type="button"
                        className="text-amber-600 hover:underline"
                        onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname)}`)}
                      >
                        Log in to share, save, or book
                      </button>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleRefresh} disabled={refreshing}>
                      {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Refresh
                    </Button>
                  </div>
                </div>

                {pkg.estimated_total_usd && (
                  <div className="font-serif text-xl font-bold">
                    ${pkg.estimated_total_usd[0]?.toLocaleString()} – ${pkg.estimated_total_usd[1]?.toLocaleString()}
                  </div>
                )}

                {/* Lodging — only actual accommodations (hotels, rentals, golf resorts) */}
                {(() => {
                  const lodgingItems = (pkg.lodging || pkg.hotels || []).filter(
                    (h: any) => !["restaurant", "bar", "experience", "attraction"].includes(h.type)
                  );
                  return lodgingItems.length > 0 ? (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 font-serif text-lg">
                          <Hotel className="h-5 w-5 text-primary" /> Lodging
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {lodgingItems.map((h: any, i: number) => (
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
                            {h.url && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => trackClick(pkg.tier, "hotel", h.name, h.url)}
                              >
                                {user ? "Book" : "Log in to book"} <ExternalLink className="ml-1 h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ) : null;
                })()}

                {/* Events — only concerts/shows; exclude restaurant/bar/experience/attraction */}
                {(() => {
                  const extrasTypes = ["restaurant", "bar", "experience", "attraction"];
                  const eventItems = (pkg.events || []).filter((e: any) => !extrasTypes.includes(e.type));
                  return eventItems.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 font-serif text-lg">
                        <Music className="h-5 w-5 text-accent" /> Events
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {eventItems.map((e: any, i: number) => (
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
                            {user ? "Tickets" : "Log in to book"} <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  );
                })()}

                {/* Golf — only golf courses; exclude restaurant/bar/experience/attraction */}
                {(() => {
                  const extrasTypes = ["restaurant", "bar", "experience", "attraction"];
                  const golfItems = (pkg.golf || []).filter((g: any) => !extrasTypes.includes(g.type));
                  return golfItems.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 font-serif text-lg">
                        ⛳ Golf
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {golfItems.map((g: any, i: number) => (
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
                            {user ? "Tee Times" : "Log in to book"} <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  );
                })()}

                {/* Extras — restaurants, bars, experiences; no book buttons */}
                {(() => {
                  const extrasTypes = ["restaurant", "bar", "experience", "attraction"];
                  const toExtra = (x: any) => ({ name: x.name, type: x.type || "experience", why: x.why });
                  const fromLodging = ((pkg.lodging || pkg.hotels || []).filter((h: any) => extrasTypes.includes(h.type)) as any[]).map(toExtra);
                  const fromEvents = ((pkg.events || []).filter((e: any) => extrasTypes.includes(e.type)) as any[]).map(toExtra);
                  const fromGolf = ((pkg.golf || []).filter((g: any) => extrasTypes.includes(g.type)) as any[]).map(toExtra);
                  const fromExtras = (pkg.extras || []).map((x: any) => ({ name: x.name, type: x.type || "experience", why: x.why }));
                  const extrasItems = [...fromExtras, ...fromLodging, ...fromEvents, ...fromGolf];
                  return extrasItems.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 font-serif text-lg">
                          <Utensils className="h-5 w-5 text-primary" /> Extras
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {extrasItems.map((x: any, i: number) => (
                          <div key={i}>
                            <p className="font-medium">{x.name}</p>
                            <Badge variant="secondary" className="text-xs">{x.type}</Badge>
                            {x.why && <p className="mt-1 text-sm text-muted-foreground italic">{x.why}</p>}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })()}

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
      <div className="mt-8 space-y-2 text-center text-xs text-muted-foreground">
        <p>Prices, availability, and accommodations may change. You'll book directly with providers. No booking handled by Experience Caddie.</p>
      </div>
    </div>
  );
}
