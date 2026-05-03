import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Music, Search, Sparkles, ArrowRight, ArrowLeft, Loader2, MapPin, Calendar, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { fetchSearch, buildFallbackSearchResponse } from "@/lib/api/search";
import { addMonthsToYmd, getBrowserTimeZone, minTripStartYmdForTimezone } from "@/lib/tripWindow";
import { normalizeOutboundLink } from "@/types/outbound-link";
import { buildTicketUrl, getTicketOutboundCtaLabel } from "@/lib/outboundLinks";
import { formatUsDate } from "@/lib/dateFormat";



type EntryOption = "artist" | "find_concert" | "surprise";
type BudgetTier = "low" | "mid" | "high";

// Supported metro cities — used for city autocomplete suggestions.
// Primary city name is first in each group; alternate names map to the same metro.
const METRO_SUGGESTIONS = [
  { display: "Las Vegas, NV", city: "Las Vegas" },
  { display: "Phoenix / Scottsdale, AZ", city: "Phoenix" },
  { display: "Dallas–Fort Worth, TX", city: "Dallas" },
  { display: "Austin, TX", city: "Austin" },
  { display: "Nashville, TN", city: "Nashville" },
  { display: "Atlanta, GA", city: "Atlanta" },
  { display: "Charlotte, NC", city: "Charlotte" },
  { display: "Tampa / St. Petersburg, FL", city: "Tampa" },
  { display: "Miami / Fort Lauderdale, FL", city: "Miami" },
  { display: "San Diego, CA", city: "San Diego" },
  { display: "Los Angeles, CA", city: "Los Angeles" },
  { display: "San Francisco Bay Area, CA", city: "San Francisco" },
  { display: "Denver, CO", city: "Denver" },
  { display: "Seattle, WA", city: "Seattle" },
  { display: "Chicago, IL", city: "Chicago" },
  { display: "New Orleans, LA", city: "New Orleans" },
  { display: "Boston, MA", city: "Boston" },
  { display: "Philadelphia, PA", city: "Philadelphia" },
  { display: "Detroit, MI", city: "Detroit" },
  { display: "Cleveland, OH", city: "Cleveland" },
];

type ConcertOption = { id?: string; artist: string; city: string; venue: string; date: string; url?: string };

const ENTRY_OPTIONS = [
  {
    id: "artist" as EntryOption,
    icon: Music,
    label: "I already know who I want to see",
    description: "We'll match their tour dates with great public courses nearby",
  },
  {
    id: "find_concert" as EntryOption,
    icon: Search,
    label: "Show me the best upcoming shows",
    description: "We'll suggest high-demand events in great golf cities",
  },
  {
    id: "surprise" as EntryOption,
    icon: Sparkles,
    label: "I'm flexible — show me something great",
    description: "We'll build a strong weekend based on timing, travel flow, and course quality",
  },
];

const GENRES = [
  "Country", "Rock", "Hip-Hop / Rap", "Pop", "R&B / Soul", "EDM", "Latin", "Jazz / Blues",
];

