import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Music, Trophy, Search, Sparkles, ArrowRight, ArrowLeft, Loader2, Wand2, MapPin, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const db = supabase as any;

type EntryOption = "artist" | "find_concert" | "sporting_event" | "surprise";
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
    id: "sporting_event" as EntryOption,
    icon: Trophy,
    label: "I'm going to a sporting event",
    description: "Pair golf with game day",
  },
  {
    id: "surprise" as EntryOption,
    icon: Sparkles,
    label: "Surprise me",
    description: "Plan something epic — I'm flexible",
  },
];

const PREFERENCES = [
  { id: "walkable_area", label: "Walkable area" },
  { id: "upscale_dining", label: "Upscale dining" },
  { id: "early_tee_times", label: "Early tee times" },
  { id: "late_night", label: "Late-night options" },
  { id: "family_friendly", label: "Family-friendly" },
];

export default function ExperienceBuilder() {
  const [step, setStep] = useState<"start" | "details">("start");
  const [selectedEntry, setSelectedEntry] = useState<EntryOption | null>(null);
  const [eventInput, setEventInput] = useState("");

  // Details
  const [flexibleLocation, setFlexibleLocation] = useState(true);
  const [city, setCity] = useState("");
  const [flexibleDates, setFlexibleDates] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState<BudgetTier>("mid");
  const [groupSize, setGroupSize] = useState(2);
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);

  const { user } = useAuth();
  const navigate = useNavigate();

  const togglePref = (id: string) => {
    setPreferences((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getPath = () => {
    return selectedEntry === "sporting_event" ? "sports" : "golf_music";
  };

  const getEventDetails = () => {
    if (selectedEntry === "artist") return eventInput;
    if (selectedEntry === "find_concert") return "discover for me";
    if (selectedEntry === "sporting_event") return eventInput;
    return "surprise me — plan something epic";
  };

  const handleContinue = () => {
    if (!selectedEntry) {
      toast.error("Pick an option to get started");
      return;
    }
    if ((selectedEntry === "artist" || selectedEntry === "sporting_event") && !eventInput.trim()) {
      toast.error(selectedEntry === "artist" ? "Enter an artist or band name" : "Enter an event name");
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
    try {
      const { data: itinerary, error: insertErr } = await db.from("itineraries").insert({
        user_id: user?.id || null,
        path: getPath(),
        city: finalCity,
        start_date: finalStart,
        end_date: finalEnd,
        budget_tier: budget,
        group_size: groupSize,
        preferences: { ...preferences, flexible_location: flexibleLocation, flexible_dates: flexibleDates },
        event_details: getEventDetails(),
        email: user?.email || null,
      }).select().single();

      if (insertErr || !itinerary) {
        throw new Error(insertErr?.message || "Failed to create itinerary");
      }

      const { data: genData, error: genErr } = await supabase.functions.invoke("generate-itinerary", {
        body: { itinerary_id: itinerary.id },
      });

      if (genErr) throw genErr;
      if (genData?.error) {
        toast.error(genData.error);
        setGenerating(false);
        return;
      }

      navigate(`/itinerary/${itinerary.id}`);
    } catch (err: any) {
      console.error("Generation error:", err);
      toast.error(err.message || "Failed to generate itinerary");
      setGenerating(false);
    }
  };

  if (generating) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <h2 className="font-serif text-2xl font-bold">Crafting Your Legendary Weekend...</h2>
        <p className="text-muted-foreground">Our AI is finding the best options for you</p>
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

          {/* Inline input for artist or sporting event */}
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

          {selectedEntry === "sporting_event" && (
            <div className="space-y-2 animate-fade-in">
              <Label htmlFor="sport-input">What event are you going to?</Label>
              <Input
                id="sport-input"
                placeholder="e.g. NFL playoff game, World Cup, March Madness"
                value={eventInput}
                onChange={(e) => setEventInput(e.target.value)}
                autoFocus
              />
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
              <div className="grid gap-3 sm:grid-cols-2 animate-fade-in">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            )}
          </div>

          {/* Budget & Group */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Budget</Label>
              <Select value={budget} onValueChange={(v) => setBudget(v as BudgetTier)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">$ Budget-friendly</SelectItem>
                  <SelectItem value="mid">$$ Mid-range</SelectItem>
                  <SelectItem value="high">$$$ Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Group Size</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={groupSize}
                onChange={(e) => setGroupSize(parseInt(e.target.value) || 2)}
              />
            </div>
          </div>

          {/* Preferences */}
          <div className="space-y-3">
            <Label>Preferences</Label>
            <div className="flex flex-wrap gap-3">
              {PREFERENCES.map((pref) => (
                <label
                  key={pref.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all ${
                    preferences[pref.id]
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  <Checkbox
                    id={pref.id}
                    checked={!!preferences[pref.id]}
                    onCheckedChange={() => togglePref(pref.id)}
                    className="sr-only"
                  />
                  {pref.label}
                </label>
              ))}
            </div>
          </div>

          {/* Generate */}
          <div className="flex justify-center pt-4">
            <Button onClick={handleGenerate} size="lg" className="rounded-full px-10">
              <Wand2 className="mr-2 h-4 w-4" /> Generate My Weekend
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
