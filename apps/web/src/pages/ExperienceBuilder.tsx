import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Music, Search, Sparkles, ArrowRight, ArrowLeft, Loader2, Wand2, MapPin, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { fetchSearch, buildFallbackSearchResponse } from "@/lib/api/search";



type EntryOption = "artist" | "find_concert" | "surprise";
type BudgetTier = "low" | "mid" | "high";

type ConcertOption = { artist: string; city: string; venue: string; date: string; url?: string };

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
  const [city, setCity] = useState("");
  const [flexibleDates, setFlexibleDates] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState<BudgetTier>("mid");
  const [groupSize, setGroupSize] = useState(2);
  const [generating, setGenerating] = useState(false);

  // Two-step flow: discover concerts → user picks → build full itinerary
  const [discoveryStep, setDiscoveryStep] = useState<"form" | "discovering" | "pick" | "building">("form");
  const [concertOptions, setConcertOptions] = useState<ConcertOption[]>([]);
  const [savedParams, setSavedParams] = useState<{ finalCity: string; finalStart: string; finalEnd: string; budget: BudgetTier; groupSize: number; eventDetails: string } | null>(null);

  const { user } = useAuth();
  const navigate = useNavigate();

  const getEventDetails = () => {
    if (selectedEntry === "artist") return eventInput;
    if (selectedEntry === "find_concert") return `discover for me — genres: ${selectedGenres.length ? selectedGenres.join(", ") : "any"}`;
    const genreStr = selectedGenres.length ? ` — genres: ${selectedGenres.join(", ")}` : "";
    return `surprise me — concert${genreStr}`;
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
        destination: { city: concert.city },
        dates: { start_date: savedParams.finalStart, end_date: savedParams.finalEnd },
        group_size: Math.min(Math.max(savedParams.groupSize, 1), 20),
        budget_tier: savedParams.budget,
      };
      let searchResult;
      try {
        searchResult = await fetchSearch(searchRequest);
      } catch {
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
          golf_courses: searchResult.golf_courses?.slice(0, 6) || [],
          hotels: searchResult.hotels?.slice(0, 6) || [],
        },
        selected_concert: concert,
        email: user?.email || null,
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
      const genData = await genRes.json();
      if (!genRes.ok || genData?.error) {
        throw new Error(genData?.error || "Generation failed");
      }
      navigate(`/share/${genData.share_slug}`);
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isAbort = err?.name === "AbortError";
      toast.error(isAbort ? "Request timed out. Keep the tab open." : (err.message || "Failed to generate"));
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
    if (!flexibleLocation && !city) {
      toast.error("Enter a city or switch to flexible location");
      return;
    }
    if (!flexibleDates && (!startDate || !endDate)) {
      toast.error("Enter dates or switch to flexible dates");
      return;
    }

    // Client-side input validation
    const trimmedCity = flexibleLocation ? "flexible" : city.trim().slice(0, 100);
    if (!flexibleLocation && !/^[a-zA-Z\s\-'.,()\u00C0-\u024F]+$/.test(trimmedCity)) {
      toast.error("City name contains invalid characters");
      return;
    }
    if (groupSize < 1 || groupSize > 20) {
      toast.error("Group size must be between 1 and 20");
      return;
    }
    const validBudgets = ["low", "mid", "high"];
    if (!validBudgets.includes(budget)) {
      toast.error("Invalid budget selection");
      return;
    }

    const finalCity = trimmedCity;
    const finalStart = flexibleDates ? new Date().toISOString().split("T")[0] : startDate;
    const finalEnd = flexibleDates
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      : endDate;

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(finalStart) || !dateRegex.test(finalEnd)) {
      toast.error("Invalid date format");
      return;
    }

    const useDiscoveryFlow = selectedEntry === "find_concert" || selectedEntry === "surprise" || selectedEntry === "artist";
    const eventDetails = getEventDetails();

    if (useDiscoveryFlow && discoveryStep === "form") {
      // Stage 1: Discover 3 concerts
      setDiscoveryStep("discovering");
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
              start_date: finalStart,
              end_date: finalEnd,
              city: finalCity,
              event_details: typeof eventDetails === "string" ? eventDetails.slice(0, 500) : null,
              artist_search: selectedEntry === "artist" ? eventInput.trim().slice(0, 200) : null,
            },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
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
        const opts = discData.concert_options || [];
        if (!opts.length) throw new Error("No concerts found for your dates");
        setConcertOptions(opts);
        setSavedParams({ finalCity, finalStart, finalEnd, budget, groupSize, eventDetails });
        setDiscoveryStep("pick");
      } catch (err: any) {
        clearTimeout(timeoutId);
        const isAbort = err?.name === "AbortError";
        let msg = err?.message || "Failed to find concerts";
        if (isAbort) msg = "Request timed out. Keep the tab open and try again.";
        else if (msg?.includes("Failed to fetch") || msg?.includes("NetworkError")) msg = "Could not reach server. Check your connection and try again.";
        else if (msg?.includes("404")) msg = "Concert discovery service unavailable. Please try again later.";
        toast.error(msg);
        setDiscoveryStep("form");
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
      const searchRequest = {
        destination: { city: finalCity === "flexible" ? savedParams?.finalCity || "Austin" : finalCity },
        dates: { start_date: finalStart, end_date: finalEnd },
        group_size: Math.min(Math.max(groupSize, 1), 20),
        budget_tier: budget,
      };
      let searchResult;
      try {
        searchResult = await fetchSearch(searchRequest);
      } catch (err) {
        if (import.meta.env.DEV) console.warn("Search API unreachable, using fallback:", err);
        searchResult = buildFallbackSearchResponse(searchRequest);
      }
      const searchResults = {
        events: searchResult.events?.slice(0, 6) || [],
        golf_courses: searchResult.golf_courses?.slice(0, 6) || [],
        hotels: searchResult.hotels?.slice(0, 6) || [],
      };
      const payload: Record<string, unknown> = {
        user_id: user?.id || null,
        path: "golf_music",
        city: finalCity,
        start_date: finalStart,
        end_date: finalEnd,
        budget_tier: budget,
        group_size: Math.min(Math.max(groupSize, 1), 20),
        preferences: { flexible_location: flexibleLocation, flexible_dates: flexibleDates },
        event_details: typeof eventDetails === "string" ? eventDetails.slice(0, 1000) : null,
        search_results: searchResults,
        email: user?.email || null,
      };
      if (import.meta.env.DEV) {
        console.log("Payload (sanitized):", { ...payload, user_id: "[REDACTED]", email: "[REDACTED]" });
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
    } catch (err: any) {
      console.error("Generation error:", err);
      const isAbort = err?.name === "AbortError";
      toast.error(isAbort ? "Request timed out. Please try again and keep the tab open." : (err.message || "Failed to generate itinerary"));
      setGenerating(false);
    } finally {
      clearTimeout(timeoutId);
    }
  };

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
            <Button variant="ghost" onClick={() => { setDiscoveryStep("form"); setConcertOptions([]); setSavedParams(null); }} className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <h2 className="font-serif text-2xl font-bold">Pick your concert</h2>
            <p className="mt-1 text-muted-foreground">We&apos;ll build golf + hotel around your choice</p>
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
                        {opt.date}
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
                  {opt.url && (
                    <a href={opt.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary mt-2 inline-block hover:underline">
                      Get tickets →
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (generating) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <div className="text-center">
          <h2 className="font-serif text-2xl font-bold">Crafting Your Legendary Weekend...</h2>
          <p className="mt-2 text-muted-foreground">Our AI is finding the best options for you</p>
          <p className="mt-1 text-xs text-muted-foreground">This usually takes 30–60 seconds</p>
          <p className="mt-1 text-xs text-muted-foreground">On mobile: keep this tab open and the screen on</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => setGenerating(false)}
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
        <div className="space-y-8">
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
              <div className="grid grid-cols-4 gap-2">
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
                      className={`rounded-full border px-4 py-1.5 text-sm transition-all ${
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
              onClick={handleContinue}
              disabled={!selectedEntry}
              size="lg"
              className="rounded-full px-8 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === "details" && (
        <div className="space-y-8">
          <div>
            <Button variant="ghost" onClick={() => setStep("start")} className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <h2 className="font-serif text-2xl font-bold">Fine-tune your trip</h2>
            <p className="mt-1 text-muted-foreground">
              Everything here is optional — we'll work with whatever you give us.
            </p>
          </div>

          {/* Location */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <Label className="text-base font-medium">Location</Label>
              </div>
              <button
                onClick={() => setFlexibleLocation(!flexibleLocation)}
                className={`text-sm font-medium transition-colors ${
                  flexibleLocation ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {flexibleLocation ? "I'm flexible ✓" : "Set a location"}
              </button>
            </div>
            {flexibleLocation && (
              <button onClick={() => setFlexibleLocation(false)} className="text-xs text-muted-foreground hover:text-primary transition-colors text-left cursor-pointer">Tap to set a specific city →</button>
            )}
            {!flexibleLocation && (
              <Input
                placeholder="e.g. Austin, TX"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="animate-fade-in"
                autoFocus
              />
            )}
          </div>

          {/* Dates */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label className="text-base font-medium">Dates</Label>
              </div>
              <button
                onClick={() => setFlexibleDates(!flexibleDates)}
                className={`text-sm font-medium transition-colors ${
                  flexibleDates ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {flexibleDates ? "I'm flexible ✓" : "Set dates"}
              </button>
            </div>
            {flexibleDates && (
              <button onClick={() => setFlexibleDates(false)} className="text-xs text-muted-foreground hover:text-primary transition-colors text-left cursor-pointer">Tap to set specific dates →</button>
            )}
            {!flexibleDates && (
              <div className="flex gap-3 animate-fade-in">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="start-date" className="text-xs text-muted-foreground">From</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="end-date" className="text-xs text-muted-foreground">To</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Budget */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Budget</Label>
            </div>
            <Select value={budget} onValueChange={(v) => setBudget(v as BudgetTier)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Budget-friendly</SelectItem>
                <SelectItem value="mid">Mid-range</SelectItem>
                <SelectItem value="high">Premium</SelectItem>
              </SelectContent>
            </Select>
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

          <Button onClick={handleGenerate} size="lg" className="w-full rounded-full">
            Generate My Itinerary <Sparkles className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
