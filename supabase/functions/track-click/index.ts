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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();

    const itinerary_id = typeof body?.itinerary_id === "string" ? body.itinerary_id.trim() : "";
    const package_tier = typeof body?.package_tier === "string" ? body.package_tier.trim().slice(0, 50) : "";
    const vendor = typeof body?.vendor === "string" ? body.vendor.trim() : "";
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, MAX_STRING_LENGTH) : null;
    const target_url = typeof body?.target_url === "string" ? body.target_url.trim().slice(0, 2048) : "";

    // Validate required fields
    if (!itinerary_id || !UUID_REGEX.test(itinerary_id)) {
      return new Response(JSON.stringify({ error: "Invalid itinerary_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!package_tier) {
      return new Response(JSON.stringify({ error: "Missing package_tier" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!VALID_VENDORS.includes(vendor)) {
      return new Response(JSON.stringify({ error: "Invalid vendor" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate target_url is a safe URL
    let parsedUrl: URL;
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userAgent = req.headers.get("user-agent") || null;

    await supabase.from("click_events").insert({
      itinerary_id,
      package_tier,
      vendor,
      label: label || null,
      target_url: parsedUrl.href,
      user_agent: typeof userAgent === "string" ? userAgent.slice(0, 512) : null,
    });

    return new Response(JSON.stringify({ success: true, redirect: parsedUrl.href }), {
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
