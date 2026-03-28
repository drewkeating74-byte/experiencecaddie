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
import { Hotel, Music, Utensils, ExternalLink, Copy, ArrowLeft, Loader2, Mail, Bookmark, BookmarkCheck, RefreshCw } from "lucide-react";
import { GolfTrustPanel, EventTrustPanel, HotelTrustPanel } from "@/components/TrustPanel";
import { normalizeOutboundLink, getOutboundLinkDisplayLabel } from "@/types/outbound-link";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { fetchSearch } from "@/lib/api/search";
import type { SearchRequest } from "@/lib/api/search";
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
  events?: ResultEventItem[];
  hotels?: ResultHotelItem[];
  lodging?: ResultHotelItem[];
  golf?: ResultGolfItem[];
  extras?: ResultExtra[];
  itinerary?: ResultItineraryDay[];
  estimated_total_usd?: [number, number];
  safety_notes?: string;
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

/** Reconstruct search params from itinerary + result_json for refresh. Prefer itinerary.city where available.
 * Dates: itinerary.start_date/end_date first; fallback to result_json event date_time when itinerary dates missing. */
function deriveSearchParams(itinerary: ItineraryRow | null, result_json: ResultJson | null): SearchRequest | null {
  let start = toYYYYMMDD(itinerary?.start_date);
  let end = toYYYYMMDD(itinerary?.end_date);

  // Fallback: derive from result_json event date_time when itinerary dates are missing (e.g. legacy data)
  if ((!start || !end) && result_json?.packages?.length) {
    const dates: string[] = [];
    for (const pkg of result_json.packages) {
      for (const evt of pkg.events ?? []) {
        const d = toYYYYMMDD(evt.date_time);
        if (d) dates.push(d);
      }
    }
    if (dates.length > 0) {
      dates.sort();
      if (!start) start = dates[0];
      if (!end) end = dates[dates.length - 1];
      if (start === end && start) {
        const d = new Date(start);
        d.setDate(d.getDate() + 2);
        end = d.toISOString().slice(0, 10);
      }
    }
  }
  if (!start || !end) return null;

  const prefs = (itinerary?.preferences ?? {}) as Record<string, unknown>;
  const pkgs = result_json?.packages ?? [];
  const firstEvent = pkgs[0]?.events?.[0];
  // venue may be a string or an object — extract city/state only when it's an object
  const firstVenue = firstEvent?.venue && typeof firstEvent.venue === "object" ? firstEvent.venue : undefined;
  const venueCity = firstVenue?.city;
  const venueState = firstVenue?.state;

  let artist: string | undefined;
  let city: string;

  if (itinerary?.city === "flexible" || prefs.flexible_location) {
    // Flow 3: Flexible — no artist; city from first event venue or Austin only when no better fallback
    artist = undefined;
    city = venueCity?.trim() || "Austin"; // Explicit fallback: no venue city in result
  } else if (firstEvent && pkgs.every((p) => p.events?.[0]?.name === firstEvent.name)) {
    // Flow 2: Discover (same event across packages)
    artist = firstEvent.name;
    city = venueCity?.trim() || itinerary?.city || "Austin";
  } else {
    // Flow 1: Artist + city — prefer itinerary.city
    const ed = (itinerary?.event_details ?? "").trim();
    artist = ed && ed.length < 80 && !ed.toLowerCase().startsWith("genres:") ? ed : undefined;
    city = itinerary?.city?.trim() || venueCity?.trim() || "Austin"; // itinerary.city first per plan
  }

  return {
    artist,
    destination: { city: city || "Austin", state: venueState },
    dates: { start_date: start, end_date: end },
    group_size: itinerary?.group_size ?? 2,
    budget_tier: (itinerary?.budget_tier as "low" | "mid" | "high") ?? "mid",
  };
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
  const [refreshing, setRefreshing] = useState(false);

  // Auto-open the share-email dialog when returning from auth with ?open=share-email
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("open") === "share-email" && user) {
      setShareEmailOpen(true);
      // Remove the param from the URL so refreshing doesn't re-open it
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
    meta?: { provider?: string; category?: string; link_type?: string }
  ) => {
    if (!user) {
      // Save the intended link so it auto-opens after the user signs in.
      sessionStorage.setItem("post_auth_link", url);
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

  const handleRefresh = async () => {
    const params = deriveSearchParams(itinerary, itinerary?.result_json);
    if (!params) {
      toast.error("Cannot refresh: no dates found. Dates come from the itinerary or from event dates in the trip.");
      return;
    }
    setRefreshing(true);
    toast.loading("Refreshing prices and availability…", { id: "refresh" });
    try {
      const searchRes = await fetchSearch(params);
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        toast.error("App configuration error. Please try again later.", { id: "refresh" });
        setRefreshing(false);
        return;
      }
      const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({
          itinerary_id: itinerary.id,
          payload: {
            search_results: {
              events: searchRes.events,
              golf_courses: searchRes.golf_courses,
              hotels: searchRes.hotels,
              bronze_golf_candidates: searchRes.bronze_golf_candidates,
              silver_golf_candidates: searchRes.silver_golf_candidates,
              gold_golf_candidates: searchRes.gold_golf_candidates,
            },
          },
        }),
      });
      const genData = await genRes.json().catch(() => ({}));
      if (!genRes.ok) {
        const errMsg = genData?.error || `Refresh failed (${genRes.status})`;
        toast.error(errMsg, { id: "refresh" });
        setRefreshing(false);
        return;
      }
      // Refetch itinerary (same pattern as initial load)
      const slug = itinerary.share_slug || itinerary.id;
      const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      const slugRes = await fetch(`${supabaseUrl}/rest/v1/itineraries?select=${encodeURIComponent(safeColumns)}&share_slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers });
      const slugRows = await slugRes.json();
      const rows = slugRows?.length > 0 ? slugRows : await (await fetch(`${supabaseUrl}/rest/v1/itineraries?select=${encodeURIComponent(safeColumns)}&id=eq.${encodeURIComponent(itinerary.id)}&limit=1`, { headers })).json();
      if (rows?.length > 0) {
        setItinerary(rows[0]);
      } else if (genData?.result) {
        // Fallback: backend succeeded but refetch failed — update from response
        setItinerary((prev) => prev ? { ...prev, result_json: genData.result, updated_at: new Date().toISOString() } : prev);
      }
      toast.success("Refresh complete", { id: "refresh" });
    } catch (e: any) {
      const msg = e?.message || "Refresh failed";
      const isNetworkError = msg === "Failed to fetch" || msg === "Load failed" || msg?.includes("NetworkError");
      toast.error(isNetworkError ? "Could not reach the server. Check your connection and try again." : msg, { id: "refresh" });
    } finally {
      setRefreshing(false);
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

  const result = itinerary.result_json as unknown as ResultJson | null;
  if (!result) return <div className="container mx-auto px-4 py-16 text-center">No results yet</div>;

  const summary = result.summary;
  const packages = result.packages ?? [];

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
            onClick={() => (user ? setShareEmailOpen(true) : navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + "?open=share-email")}`))}
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

      {/* Generated date + Refresh + combined trust disclosure */}
      <div className="mb-6 text-center space-y-2">
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <p className="text-sm font-semibold">
            Generated {formatGeneratedAt(itinerary.updated_at)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
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
                              const isUnconfirmed = concertLink.link_type === "provider_search" || concertLink.link_type === "manual_fallback";
                              const buttonEl = (
                                <Button
                                  size="sm"
                                  variant={isUnconfirmed ? "outline" : "default"}
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
                          {(() => {
                            const concertLink = normalizeOutboundLink(e.link || e.url, "concert");
                            const isUnconfirmed = concertLink.link_type === "provider_search" || concertLink.link_type === "manual_fallback";
                            return isUnconfirmed ? (
                              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                                ⚠ No confirmed tour date found — use the search link to check for upcoming announcements.
                              </p>
                            ) : null;
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
