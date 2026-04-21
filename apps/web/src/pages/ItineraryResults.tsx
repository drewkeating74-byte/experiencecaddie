import { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
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
import { normalizeOutboundLink, type OutboundLink } from "@/types/outbound-link";
import {
  buildHotelUrl,
  getHotelOutboundCtaLabel,
  getTicketOutboundCtaLabel,
  getGolfOutboundCtaLabel,
  type HotelLinkSource,
} from "@/lib/outboundLinks";
import { logEvent } from "@/lib/analytics";
import { firstFutureConcertDisplayYmd, getBrowserTimeZone } from "@/lib/tripWindow";
import { savePostAuthReturn } from "@/lib/postAuthReturn";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Tables } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Types for the AI-generated result_json blob stored in the itineraries table.
// These mirror the output schema of the generate-itinerary Edge Function.
// ---------------------------------------------------------------------------
interface ResultLink { url: string; [key: string]: unknown; }

interface ResultHotelItem {
  name: string;
  area?: string;
  why?: string;
  price_per_night?: string;
  link?: string | ResultLink;
  url?: string;
  type?: string;
}

interface ResultEventItem {
  name?: string;
  venue?: string | { name?: string; city?: string; state?: string };
  venue_obj?: { name?: string; city?: string; state?: string };
  date_time?: string;
  price_range?: string;
  link?: string | ResultLink;
  url?: string;
  type?: string;
  provider?: string;
}

interface ResultGolfItem {
  name?: string;
  type?: string;
  why?: string;
  green_fee?: string;
  drive_time_minutes?: number;
  distance_miles?: number;
  public_access_confidence?: string;
  provider?: string;
  source_url?: string;
  maps_url?: string;
  as_of?: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  link?: string | ResultLink;
  url?: string;
}

interface ResultExtra { name: string; type?: string; why?: string; }

interface ResultItineraryDay { day: string; plan?: string[]; }

interface ResultPackage {
  tier: string;
  city?: string;
  /** If set by backend, curated hotel booking URL for this tier */
  hotel_url?: string;
  events?: ResultEventItem[];
  hotels?: ResultHotelItem[];
  lodging?: ResultHotelItem[];
  golf?: ResultGolfItem[];
  extras?: ResultExtra[];
  itinerary?: ResultItineraryDay[];
  estimated_total_usd?: [number, number];
  safety_notes?: string;
}

function extractEventDateIso(dateTimeStr: string | undefined): string | undefined {
  if (!dateTimeStr) return undefined;
  const m = String(dateTimeStr).match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1];
}

interface ResultSummary {
  title?: string;
  vibe?: string;
  estimated_total_range_usd?: [number, number];
}

interface ResultJson {
  summary?: ResultSummary;
  packages?: ResultPackage[];
  _generated_at?: string;
}

type ItineraryRow = Tables<"itineraries">;

const MAX_EMAILS = 10;

const TIER_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  // Stronger tier distinction via background fills (not just borders)
  BRONZE: { bg: "bg-gradient-to-br from-amber-900/20 to-amber-900/5", border: "border-amber-700/40", badge: "bg-amber-700 text-white" },
  SILVER: { bg: "bg-gradient-to-br from-slate-300/30 to-slate-200/10", border: "border-slate-400/60", badge: "bg-slate-700 text-white" },
  GOLD: { bg: "bg-gradient-to-br from-yellow-500/25 to-yellow-500/8", border: "border-yellow-500/60", badge: "bg-yellow-500 text-black" },
};

const TIER_DESCRIPTORS: Record<string, string> = {
  BRONZE: "Value tee time + solid seats.",
  SILVER: "Balanced course + good seats.",
  GOLD: "Premium course + premium seats.",
};

/** Extract YYYY-MM-DD from date_time string, timestamp, or date-like value. Handles PostgREST, ISO, and odd formats. */
function toYYYYMMDD(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    const iso = trimmed.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return null;
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 0) return null;
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.date === "string") return toYYYYMMDD(obj.date);
    if (typeof obj.toISOString === "function") return toYYYYMMDD((obj as Date).toISOString());
  }
  return null;
}

