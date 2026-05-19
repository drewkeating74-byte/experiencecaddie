export type WeekendIdeasSignupSource =
  | "homepage"
  | "itinerary_results"
  | "unsupported_city"
  | "no_results";

export interface WeekendIdeasSignupPayload {
  email: string;
  source: WeekendIdeasSignupSource;
  favorite_city?: string;
  favorite_interests?: string;
  requested_city?: string;
  itinerary_id?: string;
  user_id?: string;
}

export interface WeekendIdeasSignupResult {
  success: boolean;
  updated?: boolean;
  error?: string;
}

export async function submitWeekendIdeasSignup(
  payload: WeekendIdeasSignupPayload,
  honeypot = "",
): Promise<WeekendIdeasSignupResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { success: false, error: "App configuration error" };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/subscribe-weekend-ideas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        source: payload.source,
        favorite_city: payload.favorite_city?.trim() || undefined,
        favorite_interests: payload.favorite_interests?.trim() || undefined,
        requested_city: payload.requested_city?.trim() || undefined,
        itinerary_id: payload.itinerary_id,
        user_id: payload.user_id,
        _hp: honeypot,
      }),
    });

    const data = (await res.json()) as { success?: boolean; updated?: boolean; error?: string };
    if (!res.ok) {
      return { success: false, error: data.error || "Something went wrong. Please try again." };
    }
    return { success: true, updated: data.updated === true };
  } catch {
    return { success: false, error: "Network error. Please try again." };
  }
}
