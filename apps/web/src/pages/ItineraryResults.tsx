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
import { Hotel, Music, Utensils, ExternalLink, Copy, ArrowLeft, Loader2, Mail, Bookmark, BookmarkCheck } from "lucide-react";
import { GolfTrustPanel, EventTrustPanel, HotelTrustPanel } from "@/components/TrustPanel";
import { normalizeOutboundLink, getOutboundLinkDisplayLabel } from "@/types/outbound-link";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MAX_EMAILS = 10;

const TIER_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  // Stronger tier distinction via background fills (not just borders)
  BRONZE: { bg: "bg-gradient-to-br from-amber-900/20 to-amber-900/5", border: "border-amber-700/40", badge: "bg-amber-700 text-white" },
  SILVER: { bg: "bg-gradient-to-br from-slate-300/30 to-slate-200/10", border: "border-slate-400/60", badge: "bg-slate-700 text-white" },
  GOLD: { bg: "bg-gradient-to-br from-yellow-500/25 to-yellow-500/8", border: "border-yellow-500/60", badge: "bg-yellow-500 text-black" },
};

const TIER_DESCRIPTORS: Record<string, string> = {
  BRONZE: "Best practical value — solid picks, typically lower cost.",
  SILVER: "Balanced comfort and convenience.",
  GOLD: "Premium stay and top-tier experience.",
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

  // Only select non-sensitive columns to avoid exposing email/user_id in shared views
  const safeColumns = "id, path, city, start_date, end_date, budget_tier, group_size, preferences, event_details, result_json, share_slug, status, created_at, updated_at";

  // Load which package tiers user has saved
  useEffect(() => {
    if (!user?.id || !itinerary?.id) return;
    (supabase
      .from("user_saved_packages" as any)
      .select("package_tier")
      .eq("user_id", user.id)
      .eq("itinerary_id", itinerary.id) as any)
      .then(({ data }: any) => setSavedTiers(new Set((data || []).map((r: any) => r.package_tier))));
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

  // Temporary: log saved result_json when ?tm_debug=1 for Ticketmaster URL inspection
  useEffect(() => {
    if (!itinerary?.result_json || !window.location.search.includes("tm_debug=1")) return;
    const result = itinerary.result_json as any;
    const eventsByPkg = (result?.packages || []).map((p: any) => ({
      tier: p.tier,
      events: (p.events || []).map((e: any) => ({ name: e.name, venue: e.venue, date_time: e.date_time, url: e.url })),
    }));
    console.log("[TM_LINK_DEBUG] Saved result_json (from DB)", { itinerary_id: itinerary.id, packages_events: eventsByPkg });
    console.log("[TM_LINK_DEBUG] Full result_json", result);
  }, [itinerary?.id, itinerary?.result_json]);

  const trackClick = async (
    tier: string,
    vendor: string,
    label: string,
    url: string,
    meta?: { provider?: string; category?: string; link_type?: string }
  ) => {
    if (!user) {
      navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    const itineraryId = itinerary?.id;
    const canTrack = itineraryId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itineraryId);

    if (canTrack) {
      try {
        const { error } = await supabase.functions.invoke("track-click", {
          body: {
            itinerary_id: itineraryId,
            package_tier: tier,
            vendor,
            label,
            target_url: url,
            ...(meta && { provider: meta.provider, category: meta.category, link_type: meta.link_type }),
          },
        });
        if (error && import.meta.env.DEV) {
          console.warn("[track-click] failed:", error);
        }
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn("[track-click] error:", e);
        }
      }
    }

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
      await (supabase
        .from("user_saved_packages" as any)
        .delete()
        .eq("user_id", user.id)
        .eq("itinerary_id", itinerary.id)
        .eq("package_tier", tier) as any);
      setSavedTiers((prev) => {
        const next = new Set(prev);
        next.delete(tier);
        return next;
      });
      toast.success("Removed from My Trips");
    } else {
      await (supabase
        .from("user_saved_packages" as any)
        .upsert(
          { user_id: user.id, itinerary_id: itinerary.id, package_tier: tier },
          { onConflict: "user_id,itinerary_id,package_tier" }
        ) as any);
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
      if (!supabaseUrl || !supabaseKey) {
        toast.error("App configuration error. Please try again later.");
        return;
      }
      let senderName: string | undefined;
      if (user) {
        try {
          const { data: profile } = await supabase.from("profiles").select("first_name, last_name").eq("user_id", user.id).maybeSingle();
          senderName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : undefined;
        } catch {
          senderName = undefined;
        }
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/send-share-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ share_url: getShareUrl(), recipient_emails: emails, sender_name: senderName }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        if (!res.ok) throw new Error("Server error. Please try again.");
      }
      if (!res.ok) throw new Error(data?.error || "Failed to send");
      toast.success(`Sent to ${emails.length} recipient(s)`);
      setShareEmailOpen(false);
      setShareEmails("");
    } catch (e: any) {
      const msg = e?.message || "Failed to send email";
      const isNetworkError = msg === "Failed to fetch" || msg === "Load failed" || msg?.includes("NetworkError");
      toast.error(isNetworkError ? "Could not reach the server. Check your connection and try again." : msg);
    } finally {
      setSendingEmail(false);
    }
  };

  const formatGeneratedAt = (dateStr: string) => {
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

  const newTripParams = new URLSearchParams();
  if (itinerary?.city) newTripParams.set("city", itinerary.city);
  if (itinerary?.start_date) newTripParams.set("start_date", itinerary.start_date);
  if (itinerary?.end_date) newTripParams.set("end_date", itinerary.end_date);
  if (itinerary?.budget_tier) newTripParams.set("budget_tier", itinerary.budget_tier);
  if (itinerary?.group_size != null) newTripParams.set("group_size", String(itinerary.group_size));
  if (itinerary?.event_details) newTripParams.set("event_details", String(itinerary.event_details));

  const newTripHref = newTripParams.toString() ? `/experience?${newTripParams.toString()}` : "/experience";

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to={newTripHref}><ArrowLeft className="mr-2 h-4 w-4" /> New Trip</Link>
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

      {/* Generated date + combined trust disclosure */}
      <div className="mb-6 text-center space-y-2">
        <p className="text-sm font-semibold">
          Generated {formatGeneratedAt(itinerary.updated_at)}
        </p>
        <p className="text-xs text-muted-foreground max-w-xl mx-auto">
          Prices and availability are as of this date. You'll book directly with providers—confirm on their site before booking. Experience Caddie does not handle reservations.
        </p>
      </div>

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
                <div className="flex items-center gap-2 flex-wrap">
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
                  {TIER_DESCRIPTORS[pkg.tier] && (
                    <span className="text-sm text-muted-foreground">{TIER_DESCRIPTORS[pkg.tier]}</span>
                  )}
                </div>

                {!user && (
                  <div className="flex justify-end border-b border-border/50 pb-2">
                    <button
                      type="button"
                      className="text-xs text-amber-600 hover:underline"
                      onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname)}`)}
                    >
                      Log in to share, save, or book
                    </button>
                  </div>
                )}

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
                        {lodgingItems.map((h: any, i: number) => {
                          const hotelLink = normalizeOutboundLink(h.link || h.url, "hotel");
                          const hasUrl = (h.link?.url || h.url || "").trim();
                          const buttonEl = (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => trackClick(pkg.tier, "hotel", h.name, hotelLink.url, {
                                provider: hotelLink.provider,
                                category: hotelLink.category,
                                link_type: hotelLink.link_type,
                              })}
                            >
                              {getOutboundLinkDisplayLabel(hotelLink)} <ExternalLink className="ml-1 h-3 w-3" />
                            </Button>
                          );
                          return (
                            <div key={i} className="rounded-lg border border-border/50 p-4">
                              <div className="flex items-start justify-between gap-4">
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
                                  {h.why && <p className="text-sm text-muted-foreground"><span className="font-medium">Why we picked it:</span> <span className="italic">{h.why}</span></p>}
                                  {h.price_per_night && <p className="text-sm font-medium">{h.price_per_night}/night</p>}
                                </div>
                                {hasUrl && (
                                  <div className="flex flex-col items-end gap-1">
                                    {hotelLink.disclaimer ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-xs text-xs">
                                          {hotelLink.disclaimer}
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      buttonEl
                                    )}
                                  </div>
                                )}
                              </div>
                              <HotelTrustPanel
                                provider={hotelLink.provider}
                                generatedAt={result._generated_at || itinerary.updated_at}
                              />
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  ) : null;
                })()}

                {/* Events — only concerts/shows; exclude restaurant/bar/experience/attraction.
                    Note: events schema has no "why" field. Future pass: add why to generate-itinerary
                    LLM schema (events array) and render e.why here for consistency with lodging/golf. */}
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
                        <div key={`${pkg.tier}-event-${i}-${String(e.name || "").slice(0, 50)}-${e.date_time || ""}`} className="rounded-lg border border-border/50 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-medium">{e.name}</p>
                              {e.venue && <p className="text-sm text-muted-foreground">{e.venue}</p>}
                              {e.date_time && <p className="text-sm text-muted-foreground">{e.date_time}</p>}
                              {e.price_range && <p className="text-sm font-medium">{e.price_range}</p>}
                            </div>
                            {(e.url || (e.link && typeof e.link === "object" && e.link.url)) && (() => {
                              const concertLink = normalizeOutboundLink(e.link || e.url, "concert");
                              const buttonEl = (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="shrink-0"
                                  data-event-url={concertLink.url}
                                  onClick={(ev) => {
                                    const url = (ev.currentTarget as HTMLButtonElement).getAttribute("data-event-url");
                                    if (url) {
                                      trackClick(pkg.tier, "ticket", e.name, url, { provider: concertLink.provider, category: concertLink.category, link_type: concertLink.link_type });
                                    }
                                  }}
                                >
                                  {getOutboundLinkDisplayLabel(concertLink)} <ExternalLink className="ml-1 h-3 w-3" />
                                </Button>
                              );
                              return (
                                <div className="flex flex-col items-end gap-1">
                                  {concertLink.disclaimer ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-xs text-xs">
                                        {concertLink.disclaimer}
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    buttonEl
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <EventTrustPanel
                            venue={typeof e.venue_obj === "object" ? e.venue_obj : (e.venue ? { name: e.venue } : undefined)}
                            date_time={e.date_time}
                            provider={e.provider}
                            generatedAt={result._generated_at || itinerary.updated_at}
                          />
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
                      {golfItems.map((g: any, i: number) => {
                        const golfLink = normalizeOutboundLink(g.link || g.url, "golf");
                        const hasUrl = (g.link?.url || g.url || "").trim();
                        const buttonEl = (
                          <Button
                            size="sm"
                            variant="default"
                            className="shrink-0"
                            onClick={() => trackClick(pkg.tier, "golf", g.name, golfLink.url, {
                              provider: golfLink.provider,
                              category: golfLink.category,
                              link_type: golfLink.link_type,
                            })}
                          >
                            {getOutboundLinkDisplayLabel(golfLink)} <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        );
                        return (
                        <div key={i} className="rounded-lg border border-border/50 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-medium">{g.name}</p>
                              {g.why && <p className="text-sm text-muted-foreground"><span className="font-medium">Why we picked it:</span> <span className="italic">{g.why}</span></p>}
                              {g.green_fee && <p className="text-sm font-medium">{g.green_fee}</p>}
                            </div>
                            {hasUrl && (
                              <div className="flex flex-col items-end gap-1">
                                {golfLink.disclaimer ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs text-xs">
                                      {golfLink.disclaimer}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  buttonEl
                                )}
                              </div>
                            )}
                          </div>
                          <GolfTrustPanel
                            drive_time_minutes={g.drive_time_minutes}
                            distance_miles={g.distance_miles}
                            public_access_confidence={g.public_access_confidence}
                            provider={g.provider}
                            source_url={g.source_url}
                            maps_url={g.maps_url}
                            as_of={g.as_of}
                            generatedAt={result._generated_at || itinerary.updated_at}
                            placeId={g.place_id}
                            lat={g.lat}
                            lng={g.lng}
                          />
                        </div>
                      );
                      })}
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
                            {x.why && <p className="mt-1 text-sm text-muted-foreground"><span className="font-medium">Why we picked it:</span> <span className="italic">{x.why}</span></p>}
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
    </div>
  );
}
