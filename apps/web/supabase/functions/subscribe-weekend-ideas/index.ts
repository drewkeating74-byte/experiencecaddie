import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SOURCES = new Set(["homepage", "itinerary_results", "unsupported_city", "no_results"]);
const MAX_FIELD_LEN = 250;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

function trimOptional(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : null;
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    if (isRateLimited(clientIp)) {
      return new Response(JSON.stringify({ error: "Too many requests. Try again in a minute." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: Record<string, unknown> = {};
    try {
      const raw = await req.text();
      if (!raw?.trim()) {
        return new Response(JSON.stringify({ error: "Request body is empty" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (typeof body._hp === "string" && body._hp.trim().length > 0) {
      return new Response(JSON.stringify({ success: true, updated: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!rawEmail || !isValidEmail(rawEmail)) {
      return new Response(JSON.stringify({ error: "Please enter a valid email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const source = typeof body.source === "string" ? body.source.trim() : "";
    if (!VALID_SOURCES.has(source)) {
      return new Response(JSON.stringify({ error: "Invalid source" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const itineraryId = typeof body.itinerary_id === "string" ? body.itinerary_id.trim() : "";
    if (itineraryId && !UUID_REGEX.test(itineraryId)) {
      return new Response(JSON.stringify({ error: "Invalid itinerary_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    if (userId && !UUID_REGEX.test(userId)) {
      return new Response(JSON.stringify({ error: "Invalid user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const favoriteCity = trimOptional(body.favorite_city, MAX_FIELD_LEN);
    const favoriteInterests = trimOptional(body.favorite_interests, MAX_FIELD_LEN);
    const requestedCity = trimOptional(body.requested_city, MAX_FIELD_LEN);

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: existing } = await supabase
      .from("weekend_ideas_signups")
      .select("email")
      .eq("email", rawEmail)
      .maybeSingle();

    const now = new Date().toISOString();
    const row = {
      email: rawEmail,
      favorite_city: favoriteCity,
      favorite_interests: favoriteInterests,
      requested_city: requestedCity,
      source,
      itinerary_id: itineraryId || null,
      user_id: userId || null,
      consent_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from("weekend_ideas_signups").upsert(row, { onConflict: "email" });

    if (error) {
      console.error("subscribe-weekend-ideas upsert error:", error);
      return new Response(JSON.stringify({ error: "Could not save signup. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, updated: !!existing }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("subscribe-weekend-ideas error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
