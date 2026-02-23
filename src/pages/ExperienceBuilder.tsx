import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Music, Trophy, ArrowRight, ArrowLeft, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const db = supabase as any;

type ExperiencePath = "golf_music" | "sports" | "luxury" | "custom";
type BudgetTier = "low" | "mid" | "high";

const PATHS = [
  { id: "golf_music" as ExperiencePath, icon: Music, label: "Golf + Concert", description: "Championship courses and concert nights" },
  { id: "sports" as ExperiencePath, icon: Trophy, label: "Golf + Sports Event", description: "Big games, tailgates, and World Cup" },
];

const PREFERENCES = [
  { id: "walkable_area", label: "Walkable area" },
  { id: "upscale_dining", label: "Upscale dining" },
  { id: "early_tee_times", label: "Early tee times" },
  { id: "late_night", label: "Late-night options" },
  { id: "family_friendly", label: "Family-friendly" },
];

export default function ExperienceBuilder() {
  const [step, setStep] = useState<"path" | "details">("path");
  const [selectedPath, setSelectedPath] = useState<ExperiencePath | null>(null);
  const [city, setCity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState<BudgetTier>("mid");
  const [groupSize, setGroupSize] = useState(2);
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [eventDetails, setEventDetails] = useState("");
  const [generating, setGenerating] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  const togglePref = (id: string) => {
    setPreferences((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleGenerate = async () => {
    if (!selectedPath || !city || !startDate || !endDate) {
      toast.error("Please fill in all required fields");
      return;
    }

    setGenerating(true);
    try {
      // Create itinerary record
      const { data: itinerary, error: insertErr } = await db.from("itineraries").insert({
        user_id: user?.id || null,
        path: selectedPath,
        city,
        start_date: startDate,
        end_date: endDate,
        budget_tier: budget,
        group_size: groupSize,
        preferences,
        event_details: eventDetails || null,
        email: user?.email || null,
      }).select().single();

      if (insertErr || !itinerary) {
        throw new Error(insertErr?.message || "Failed to create itinerary");
      }

      // Call AI generation
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
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-4xl font-bold">Start Your Experience</h1>
        <p className="mt-2 text-muted-foreground">
          Tell us what you're looking for and we'll build your perfect weekend
        </p>
      </div>

      {step === "path" && (
        <div className="space-y-6">
          <h2 className="text-center font-serif text-xl font-semibold">Choose Your Path</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {PATHS.map((p) => (
              <Card
                key={p.id}
                className={`cursor-pointer border-2 transition-all hover:shadow-lg ${
                  selectedPath === p.id
                    ? "border-primary bg-primary/5 shadow-md"
                    : "border-border/50 hover:border-primary/30"
                }`}
                onClick={() => setSelectedPath(p.id)}
              >
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className={`mb-3 flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                    selectedPath === p.id ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                  }`}>
                    <p.icon className="h-7 w-7" />
                  </div>
                  <h3 className="font-serif text-lg font-semibold">{p.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex justify-center">
            <Button
              onClick={() => setStep("details")}
              disabled={!selectedPath}
              size="lg"
              className="rounded-full px-8"
            >
              Next <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === "details" && (
        <div className="space-y-6">
          <Button variant="ghost" onClick={() => setStep("path")} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to paths
          </Button>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city">City *</Label>
              <Input id="city" placeholder="e.g. Austin, TX" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget">Budget</Label>
              <Select value={budget} onValueChange={(v) => setBudget(v as BudgetTier)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">$ Budget-friendly</SelectItem>
                  <SelectItem value="mid">$$ Mid-range</SelectItem>
                  <SelectItem value="high">$$$ Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start">Start Date *</Label>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End Date *</Label>
              <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="group">Group Size</Label>
            <Input
              id="group"
              type="number"
              min={1}
              max={20}
              value={groupSize}
              onChange={(e) => setGroupSize(parseInt(e.target.value) || 2)}
              className="w-32"
            />
          </div>

          <div className="space-y-3">
            <Label>Preferences</Label>
            <div className="flex flex-wrap gap-4">
              {PREFERENCES.map((pref) => (
                <div key={pref.id} className="flex items-center gap-2">
                  <Checkbox
                    id={pref.id}
                    checked={!!preferences[pref.id]}
                    onCheckedChange={() => togglePref(pref.id)}
                  />
                  <Label htmlFor={pref.id} className="cursor-pointer text-sm font-normal">
                    {pref.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {selectedPath === "golf_music" && (
            <div className="space-y-2">
              <Label htmlFor="event">Artist / Concert (optional)</Label>
              <Textarea
                id="event"
                placeholder='e.g. "Tyler Childers" or "discover for me"'
                value={eventDetails}
                onChange={(e) => setEventDetails(e.target.value)}
              />
            </div>
          )}

          {selectedPath === "sports" && (
            <div className="space-y-2">
              <Label htmlFor="event">Sport / Team / Event (optional)</Label>
              <Textarea
                id="event"
                placeholder='e.g. "NFL game" or "March Madness"'
                value={eventDetails}
                onChange={(e) => setEventDetails(e.target.value)}
              />
            </div>
          )}

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
