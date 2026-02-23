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



type EntryOption = "artist" | "find_concert" | "surprise";
type BudgetTier = "low" | "mid" | "high";

const ENTRY_OPTIONS = [
  {
    id: "artist" as EntryOption,
    icon: Music,
    label: "I have an artist in mind",
    description: "Build a golf weekend around a concert",
  },
  {
    id: "find_concert" as EntryOption,
    icon: Search,
    label: "Help me find a concert",
    description: "We'll suggest the best upcoming shows",
  },
  {
    id: "surprise" as EntryOption,
    icon: Sparkles,
    label: "Surprise me",
    description: "Plan something epic — I'm flexible",
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

  const { user } = useAuth();
  const navigate = useNavigate();

  const getEventDetails = () => {
    if (selectedEntry === "artist") return eventInput;
    if (selectedEntry === "find_concert") return `discover for me — genres: ${selectedGenres.length ? selectedGenres.join(", ") : "any"}`;
    const genreStr = selectedGenres.length ? ` — genres: ${selectedGenres.join(", ")}` : "";
    return `surprise me — concert${genreStr}`;
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

    const finalCity = flexibleLocation ? "flexible" : city;
    const finalStart = flexibleDates ? new Date().toISOString().split("T")[0] : startDate;
    const finalEnd = flexibleDates
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      : endDate;

    setGenerating(true);
    
    // Wrap the ENTIRE flow in a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || supabaseKey;
      console.log("Starting itinerary insert...");
      const insertPayload = {
        user_id: user?.id || null,
        path: "golf_music",
        city: finalCity,
        start_date: finalStart,
        end_date: finalEnd,
        budget_tier: budget,
        group_size: groupSize,
        preferences: { flexible_location: flexibleLocation, flexible_dates: flexibleDates },
        event_details: getEventDetails(),
        email: user?.email || null,
      };
      console.log("Insert payload:", JSON.stringify(insertPayload));

      // Use fetch directly — the Supabase client insert hangs silently
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/itineraries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${authToken}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify(insertPayload),
        signal: AbortSignal.timeout(30000),
      });

      if (!insertRes.ok) {
        const errBody = await insertRes.text();
        console.error("Insert HTTP error:", insertRes.status, errBody);
        throw new Error(`Insert failed (${insertRes.status}): ${errBody}`);
      }

      const insertedRows = await insertRes.json();
      const itinerary = insertedRows[0];
      if (!itinerary?.id) {
        throw new Error("No itinerary returned from insert");
      }
      console.log("Itinerary created:", itinerary.id);

      // Use fetch directly for edge function too
      console.log("Calling generate-itinerary edge function...");
      const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({ itinerary_id: itinerary.id }),
        signal: AbortSignal.timeout(120000),
      });

      const genData = await genRes.json();
      console.log("Generation response:", genRes.status, JSON.stringify(genData));

      if (!genRes.ok || genData?.error) {
        throw new Error(genData?.error || `Generation failed (${genRes.status})`);
      }

      navigate(`/itinerary/${itinerary.id}`);
    } catch (err: any) {
      console.error("Generation error:", err);
      toast.error(err.message || "Failed to generate itinerary");
      setGenerating(false);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  if (generating) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <div className="text-center">
          <h2 className="font-serif text-2xl font-bold">Crafting Your Legendary Weekend...</h2>
          <p className="mt-2 text-muted-foreground">Our AI is finding the best options for you</p>
          <p className="mt-1 text-xs text-muted-foreground">This usually takes 30–60 seconds</p>
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
              Don't worry about dates or location yet — just tell us what sounds good.
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
                placeholder="e.g. Tyler Childers, Morgan Wallen, Zach Bryan"
                value={eventInput}
                onChange={(e) => setEventInput(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {(selectedEntry === "find_concert" || selectedEntry === "surprise") && (
            <div className="space-y-3 animate-fade-in">
              <Label>What kind of music are you into?</Label>
              <div className="flex flex-wrap gap-2">
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
              className="rounded-full px-8"
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
