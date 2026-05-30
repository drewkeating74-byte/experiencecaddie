import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { logEvent } from "@/lib/analytics";
import {
  submitWeekendIdeasSignup,
  type WeekendIdeasSignupSource,
} from "@/lib/weekendIdeasSignup";
import { cn } from "@/lib/utils";

export type WeekendIdeasSignupVariant = WeekendIdeasSignupSource;

type Props = {
  variant: WeekendIdeasSignupVariant;
  defaultCity?: string;
  defaultInterests?: string;
  requestedCity?: string;
  itineraryId?: string;
  userId?: string;
  compact?: boolean;
  className?: string;
};

function getCopy(variant: WeekendIdeasSignupVariant, requestedCity?: string) {
  switch (variant) {
    case "unsupported_city": {
      const cityLabel = requestedCity?.trim() || "your city";
      return {
        title: `We're not in ${cityLabel} yet`,
        description:
          "Want us to add it? Tell us where to go next — and get weekly golf + concert weekend ideas when we expand.",
      };
    }
    case "no_results":
      return {
        title: "No match this time?",
        description:
          "Get weekly golf + concert weekend ideas — we'll notify you when packages match your taste.",
      };
    case "itinerary_results":
      return {
        title: "Get weekly golf + concert weekend ideas",
        description:
          "Curated weekends tied to confirmed tour dates. No account required.",
      };
    default:
      return {
        title: "Get weekly golf + concert weekend ideas",
        description:
          "Hand-picked golf + concert weekends in great cities. Unsubscribe anytime.",
      };
  }
}

// Compact, low-friction genre picker (replaces free-text "favorite artists or
// genres"). Aligned with the catalog's primary genre buckets.
const GENRE_OPTIONS = ["Country", "Pop", "Rock", "Hip-Hop", "R&B", "Latin", "EDM", "Classic Rock"];

/** Preselect any known genres mentioned in a free-text seed (back-compat with
 *  callers that still pass defaultInterests like "Country, Luke Combs"). */
function matchGenres(seed: string): string[] {
  const s = (seed || "").toLowerCase();
  return GENRE_OPTIONS.filter((g) => s.includes(g.toLowerCase()));
}

export default function WeekendIdeasSignup({
  variant,
  defaultCity = "",
  defaultInterests = "",
  requestedCity,
  itineraryId,
  userId,
  compact = false,
  className,
}: Props) {
  const copy = getCopy(variant, requestedCity ?? defaultCity);
  const [email, setEmail] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [genres, setGenres] = useState<string[]>(() => matchGenres(defaultInterests));
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // City only matters for the "which city should we add next?" prompt. The
  // standard signup stays low-friction: just email + an optional genre picker.
  const showCityField = variant === "unsupported_city" && !requestedCity?.trim();

  function toggleGenre(g: string) {
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || submitted) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("Please enter your email");
      return;
    }

    setSubmitting(true);
    const result = await submitWeekendIdeasSignup(
      {
        email: trimmedEmail,
        source: variant,
        favorite_city: showCityField ? city.trim() || undefined : undefined,
        favorite_interests: genres.join(", ") || undefined,
        requested_city:
          variant === "unsupported_city"
            ? (requestedCity?.trim() || city.trim() || undefined)
            : undefined,
        itinerary_id: itineraryId,
        user_id: userId,
      },
      honeypot,
    );
    setSubmitting(false);

    if (!result.success) {
      toast.error(result.error || "Could not sign up. Please try again.");
      return;
    }

    setSubmitted(true);
    logEvent({
      event_type: "weekend_ideas_signup",
      extra: { source: variant, updated: result.updated === true },
    });
    toast.success(
      result.updated
        ? "You're on the list — we updated your preferences."
        : "You're on the list!",
    );
  }

  if (submitted) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card text-center",
          compact ? "px-3 py-4" : "px-6 py-8",
          className,
        )}
      >
        <p className="text-sm font-medium text-foreground">You're on the list!</p>
        <p className="mt-1 text-xs text-muted-foreground">
          We'll send weekend ideas when there's something worth your time.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        compact ? "px-3 py-4" : "px-6 py-8",
        className,
      )}
    >
      <div className={compact ? "space-y-3" : "space-y-4"}>
        <div className={compact ? "text-left" : "text-center"}>
          <h3 className={cn("font-serif font-semibold text-foreground", compact ? "text-base" : "text-xl")}>
            {copy.title}
          </h3>
          <p className={cn("text-muted-foreground", compact ? "mt-1 text-xs" : "mt-2 text-sm")}>
            {copy.description}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
            <label htmlFor={`wi-hp-${variant}`}>Leave blank</label>
            <input
              id={`wi-hp-${variant}`}
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`wi-email-${variant}`} className="text-xs">
              Email <span className="text-destructive">*</span>
            </Label>
            <Input
              id={`wi-email-${variant}`}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={compact ? "h-9" : undefined}
            />
          </div>

          {showCityField && (
            <div className="space-y-1.5">
              <Label htmlFor={`wi-city-${variant}`} className="text-xs">
                Favorite city <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id={`wi-city-${variant}`}
                type="text"
                placeholder="e.g. Nashville, Savannah"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={compact ? "h-9" : undefined}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">
              Favorite genres <span className="text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {GENRE_OPTIONS.map((g) => {
                const active = genres.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGenre(g)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-muted",
                    )}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            type="submit"
            className={cn("w-full rounded-full", compact ? "h-9 text-sm" : "h-11")}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-2 h-4 w-4" />
            )}
            Send me ideas
          </Button>

          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            By subscribing you agree to receive occasional emails from Experience Caddie.{" "}
            <Link to="/privacy" className="underline hover:text-primary">
              Privacy Policy
            </Link>
            . Unsubscribe anytime via any email we send.
          </p>
        </form>
      </div>
    </div>
  );
}