export default function ItineraryResults() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [itinerary, setItinerary] = useState<ItineraryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedTiers, setSavedTiers] = useState<Set<string>>(new Set());
  const [shareEmailOpen, setShareEmailOpen] = useState(false);
  const [shareEmails, setShareEmails] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  // Auto-open the share-email dialog when returning from auth with ?open=share-email
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("open") === "share-email" && user) {
      setShareEmailOpen(true);
      // Remove the param from the URL so a reload doesn't re-open it
      params.delete("open");
      const newSearch = params.toString();
      navigate(location.pathname + (newSearch ? `?${newSearch}` : ""), { replace: true });
    }
  }, [location.search, user, location.pathname, navigate]);

  // Only select non-sensitive columns to avoid exposing email/user_id in shared views
  const safeColumns = "id, path, city, start_date, end_date, budget_tier, group_size, preferences, event_details, result_json, share_slug, status, created_at, updated_at";

  // Load which package tiers user has saved.
  // user_saved_packages is a pending DB migration — not yet in generated types, hence the cast.
  useEffect(() => {
    if (!user?.id || !itinerary?.id) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    db.from("user_saved_packages")
      .select("package_tier")
      .eq("user_id", user.id)
      .eq("itinerary_id", itinerary.id)
      .then(({ data }: { data: Array<{ package_tier: string }> | null }) =>
        setSavedTiers(new Set((data ?? []).map((r) => r.package_tier)))
      );
  }, [user?.id, itinerary?.id]);

  // When the user signs in (or was already signed in on mount), check whether
  // they clicked an outbound link before being asked to log in. If so, show a
  // toast with a button — auto window.open() is blocked by popup blockers when
  // not triggered by a direct user gesture.
  useEffect(() => {
    if (!user) return;
    const pendingLink = sessionStorage.getItem("post_auth_link");
    if (pendingLink) {
      sessionStorage.removeItem("post_auth_link");
      toast("You're signed in — ready to open your link", {
        duration: 20000,
        action: {
          label: "Open now →",
          onClick: () => window.open(pendingLink, "_blank", "noopener,noreferrer"),
        },
      });
    }
  }, [user]);

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
      .then((rows: ItineraryRow[]) => {
        if (rows?.length > 0) {
          setItinerary(rows[0]);
          setLoading(false);
        } else {
          // Fall back to ID lookup
          fetch(`${supabaseUrl}/rest/v1/itineraries?select=${encodeURIComponent(safeColumns)}&id=eq.${encodeURIComponent(id)}&limit=1`, { headers })
            .then(r => r.json())
            .then((rows2: ItineraryRow[]) => {
              if (rows2?.length > 0) setItinerary(rows2[0]);
              else toast.error("Itinerary not found");
              setLoading(false);
            })
            .catch((err: unknown) => { console.error("Failed to load itinerary:", err); toast.error("Failed to load itinerary"); setLoading(false); });
        }
      })
      .catch((err: unknown) => { console.error("Failed to load itinerary:", err); toast.error("Failed to load itinerary"); setLoading(false); });
  }, [id]);

  // Temporary: log saved result_json when ?tm_debug=1 for Ticketmaster URL inspection
  useEffect(() => {
    if (!itinerary?.result_json || !window.location.search.includes("tm_debug=1")) return;
    const result = itinerary.result_json as unknown as ResultJson;
    const eventsByPkg = (result?.packages ?? []).map((p) => ({
      tier: p.tier,
      events: (p.events ?? []).map((e) => ({ name: e.name, venue: e.venue, date_time: e.date_time, url: e.url })),
    }));
    console.log("[TM_LINK_DEBUG] Saved result_json (from DB)", { itinerary_id: itinerary.id, packages_events: eventsByPkg });
    console.log("[TM_LINK_DEBUG] Full result_json", result);
  }, [itinerary?.id, itinerary?.result_json]);

  const trackClick = async (
    tier: string,
    vendor: string,
    label: string,
    url: string,
    meta?: {
      provider?: string;
      /** OutboundLink uses "concert" for tickets; analytics extra uses "ticket". */
      category?: string;
      link_type?: string;
      hotel_link_source?: "override" | "google_hotels";
      event_date?: string;
    }
  ) => {
    const analyticsType =
      meta?.category === "hotel" ? "hotel_link_clicked" :
      meta?.category === "concert" ? "ticket_link_clicked" :
      meta?.category === "golf" ? "golf_link_clicked" : null;
    if (analyticsType) {
      const city =
        itinerary.city && itinerary.city !== "flexible" ? itinerary.city : undefined;
      const catForExtra =
        meta?.category === "concert"
          ? "ticket"
          : (meta?.category as "hotel" | "ticket" | "golf" | undefined);
      logEvent({
        event_type: analyticsType,
        artist_name: itinerary.event_details?.trim() || undefined,
        metro_slug: city
          ? city.toLowerCase().replace(/[\s,]+/g, "-")
          : undefined,
        context: "itinerary",
        extra: {
          tier,
          provider: meta?.provider,
          category: catForExtra,
          link_type: meta?.link_type,
          label,
          city,
          event_date: meta?.event_date,
          hotel_link_source: meta?.hotel_link_source,
        },
      });
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
            page_context: "itinerary",
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
      const returnTo = `${location.pathname}${location.search}`;
      savePostAuthReturn(returnTo);
      navigate(`/auth?redirect=${encodeURIComponent(returnTo)}`);
      return;
    }
    // user_saved_packages is a pending DB migration — not yet in generated types, hence the cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const isSaved = savedTiers.has(tier);
    if (isSaved) {
      await db.from("user_saved_packages")
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
      await db.from("user_saved_packages").upsert(
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
  if (!itinerary) return (
    <div className="container mx-auto max-w-xl px-4 py-16 text-center">
      <h2 className="font-serif text-2xl font-bold">Trip not found</h2>
      <p className="mt-2 text-muted-foreground">This link may have expired or the itinerary ID is incorrect. Build a new trip and we'll create a fresh shareable link.</p>
      <Button asChild className="mt-6 rounded-full px-8"><Link to="/experience">Plan a New Weekend</Link></Button>
    </div>
  );

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

  const result = itinerary.result_json as unknown as ResultJson | null;
  if (!result) return <div className="container mx-auto px-4 py-16 text-center">No results yet</div>;

  const summary = result.summary;
  const packages = result.packages ?? [];
  const viewerEventFloorYmd = firstFutureConcertDisplayYmd(getBrowserTimeZone());

  // "New Trip" always starts fresh — no prefill from the current itinerary.
  // This avoids stale state (e.g. the previous artist persisting when the user
  // toggles city to "flexible") and matches the user's mental model that
  // "New Trip" means a blank slate. Other prefill flows (featured packages,
  // shared links) still work because they set their own URL params.
  const newTripHref = "/experience";

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" asChild className="w-fit">
          <Link to={newTripHref}><ArrowLeft className="mr-2 h-4 w-4" /> New Trip</Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0" onClick={copyShareLink}>
            <Copy className="mr-2 h-4 w-4" /> Copy link
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
            onClick={() => {
              if (user) {
                setShareEmailOpen(true);
                return;
              }
              const params = new URLSearchParams(location.search);
              params.set("open", "share-email");
              const returnTo = `${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
              savePostAuthReturn(returnTo);
              navigate(`/auth?redirect=${encodeURIComponent(returnTo)}`);
            }}
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

      {/* Stale itinerary notice — no live refresh; suggest a new trip */}
      {(() => {
        if (!itinerary?.updated_at) return null;
        const ageDays = Math.floor((Date.now() - new Date(itinerary.updated_at).getTime()) / 86_400_000);
        if (ageDays < 7) return null;
        return (
          <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300 text-center">
            This itinerary is {ageDays} days old — event dates and availability may have changed.{" "}
            <Link to={newTripHref} className="font-medium underline underline-offset-2 hover:text-foreground">
              Plan a new trip
            </Link>{" "}
            for the latest options.
          </div>
        );
      })()}

      {/* Tier Tabs */}
      <Tabs defaultValue={packages[0]?.tier || "BRONZE"}>
        <TabsList className="mx-auto mb-6 grid w-full max-w-md grid-cols-3 h-12">
          {packages.map((pkg: any) => (
            <TabsTrigger key={pkg.tier} value={pkg.tier} className="font-serif text-xs sm:text-sm h-full">
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
                    className="h-11 w-11 p-0"
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
                          const cityDisplay =
                            (itinerary.city && itinerary.city !== "flexible" ? itinerary.city : "") ||
                            (pkg as ResultPackage).city ||
                            "";
                          const tierHotelOverride = (pkg as ResultPackage).hotel_url?.trim();
                          const urlFromRow =
                            typeof h.url === "string" && h.url.trim()
                              ? h.url.trim()
                              : "";
                          const linkObj = typeof h.link === "object" && h.link ? (h.link as { url?: string }) : null;
                          const linkUrl = linkObj?.url ? String(linkObj.url).trim() : "";
                          const urlString = urlFromRow || linkUrl;
                          const rawNormalized = normalizeOutboundLink(
                            linkObj ? { ...linkObj, url: urlString || linkObj.url || "" } : urlString,
                            "hotel"
                          );

                          const googleHotelsDestination =
                            [h.name, cityDisplay].filter(Boolean).join(" ").trim() ||
                            cityDisplay ||
                            "hotels";

                          const overrideCandidate =
                            (tierHotelOverride || urlString || "").trim() || null;
                          const b = buildHotelUrl({
                            context: "itinerary",
                            destination: googleHotelsDestination,
                            checkIn: itinerary.start_date ?? undefined,
                            checkOut: itinerary.end_date ?? undefined,
                            overrideUrl: overrideCandidate,
                          });
                          const src = b.hotelLinkSource ?? "google_hotels";
                          const isGoogleFallback = src === "google_hotels";

                          const hotelLink: OutboundLink & { hotelLinkSource?: HotelLinkSource } = {
                            ...rawNormalized,
                            url: b.url,
                            provider: b.provider,
                            category: "hotel",
                            link_type: isGoogleFallback ? "provider_search" : "direct_listing",
                            label: getHotelOutboundCtaLabel(src as HotelLinkSource, cityDisplay),
                            disclaimer: rawNormalized.disclaimer,
                            hotelLinkSource: src as HotelLinkSource,
                          };

                          const cta = getHotelOutboundCtaLabel(hotelLink.hotelLinkSource, cityDisplay);
                          const hasUrl = hotelLink.url.trim();
                          const buttonEl = (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => trackClick(pkg.tier, "hotel", h.name, hotelLink.url, {
                                provider: hotelLink.provider,
                                category: hotelLink.category,
                                link_type: hotelLink.link_type,
                                hotel_link_source: hotelLink.hotelLinkSource,
                              })}
                            >
                              {cta} <ExternalLink className="ml-1 h-3 w-3" />
                            </Button>
                          );
                          return (
                            <div key={i} className="rounded-lg border border-border/50 p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium">{h.name}</p>
                                    {h.type && (
                                      <Badge variant="secondary" className="text-xs">
                                        {h.type === "vacation_rental" ? "Rental" : h.type === "golf_resort" ? "Golf Resort" : "Hotel"}
                                      </Badge>
                                    )}
                                  </div>
                                  {h.area && <p className="text-sm text-muted-foreground">{h.area}</p>}
                                  {h.why && <p className="text-sm text-muted-foreground"><span className="font-medium">Why we picked it:</span> <span className="italic">{h.why}</span></p>}
                                  {h.price_per_night && (
                                    <p className="text-sm font-medium">
                                      {/\bnight\b/i.test(String(h.price_per_night))
                                        ? h.price_per_night
                                        : `${h.price_per_night}/night`}
                                    </p>
                                  )}
                                </div>
                                {hasUrl && (
                                  <div className="flex flex-col gap-1 sm:items-end sm:shrink-0">
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
                  // Hide events that are today or in the past in the viewer's local calendar.
                  const extrasTypes = ["restaurant", "bar", "experience", "attraction"];
                  const allEventItems = (pkg.events || []).filter((e: any) => !extrasTypes.includes(e.type));
                  const eventItems = allEventItems.filter((e: any) => {
                    const d = toYYYYMMDD(e.date_time);
                    return !d || d >= viewerEventFloorYmd;
                  });
                  const pastCount = allEventItems.length - eventItems.length;
                  return (eventItems.length > 0 || pastCount > 0) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 font-serif text-lg">
                        <Music className="h-5 w-5 text-accent" /> Events
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {pastCount > 0 && (
                        <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground text-center sm:text-left">
                          {pastCount} event{pastCount > 1 ? "s have" : " has"} already passed and {pastCount > 1 ? "are" : "is"} hidden.{" "}
                          <Link to={newTripHref} className="font-medium underline underline-offset-2 hover:text-foreground">
                            Plan a new trip
                          </Link>{" "}
                          to see current shows.
                        </div>
                      )}
                      {eventItems.map((e: any, i: number) => (
                        <div key={`${pkg.tier}-event-${i}-${String(e.name || "").slice(0, 50)}-${e.date_time || ""}`} className="rounded-lg border border-border/50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                              <p className="font-medium">{e.name}</p>
                              {e.venue && <p className="text-sm text-muted-foreground">{e.venue}</p>}
                              {e.date_time && <p className="text-sm text-muted-foreground">{e.date_time}</p>}
                              {e.price_range && <p className="text-sm font-medium">{e.price_range}</p>}
                            </div>
                            {(e.url || (e.link && typeof e.link === "object" && e.link.url)) && (() => {
                              const concertLink = normalizeOutboundLink(e.link || e.url, "concert");
                              const isUnconfirmed = concertLink.link_type === "provider_search" || concertLink.link_type === "manual_fallback";
                              const ticketCta = getTicketOutboundCtaLabel(concertLink.provider);
                              const evDate = extractEventDateIso(e.date_time);
                              const buttonEl = (
                                <Button
                                  size="sm"
                                  variant={isUnconfirmed ? "outline" : "default"}
                                  className="shrink-0"
                                  data-event-url={concertLink.url}
                                  onClick={(ev) => {
                                    const url = (ev.currentTarget as HTMLButtonElement).getAttribute("data-event-url");
                                    if (url) {
                                      trackClick(pkg.tier, "ticket", e.name ?? "Event", url, {
                                        provider: concertLink.provider,
                                        category: concertLink.category,
                                        link_type: concertLink.link_type,
                                        event_date: evDate,
                                      });
                                    }
                                  }}
                                >
                                  {ticketCta} <ExternalLink className="ml-1 h-3 w-3" />
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
                        const golfCta = getGolfOutboundCtaLabel(golfLink.provider);
                        const tripStart = itinerary.start_date
                          ? String(itinerary.start_date).slice(0, 10)
                          : undefined;
                        const buttonEl = (
                          <Button
                            size="sm"
                            variant="default"
                            className="shrink-0"
                            onClick={() => trackClick(pkg.tier, "golf", g.name, golfLink.url, {
                              provider: golfLink.provider,
                              category: golfLink.category,
                              link_type: golfLink.link_type,
                              event_date: tripStart,
                            })}
                          >
                            {golfCta} <ExternalLink className="ml-1 h-3 w-3" />
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
                              <div className="flex flex-col items-end gap-1 max-w-[220px]">
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
