import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_VENDORS = ["ticket", "hotel", "flight", "golf", "experience", "restaurant"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_URL_PROTOCOLS = ["https:", "http:"];
const MAX_STRING_LENGTH = 500;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 60; // max requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Rate limit by IP
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("cf-connecting-ip") || "unknown";
    if (isRateLimited(clientIp)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    const event_type = typeof body?.event_type === "string" ? body.event_type.trim().slice(0, 100) : "affiliate_click";
    const original_event_type = typeof body?.original_event_type === "string" ? body.original_event_type.trim().slice(0, 100) : null;
    const itinerary_id = typeof body?.itinerary_id === "string" ? body.itinerary_id.trim() : "";
    const package_id = typeof body?.package_id === "string" ? body.package_id.trim().slice(0, 120) : null;
    const package_tier = typeof body?.package_tier === "string" ? body.package_tier.trim().slice(0, 50) : null;
    const vendor = typeof body?.vendor === "string" ? body.vendor.trim() : "";
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, MAX_STRING_LENGTH) : null;
    const target_url = typeof body?.target_url === "string" ? body.target_url.trim().slice(0, 2048) : null;
    const provider = typeof body?.provider === "string" ? body.provider.trim().slice(0, 100) : null;
    const category = typeof body?.category === "string" ? body.category.trim().slice(0, 50) : null;
    const link_type = typeof body?.link_type === "string" ? body.link_type.trim().slice(0, 50) : null;
    const page_context = typeof body?.page_context === "string" ? body.page_context.trim().slice(0, 100) : null;
    const destination = typeof body?.destination === "string" ? body.destination.trim().slice(0, 250) : null;
    const metro_slug = typeof body?.metro_slug === "string" ? body.metro_slug.trim().slice(0, 100) : null;
    const artist_name = typeof body?.artist_name === "string" ? body.artist_name.trim().slice(0, 250) : null;
    const metadata =
      body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : null;

    if (itinerary_id && !UUID_REGEX.test(itinerary_id)) {
      return new Response(JSON.stringify({ error: "Invalid itinerary_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!itinerary_id && !package_id && !event_type) {
      return new Response(JSON.stringify({ error: "Missing tracking subject" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!VALID_VENDORS.includes(vendor)) {
      return new Response(JSON.stringify({ error: "Invalid vendor" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedUrl: URL | null = null;
    if (target_url) {
      try {
        parsedUrl = new URL(target_url);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid target_url" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!ALLOWED_URL_PROTOCOLS.includes(parsedUrl.protocol)) {
        return new Response(JSON.stringify({ error: "Invalid URL protocol" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userAgent = req.headers.get("user-agent") || null;
    const utms: Record<string, string> = {};
    for (const key of UTM_KEYS) {
      const value = typeof body?.[key] === "string" ? body[key].trim().slice(0, 200) : "";
      if (value) utms[key] = value;
    }

    await supabase.from("click_events").insert({
      event_type,
      ...(original_event_type && { original_event_type }),
      ...(itinerary_id && { itinerary_id }),
      ...(package_id && { package_id }),
      ...(package_tier && { package_tier }),
      vendor,
      label: label || null,
      target_url: parsedUrl?.href ?? null,
      user_agent: typeof userAgent === "string" ? userAgent.slice(0, 512) : null,
      ...(provider && { provider }),
      ...(category && { category }),
      ...(link_type && { link_type }),
      ...(page_context && { page_context }),
      ...(destination && { destination }),
      ...(metro_slug && { metro_slug }),
      ...(artist_name && { artist_name }),
      ...(metadata && { metadata }),
      ...utms,
    });

    return new Response(JSON.stringify({ success: true, redirect: parsedUrl?.href ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("track-click error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