export default function ExperienceBuilder() {
  const [step, setStep] = useState<"start" | "details">("start");
  const [selectedEntry, setSelectedEntry] = useState<EntryOption | null>(null);
  const [eventInput, setEventInput] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  // Details
  const [flexibleLocation, setFlexibleLocation] = useState(true);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityInput, setCityInput] = useState("");
  const [flexibleDates, setFlexibleDates] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState<BudgetTier>("mid");
  const [groupSize, setGroupSize] = useState(2);
  // If coming from a featured package card (?auto=1), show the loading screen immediately
  // so the user never sees the blank form before generation starts.
  const [generating, setGenerating] = useState(
    () => new URLSearchParams(window.location.search).get("auto") === "1"
  );

  // Two-step flow: discover concerts → user picks → build full itinerary
  const [discoveryStep, setDiscoveryStep] = useState<"form" | "discovering" | "pick" | "building" | "no_results">("form");
  const [concertOptions, setConcertOptions] = useState<ConcertOption[]>([]);
  const [refreshingConcerts, setRefreshingConcerts] = useState(false);
  const [savedParams, setSavedParams] = useState<{ finalCity: string; finalStart: string; finalEnd: string; budget: BudgetTier; groupSize: number; eventDetails: string } | null>(null);

  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Guards against firing the auto-submit more than once per navigation
  const autoSubmitFiredRef = useRef(false);
  // When true, handleGenerate skips the discover_concerts step (used for featured package cards)
  const skipDiscoveryRef = useRef(false);
  /** From /packages or homepage cards (?event_date= / ?venue=) — locks itinerary to that show. */
  const [urlPackageEventDate, setUrlPackageEventDate] = useState("");
  const [urlPackageVenue, setUrlPackageVenue] = useState("");

  // Prefill "New Trip" context when returning from an itinerary page.
  // This avoids forcing users to go back through the entire start flow.
  useEffect(() => {
    const params = new URLSearchParams(location.search);

    const cityParam = params.get("city") ?? "";
    const startParam = params.get("start_date") ?? "";
    const endParam = params.get("end_date") ?? "";
    const budgetParam = params.get("budget_tier") ?? "mid";
    const groupSizeParamRaw = params.get("group_size") ?? "2";
    const eventDetailsParam = params.get("event_details") ?? "";
    const eventDateParam = params.get("event_date") ?? "";
    const venueParam = params.get("venue") ?? "";

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const validBudgets = ["low", "mid", "high"] as const;

    // Gate: require dates + event_details (for intent), but city can be missing or "flexible".
    const hasCore =
      dateRegex.test(startParam) &&
      dateRegex.test(endParam) &&
      eventDetailsParam.trim().length > 0;

    if (!hasCore) {
      setUrlPackageEventDate("");
      setUrlPackageVenue("");
      return;
    }

    setUrlPackageEventDate(dateRegex.test(eventDateParam) ? eventDateParam : "");
    setUrlPackageVenue(venueParam.trim().slice(0, 200));

    const cityNormalized = cityParam.trim();
    const isFlexibleCity = !cityNormalized || cityNormalized.toLowerCase() === "flexible";

    const tz = getBrowserTimeZone();
    const minStartStr = minTripStartYmdForTimezone(tz);
    const defaultEndStr = addMonthsToYmd(minStartStr, 9);
    const useUrlDates = startParam >= minStartStr && endParam > startParam;
    const resolvedStart = useUrlDates ? startParam : minStartStr;
    const resolvedEnd = useUrlDates ? endParam : defaultEndStr;

    // Restore to the trip fine-tuning screen with the most relevant intent preserved.
    setStep("details");

    setFlexibleLocation(isFlexibleCity);   // true = no specific city; false = city is set
    if (!isFlexibleCity && cityNormalized) setSelectedCities([cityNormalized]);

    setFlexibleDates(!useUrlDates);
    setStartDate(resolvedStart);
    setEndDate(resolvedEnd);

    if ((validBudgets as readonly string[]).includes(budgetParam)) {
      setBudget(budgetParam as BudgetTier);
    }

    const groupSizeParsed = Number(groupSizeParamRaw);
    const groupSizeValid = Number.isFinite(groupSizeParsed) && groupSizeParsed >= 1 && groupSizeParsed <= 20;
    if (groupSizeValid) setGroupSize(groupSizeParsed);

    const parseGenresFromEventDetails = (ed: string): string[] => {
      // Expected patterns:
      // - "discover for me — genres: Country, Rock"
      // - "surprise me — concert — genres: EDM, Pop"
      const match = ed.match(/genres:\s*(.+)$/i);
      const raw = match?.[1]?.trim();
      if (!raw || raw.toLowerCase() === "any") return [];
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    };

    const lower = eventDetailsParam.toLowerCase();
    if (lower.startsWith("discover for me")) {
      setSelectedEntry("find_concert");
      setSelectedGenres(parseGenresFromEventDetails(eventDetailsParam));
      setEventInput("");
      return;
    }

    if (lower.startsWith("surprise me")) {
      setSelectedEntry("surprise");
      setSelectedGenres(parseGenresFromEventDetails(eventDetailsParam));
      setEventInput("");
      return;
    }

    // Default: artist flow uses raw user input as event_details.
    setSelectedEntry("artist");
    setEventInput(eventDetailsParam);
    setSelectedGenres([]);
  }, [location.search]);

  // Auto-submit: when ?auto=1 is present and the pre-fill effect has populated state,
  // kick off generation immediately so the user lands on ItineraryResults.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("auto") !== "1") return;
    if (autoSubmitFiredRef.current) return;
    // Wait until the pre-fill effect has set a valid entry + input
    if (step !== "details") return;
    if (!selectedEntry) return;
    if (selectedEntry === "artist" && !eventInput.trim()) return;

    autoSubmitFiredRef.current = true;
    skipDiscoveryRef.current = true; // go straight to generation — we know artist + city already
    // Small tick so all batched state is committed before the generator reads it
    const timer = setTimeout(() => handleGenerate(), 50);
    return () => clearTimeout(timer);
    // handleGenerate reads component state via closure; we intentionally omit it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // from deps to avoid stale-closure warnings — the 50 ms delay guarantees
    // the state snapshot is current by the time it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedEntry, eventInput, location.search]);

  // Global Enter key shortcut — advances the form from any step without requiring
  // the user to click a button first. Skips when focus is inside a text input/textarea
  // so typing doesn't accidentally submit.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isTyping = tag === "textarea" || (tag === "input" && (e.target as HTMLInputElement).type !== "checkbox" && (e.target as HTMLInputElement).type !== "radio");
      if (isTyping) return;
      if (e.defaultPrevented) return;
      if (step === "start" && selectedEntry) {
        e.preventDefault();
        handleContinue();
      } else if (step === "details" && !generating && discoveryStep === "form") {
        e.preventDefault();
        handleGenerate();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedEntry, generating, discoveryStep]);

  const getEventDetails = () => {
    if (selectedEntry === "artist") return eventInput;
    if (selectedEntry === "find_concert") return `discover for me — genres: ${selectedGenres.length ? selectedGenres.join(", ") : "any"}`;
    const genreStr = selectedGenres.length ? ` — genres: ${selectedGenres.join(", ")}` : "";
    return `surprise me — concert${genreStr}`;
  };

  const sortConcertOptionsByDate = (opts: ConcertOption[]) =>
    [...opts].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const optionIds = (opts: ConcertOption[]) => {
    const ids: string[] = [];
    for (const opt of opts) {
      if (opt.id) ids.push(opt.id);
    }
    return ids;
  };

  const getErrorName = (err: unknown) =>
    err && typeof err === "object" && "name" in err ? String((err as { name?: unknown }).name || "") : "";

  const getErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === "object" && "message" in err ? String((err as { message?: unknown }).message || fallback) : fallback;

  const discoverConcertOptions = async (params: {
    finalCity: string;
    finalStart: string;
    finalEnd: string;
    eventDetails: string;
    clientTz: string;
    excludeEventIds?: string[];
  }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const discRes = await fetch(`${supabaseUrl}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          payload: {
            discover_concerts: true,
            start_date: params.finalStart,
            end_date: params.finalEnd,
            city: params.finalCity,
            event_details: params.eventDetails.slice(0, 500),
            artist_search: selectedEntry === "artist" ? eventInput.trim().slice(0, 200) : null,
            client_timezone: params.clientTz,
            exclude_event_ids: params.excludeEventIds ?? [],
          },
        }),
        signal: controller.signal,
      });

      let discData: Record<string, unknown> = {};
      try {
        const text = await discRes.text();
        discData = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(discRes.ok ? "Invalid response" : `Server error (${discRes.status})`);
      }
      const errMsg = (discData?.error || discData?.message) as string | undefined;
      if (!discRes.ok || errMsg) {
        throw new Error((errMsg as string) || `Concert discovery failed (${discRes.status})`);
      }
      return sortConcertOptionsByDate(((discData.concert_options || []) as ConcertOption[]));
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const handleRefreshConcertOptions = async () => {
    if (!savedParams || refreshingConcerts) return;
    setRefreshingConcerts(true);
    try {
      const currentIds = new Set(optionIds(concertOptions));
      const nextOptions = await discoverConcertOptions({
        finalCity: savedParams.finalCity,
        finalStart: savedParams.finalStart,
        finalEnd: savedParams.finalEnd,
        eventDetails: savedParams.eventDetails,
        clientTz: getBrowserTimeZone(),
        excludeEventIds: Array.from(currentIds),
      });
      if (!nextOptions.length) {
        toast.error("No different concerts found yet. Try a broader genre or date range.");
        return;
      }
      const unseenOptions = nextOptions.filter((opt) => !opt.id || !currentIds.has(opt.id));
      if (!unseenOptions.length && currentIds.size > 0) {
        toast.error("No new concerts found yet. Try a broader genre or date range.");
        return;
      }
      setConcertOptions(nextOptions);
      toast.success("Refreshed concert options");
    } catch (err: unknown) {
      const isAbort = getErrorName(err) === "AbortError";
      const msg = isAbort ? "Request timed out. Keep the tab open and try again." : getErrorMessage(err, "Failed to refresh concerts");
      toast.error(msg);
    } finally {
      setRefreshingConcerts(false);
    }
  };

  const handleBuildFromConcert = async (concert: ConcertOption) => {
    if (!savedParams) return;
    setDiscoveryStep("building");
    setGenerating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const searchRequest = {
        artist: concert.artist?.trim(),
        destination: { city: concert.city },
        dates: { start_date: savedParams.finalStart, end_date: savedParams.finalEnd },
        group_size: Math.min(Math.max(savedParams.groupSize, 1), 20),
        budget_tier: savedParams.budget,
        client_timezone: getBrowserTimeZone(),
      };
      let searchResult;
      try {
        searchResult = await fetchSearch(searchRequest);
      } catch (searchErr) {
        console.warn("Search API unavailable, using fallback data:", searchErr);
        toast.error("Live venue data unavailable — using placeholder results. Please try again.");
        searchResult = buildFallbackSearchResponse(searchRequest);
      }
      const payload = {
        user_id: user?.id || null,
        path: "golf_music",
        city: concert.city,
        start_date: savedParams.finalStart,
        end_date: savedParams.finalEnd,
        budget_tier: savedParams.budget,
        group_size: Math.min(Math.max(savedParams.groupSize, 1), 20),
        preferences: { flexible_location: false, flexible_dates: false },
        event_details: savedParams.eventDetails,
        search_results: {
          events: searchResult.events?.slice(0, 6) || [],
          golf_courses: searchResult.golf_courses?.slice(0, 12) || [],
          bronze_golf_candidates: searchResult.bronze_golf_candidates,
          silver_golf_candidates: searchResult.silver_golf_candidates,
          gold_golf_candidates: searchResult.gold_golf_candidates,
          hotels: searchResult.hotels?.slice(0, 6) || [],
        },
        selected_concert: concert,
        email: user?.email || null,
        client_timezone: getBrowserTimeZone(),
      };
      const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ payload }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      let genData: Record<string, unknown> = {};
      try {
        const text = await genRes.text();
        genData = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(genRes.ok ? "Invalid response" : `Server error (${genRes.status})`);
      }
      const errMsg = (genData?.error || genData?.message) as string | undefined;
      if (!genRes.ok || errMsg) {
        throw new Error((errMsg as string) || `Generation failed (${genRes.status})`);
      }
      const slug = genData.share_slug as string;
      if (!slug) throw new Error("Missing share link");
      navigate(`/share/${slug}`);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = getErrorName(err) === "AbortError";
      let msg = getErrorMessage(err, "Failed to generate");
      if (isAbort) msg = "Request timed out. Keep the tab open and try again.";
      else if (msg?.includes("Failed to fetch") || msg?.includes("NetworkError")) msg = "Could not reach server. Check your connection.";
      toast.error(msg);
      setDiscoveryStep("pick");
      setGenerating(false);
    }
  };

  const handleContinue = () => {
    if (!selectedEntry) {
      toast.error("Pick an option to get started");
      return;
    }
    if (selectedEntry === "artist" && !eventInput.trim()) {
      toast.error("Enter an artist or band name");
      return;
    }
    setStep("details");
  };

  const handleGenerate = async () => {
    // Non-blocking funnel event
    logEvent({
      event_type: "package_generate_click",
      metro_slug: selectedCities.length > 0 ? selectedCities[0].trim().toLowerCase().replace(/[\s,]+/g, "-") : "flexible",
      artist_name: selectedEntry === "artist" ? eventInput.trim() || undefined : undefined,
      context: "planner_result",
      extra: { entry_type: selectedEntry, budget },
    });

    if (!flexibleLocation && selectedCities.length === 0) {
      toast.error("Enter a city or switch to flexible location");
      setGenerating(false);
      return;
    }
    if (!flexibleDates && (!startDate || !endDate)) {
      toast.error("Enter dates or switch to flexible dates");
      setGenerating(false);
      return;
    }

    // Client-side input validation
    // Build effective city: comma-separated list of selected cities, or "flexible"
    const trimmedCity = flexibleLocation || selectedCities.length === 0
      ? "flexible"
      : selectedCities.join(", ");
    if (groupSize < 1 || groupSize > 20) {
      toast.error("Group size must be between 1 and 20");
      setGenerating(false);
      return;
    }
    const validBudgets = ["low", "mid", "high"];
    if (!validBudgets.includes(budget)) {
      toast.error("Invalid budget selection");
      setGenerating(false);
      return;
    }

    const finalCity = trimmedCity;
    const clientTz = getBrowserTimeZone();
    let finalStart: string;
    let finalEnd: string;
    if (flexibleDates) {
      finalStart = minTripStartYmdForTimezone(clientTz);
      finalEnd = addMonthsToYmd(finalStart, 9);
    } else {
      finalStart = startDate;
      finalEnd = endDate;
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(finalStart) || !dateRegex.test(finalEnd)) {
      toast.error("Invalid date format");
      setGenerating(false);
      return;
    }

    const minStartStr = minTripStartYmdForTimezone(clientTz);
    if (finalStart < minStartStr) {
      toast.error("Start date must be at least 14 days from today in your time zone. Try flexible dates for automatic scheduling.");
      setGenerating(false);
      return;
    }
    if (finalEnd <= finalStart) {
      toast.error("End date must be after start date");
      setGenerating(false);
      return;
    }

    // Skip concert discovery when we already have both an artist name and a specific city.
    // Discovery is only useful when one of those is unknown (e.g. "surprise me" or flexible location).
    const artistAndCityKnown =
      selectedEntry === "artist" &&
      eventInput.trim().length > 0 &&
      !flexibleLocation &&
      finalCity.toLowerCase() !== "flexible";
    const useDiscoveryFlow =
      !skipDiscoveryRef.current &&
      !artistAndCityKnown &&
      (selectedEntry === "find_concert" || selectedEntry === "surprise" || selectedEntry === "artist");
    skipDiscoveryRef.current = false; // consume the flag
    const eventDetails = getEventDetails();

    if (useDiscoveryFlow && discoveryStep === "form") {
      // Stage 1: discover a short list of verified concerts before building the trip.
      setDiscoveryStep("discovering");
      try {
        const opts = await discoverConcertOptions({
          finalCity,
          finalStart,
          finalEnd,
          eventDetails,
          clientTz,
        });
        if (!opts.length) {
          logEvent({ event_type: "no_results_shown", artist_name: eventInput.trim() || undefined, context: "planner_result" });
          setDiscoveryStep("no_results");
          return;
        }
        setConcertOptions(opts);
        setSavedParams({ finalCity, finalStart, finalEnd, budget, groupSize, eventDetails });
        setDiscoveryStep("pick");
      } catch (err: unknown) {
        const isAbort = getErrorName(err) === "AbortError";
        const msg = getErrorMessage(err, "Failed to find concerts");
        const isTransient = isAbort || msg?.includes("Failed to fetch") || msg?.includes("NetworkError") || msg?.includes("404");
        if (isTransient) {
          toast.error(isAbort ? "Request timed out. Keep the tab open and try again." : msg);
          setDiscoveryStep("form");
        } else {
          logEvent({
            event_type: "no_results_shown",
            artist_name: eventInput.trim() || undefined,
            metro_slug: !flexibleLocation && selectedCities.length > 0
              ? selectedCities[0].trim().toLowerCase().replace(/[\s,]+/g, "-")
              : undefined,
            context: "planner_result",
            extra: {
              city: flexibleLocation ? undefined : selectedCities.join(", ") || undefined,
              start_date: startDate || undefined,
              end_date: endDate || undefined,
              entry_mode: selectedEntry ?? undefined,
              error: msg,
            },
          });
          setDiscoveryStep("no_results");
        }
      }
      return;
    }

    setGenerating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      console.log("Starting itinerary generation...");
      const eventDetails = getEventDetails();
      const hasArtist = selectedEntry === "artist" && eventInput?.trim();
      const hasCity = finalCity !== "flexible";
      // For flexible/broad discovery: use Austin as default city so we get real TM + golf instead of mock-only
      const searchCity = hasCity ? finalCity : "Austin";
      const searchRequest = {
        artist: hasArtist ? eventInput.trim() : undefined,
        destination: { city: searchCity },
        dates: { start_date: finalStart, end_date: finalEnd },
        group_size: Math.min(Math.max(groupSize, 1), 20),
        budget_tier: budget,
        client_timezone: clientTz,
      };
      let searchResult;
      try {
        searchResult = await fetchSearch(searchRequest);
      } catch (searchErr) {
        console.warn("Search API unavailable, using fallback data:", searchErr);
        toast.error("Live venue data unavailable — using placeholder results. Please try again.");
        searchResult = buildFallbackSearchResponse(searchRequest);
      }
      const search_results = {
        events: searchResult.events?.slice(0, 6) || [],
        golf_courses: searchResult.golf_courses?.slice(0, 12) || [],
        bronze_golf_candidates: searchResult.bronze_golf_candidates,
        silver_golf_candidates: searchResult.silver_golf_candidates,
        gold_golf_candidates: searchResult.gold_golf_candidates,
        hotels: searchResult.hotels?.slice(0, 6) || [],
      };
      const packageConcertCity =
        !flexibleLocation && selectedCities.length > 0 ? selectedCities[0].trim() : "";
      const selectedConcertFromCard =
        urlPackageEventDate &&
        dateRegex.test(urlPackageEventDate) &&
        selectedEntry === "artist" &&
        eventInput.trim().length > 0 &&
        packageConcertCity
          ? {
              artist: eventInput.trim(),
              city: packageConcertCity,
              date: urlPackageEventDate,
              ...(urlPackageVenue.trim() ? { venue: urlPackageVenue.trim() } : {}),
            }
          : null;

      const payload = {
        user_id: user?.id || null,
        path: "golf_music",
        city: finalCity,
        start_date: finalStart,
        end_date: finalEnd,
        budget_tier: budget,
        group_size: Math.min(Math.max(groupSize, 1), 20),
        preferences: { flexible_location: flexibleLocation, flexible_dates: flexibleDates },
        event_details: typeof eventDetails === "string" ? eventDetails.slice(0, 1000) : null,
        search_results,
        email: user?.email || null,
        client_timezone: clientTz,
        ...(selectedConcertFromCard ? { selected_concert: selectedConcertFromCard } : {}),
      };
      if (import.meta.env.DEV) {
        console.log("Payload (sanitized):", { ...payload, user_id: "[REDACTED]", email: "[REDACTED]", search_results: search_results ? "[INCLUDED]" : undefined });
      }

      // Send everything to the edge function — it handles insert + generation
      const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ payload }),
        signal: controller.signal,
      });

      const genData = await genRes.json();
      if (import.meta.env.DEV) {
        console.log("Generation response:", genRes.status);
      }

      if (!genRes.ok || genData?.error) {
        throw new Error(genData?.error || `Generation failed (${genRes.status})`);
      }

      navigate(`/share/${genData.share_slug}`);
    } catch (err: unknown) {
      console.error("Generation error:", err);
      const isAbort = getErrorName(err) === "AbortError";
      toast.error(isAbort ? "Request timed out. Please try again and keep the tab open." : getErrorMessage(err, "Failed to generate itinerary"));
      setGenerating(false);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  if (discoveryStep === "no_results") {
    const artistName = selectedEntry === "artist" ? eventInput.trim() : null;
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <div className="flex flex-col items-center text-center gap-6">
          <div className="rounded-full bg-muted p-4">
            <Music className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h2 className="font-serif text-2xl font-bold">
              {artistName
                ? `No verified package for ${artistName} right now`
                : "No verified packages found"}
            </h2>
            <p className="text-muted-foreground max-w-md">
              We only list shows we can match in Ticketmaster across our supported golf metros, 14+ days out.{" "}
              {artistName
                ? `${artistName} may have no upcoming stop in those cities in this window, or shows may not be listed yet.`
                : "Try different genres, dates, or cities — or pick a specific artist and city you know is on sale."}
            </p>
          </div>

          {/* Primary: current packages; supporting: new search paths */}
          <div className="w-full max-w-sm space-y-3">
            <Button
              size="lg"
              className="w-full rounded-full h-12 text-base shadow-sm"
              onClick={() => {
                logEvent({ event_type: "browse_current_packages_clicked", artist_name: artistName ?? undefined, context: "planner_result" });
                navigate("/packages");
              }}
            >
              <ArrowRight className="mr-2 h-4 w-4" /> Browse current verified packages
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-full h-11"
              onClick={() => {
                logEvent({ event_type: "alternative_search_clicked", artist_name: artistName ?? undefined, context: "planner_result" });
                setDiscoveryStep("form");
                setEventInput("");
              }}
            >
              <Search className="mr-2 h-4 w-4" /> Try a different artist
            </Button>
            <Button
              variant="secondary"
              className="w-full rounded-full h-11"
              onClick={() => {
                logEvent({ event_type: "alternative_search_clicked", artist_name: artistName ?? undefined, extra: { action: "explore_cities" }, context: "planner_result" });
                setDiscoveryStep("form");
                setSelectedEntry("find_concert");
                setEventInput("");
              }}
            >
              <MapPin className="mr-2 h-4 w-4" /> Explore available cities this month
            </Button>
          </div>

          <p className="text-xs text-muted-foreground max-w-xs">
            New packages are added as confirmed tour dates are announced. We never show speculative or unconfirmed availability.
          </p>
        </div>
      </div>
    );
  }

  if (discoveryStep === "discovering") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <div className="text-center">
          <h2 className="font-serif text-2xl font-bold">Finding the best concerts...</h2>
          <p className="mt-2 text-muted-foreground">Looking for 5,000+ capacity venues in great golf cities</p>
        </div>
      </div>
    );
  }

  if (discoveryStep === "pick" && concertOptions.length) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <div className="space-y-6">
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                setDiscoveryStep("form");
                setConcertOptions([]);
                setSavedParams(null);
              }}
              className="mb-4"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-serif text-2xl font-bold">Pick your concert</h2>
                <p className="mt-1 text-muted-foreground">We&apos;ll build golf + hotel around your choice</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full"
                onClick={handleRefreshConcertOptions}
                disabled={refreshingConcerts || generating}
              >
                {refreshingConcerts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Show different options
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {concertOptions.map((opt, i) => (
              <Card key={i} className="overflow-hidden border-border/50 hover:border-primary/30 transition-all">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-lg">{opt.artist}</h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3.5 w-3 shrink-0" />
                        {opt.venue} · {opt.city}
                      </p>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3.5 w-3 shrink-0" />
                        {formatUsDate(opt.date)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0 rounded-full"
                      onClick={() => handleBuildFromConcert(opt)}
                      disabled={generating}
                    >
                      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Build my trip"}
                    </Button>
                  </div>
                  {(opt.url || (opt as { link?: { url?: string } }).link?.url) && (() => {
                    const raw = normalizeOutboundLink((opt as { link?: { url: string }; url?: string }).link || opt.url, "concert");
                    const t = buildTicketUrl({
                      context: "planner_result",
                      url: raw.url,
                      provider: raw.provider,
                    });
                    return (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary mt-2 inline-block hover:underline"
                        onClick={() =>
                          logEvent({
                            event_type: "ticket_link_clicked",
                            artist_name: opt.artist,
                            metro_slug: opt.city
                              ? opt.city.toLowerCase().replace(/[\s,]+/g, "-")
                              : undefined,
                            context: "planner_result",
                            extra: {
                              category: "ticket",
                              provider: t.provider,
                              target_url: t.url,
                              destination: t.provider,
                              city: opt.city,
                              event_date: opt.date,
                              label: getTicketOutboundCtaLabel(t.provider),
                            },
                          })
                        }
                      >
                        {getTicketOutboundCtaLabel(t.provider)}
                      </a>
                    );
                  })()}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (generating) {
    const isAutoPackage = new URLSearchParams(location.search).get("auto") === "1";
    const artistLabel = eventInput.trim() || new URLSearchParams(location.search).get("event_details") || "";
    const cityLabel = selectedCities[0] || new URLSearchParams(location.search).get("city") || "";
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <div className="text-center">
          <h2 className="font-serif text-2xl font-bold">
            {isAutoPackage && artistLabel
              ? `Building your ${artistLabel} weekend${cityLabel ? ` in ${cityLabel}` : ""}…`
              : "Crafting Your Legendary Weekend..."}
          </h2>
          <p className="mt-2 text-muted-foreground">Finding the best hotels, golf, and concert options for you</p>
          <p className="mt-1 text-xs text-muted-foreground">This usually takes 30–60 seconds</p>
          <p className="mt-1 text-xs text-muted-foreground">On mobile: keep this tab open and the screen on</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => { setGenerating(false); autoSubmitFiredRef.current = false; skipDiscoveryRef.current = false; }}
          className="mt-4 text-muted-foreground"
        >
          Cancel & try again
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      {step === "start" && (
        <form
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault();
            handleContinue();
          }}
        >
          <div className="text-center">
            <h1 className="font-serif text-4xl font-bold">Start Your Experience</h1>
            <p className="mt-3 text-muted-foreground">
              Choose your starting point. We'll curate the rest.
            </p>
          </div>

          <div className="space-y-3">
            {ENTRY_OPTIONS.map((opt) => {
              const isSelected = selectedEntry === opt.id;
              return (
                <Card
                  key={opt.id}
                  className={`cursor-pointer border transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/50 hover:border-primary/20"
                  }`}
                  onClick={() => {
                    setSelectedEntry(opt.id);
                    setEventInput("");
                  }}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <opt.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium">{opt.label}</h3>
                      <p className="text-sm text-muted-foreground">{opt.description}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Inline input for artist */}
          {selectedEntry === "artist" && (
            <div className="space-y-2 animate-fade-in">
              <Label htmlFor="artist-input">Who do you want to see?</Label>
              <Input
                id="artist-input"
                placeholder="e.g. Morgan Wallen, Kendrick Lamar, The Killers"
                value={eventInput}
                onChange={(e) => setEventInput(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {selectedEntry === "find_concert" && (
            <div className="space-y-3 animate-fade-in">
              <Label>What kind of music are you into?</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GENRES.map((genre) => {
                  const active = selectedGenres.includes(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() =>
                        setSelectedGenres((prev) =>
                          active ? prev.filter((g) => g !== genre) : [...prev, genre]
                        )
                      }
                      className={`rounded-full border px-4 py-2.5 sm:py-1.5 text-sm transition-all min-h-[44px] sm:min-h-0 ${
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      {genre}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Pick as many as you like, or skip to see everything.</p>
            </div>
          )}

          <div className="flex justify-center pt-2">
            <Button
              type="submit"
              disabled={!selectedEntry}
              size="lg"
              className="rounded-full px-8 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </form>
      )}

      {step === "details" && (
        <form
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault();
            handleGenerate();
          }}
        >
          <div>
            <Button type="button" variant="ghost" onClick={() => setStep("start")} className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <h2 className="font-serif text-2xl font-bold">Fine-tune your trip</h2>
            <p className="mt-1 text-muted-foreground">
              Everything here is optional — we'll work with whatever you give us.
            </p>
            {selectedEntry === "artist" && eventInput.trim() && (
              <div className="mt-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">Looking for:</span>{" "}
                  <span className="font-semibold text-foreground">{eventInput.trim()}</span>
                </p>
              </div>
            )}
            {selectedEntry === "find_concert" && (
              <div className="mt-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">Mode:</span>{" "}
                  <span className="font-semibold text-foreground">Discover shows</span>
                  {selectedGenres.length > 0 ? (
                    <span className="text-muted-foreground">{` • Genres: ${selectedGenres.join(", ")}`}</span>
                  ) : null}
                </p>
              </div>
            )}
            {selectedEntry === "surprise" && (
              <div className="mt-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">Mode:</span>{" "}
                  <span className="font-semibold text-foreground">Surprise me</span>
                  {selectedGenres.length > 0 ? (
                    <span className="text-muted-foreground">{` • Genres: ${selectedGenres.join(", ")}`}</span>
                  ) : null}
                </p>
              </div>
            )}
          </div>

          {/* Location */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Destination city</Label>
              {selectedCities.length > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">{selectedCities.length} selected</span>
              )}
            </div>
            {flexibleLocation ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Anywhere — we'll find the best city for your trip</span>
                <button
                  type="button"
                  onClick={() => setFlexibleLocation(false)}
                  className="text-sm font-medium text-primary hover:text-primary/80 transition-colors shrink-0 ml-4"
                >
                  Pick cities
                </button>
              </div>
            ) : (
              <div className="space-y-3 animate-fade-in">
                {/* Selected city chips */}
                {selectedCities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCities.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-foreground"
                      >
                        {c}
                        <button
                          type="button"
                          onClick={() => setSelectedCities((prev) => prev.filter((x) => x !== c))}
                          className="ml-0.5 text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${c}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {/* Quick-tap metro chips */}
                <div className="flex flex-wrap gap-1.5">
                  {METRO_SUGGESTIONS.map((m) => {
                    const active = selectedCities.includes(m.city);
                    return (
                      <button
                        key={m.city}
                        type="button"
                        onClick={() =>
                          setSelectedCities((prev) =>
                            active ? prev.filter((x) => x !== m.city) : [...prev, m.city]
                          )
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition-all ${
                          active
                            ? "border-primary bg-primary/10 text-foreground font-medium"
                            : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                        }`}
                      >
                        {m.city}
                      </button>
                    );
                  })}
                </div>
                {/* Free-text input for cities not in the list */}
                <div className="relative">
                  <Input
                    list="metro-cities-datalist"
                    placeholder="Or type any city and press Enter…"
                    value={cityInput}
                    onChange={(e) => setCityInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const val = cityInput.trim();
                        if (val && !selectedCities.includes(val)) {
                          setSelectedCities((prev) => [...prev, val]);
                        }
                        setCityInput("");
                      }
                    }}
                    onBlur={() => {
                      const val = cityInput.trim();
                      if (val && !selectedCities.includes(val)) {
                        setSelectedCities((prev) => [...prev, val]);
                      }
                      setCityInput("");
                    }}
                    className="pr-8"
                  />
                  <datalist id="metro-cities-datalist">
                    {METRO_SUGGESTIONS.filter((m) => !selectedCities.includes(m.city)).map((m) => (
                      <option key={m.city} value={m.city} label={m.display} />
                    ))}
                  </datalist>
                </div>
                <button
                  type="button"
                  onClick={() => { setFlexibleLocation(true); setSelectedCities([]); setCityInput(""); }}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  ← I'm flexible, show me anywhere
                </button>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Weekend dates</Label>
            </div>
            {flexibleDates ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Any upcoming weekend — we'll find the best timing</span>
                <button
                  type="button"
                  onClick={() => {
                    setFlexibleDates(false);
                    if (!startDate) {
                      const today = new Date();
                      const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
                      const friday = new Date(today);
                      friday.setDate(today.getDate() + daysUntilFriday + 14);
                      const sunday = new Date(friday);
                      sunday.setDate(friday.getDate() + 2);
                      setStartDate(friday.toISOString().slice(0, 10));
                      setEndDate(sunday.toISOString().slice(0, 10));
                    }
                  }}
                  className="text-sm font-medium text-primary hover:text-primary/80 transition-colors shrink-0 ml-4"
                >
                  Pick dates
                </button>
              </div>
            ) : (
              <div className="space-y-2 animate-fade-in">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="start-date" className="text-xs text-muted-foreground">Arrival</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="end-date" className="text-xs text-muted-foreground">Departure</Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setFlexibleDates(true); setStartDate(""); setEndDate(""); }}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  ← I'm flexible on dates
                </button>
              </div>
            )}
          </div>

          {/* Group size */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Group size</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGroupSize(n)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-medium transition-all ${
                    groupSize === n
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full rounded-full">
            Generate My Itinerary <Sparkles className="ml-2 h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
