import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PATH_LABELS: Record<string, string> = {
  golf_music: "Golf + Concert",
};

const BUDGET_LABELS: Record<string, string> = {
  low: "Budget-friendly ($)",
  mid: "Mid-range ($$)",
  high: "Premium ($$$)",
};

// Simple in-memory rate limiter (resets on cold start, which is acceptable)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10; // max requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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
      return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const itinerary_id = typeof body?.itinerary_id === "string" ? body.itinerary_id.trim() : "";
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!itinerary_id || !uuidRegex.test(itinerary_id)) {
      return new Response(JSON.stringify({ error: "Invalid or missing itinerary_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the itinerary record
    const { data: itinerary, error: fetchErr } = await supabase
      .from("itineraries")
      .select("*")
      .eq("id", itinerary_id)
      .single();

    if (fetchErr || !itinerary) {
      return new Response(JSON.stringify({ error: "Itinerary not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate share slug early so the "Public read shared itineraries" RLS policy allows reads during generation
    const shareSlug = `${itinerary.city.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;

    // Mark as generating and set share_slug
    await supabase.from("itineraries").update({ status: "generating", share_slug: shareSlug }).eq("id", itinerary_id);

    const pathLabel = PATH_LABELS[itinerary.path] || itinerary.path;
    const budgetLabel = BUDGET_LABELS[itinerary.budget_tier] || itinerary.budget_tier;
    const prefs = itinerary.preferences || {};
    const prefsList = Object.entries(prefs)
      .filter(([, v]) => v === true)
      .map(([k]) => k.replace(/_/g, " "))
      .join(", ");

    const systemPrompt = `You are Experience Caddie, an AI travel planner specializing in legendary golf + concert weekend getaways. 
You create curated trip packages with real vendor search links for booking.
You MUST respond with ONLY valid JSON matching the exact schema specified. No markdown, no explanation, just JSON.`;

    const userPrompt = `Create 3 curated weekend packages (Bronze, Silver, Gold tiers) for this golf + concert trip:

- Path: ${pathLabel}
- City: ${itinerary.city}
- Dates: ${itinerary.start_date} to ${itinerary.end_date}
- Budget: ${budgetLabel}
- Group size: ${itinerary.group_size}
${prefs ? `- Preferences: ${prefsList || "none specified"}` : ""}
${itinerary.event_details ? `- Event details: ${itinerary.event_details}` : ""}

For each tier, include:
- 2-3 lodging options across these types: hotels, vacation rentals (Airbnb/VRBO), and golf resorts. Mix the types based on the tier — Bronze should lean budget hotels & rentals, Silver mid-range hotels & resorts, Gold premium resorts & luxury rentals.
  Use these search URL formats:
  - Hotels: https://www.booking.com/searchresults.html?ss={city}&checkin={start_date}&checkout={end_date}
  - Vacation rentals: https://www.vrbo.com/search?destination={city}&startDate={start_date}&endDate={end_date}
  - Golf resorts: https://www.booking.com/searchresults.html?ss={resort+name}+{city}
- 1-2 concert/event options with links (use Ticketmaster search URLs)  
- 2-3 golf course suggestions with tee time links (use GolfNow search URLs)
- 2-4 extras (restaurants, bars, experiences) with links (use Google Maps/OpenTable/Viator search URLs)
- A day-by-day itinerary (covering each day of the trip)
- Estimated total cost range in USD

Use real search URLs built from the city and date parameters. Format:
- Tickets: https://www.ticketmaster.com/search?q={keywords}&daterange={start_date}
- Golf: https://www.golfnow.com/tee-times/search#sortby=Date&view=List&search={city}
- Restaurants: https://www.google.com/maps/search/{restaurant+type}+{city}
- Experiences: https://www.viator.com/search/{city}

Return this exact JSON structure:
{
  "summary": {
    "title": "string - catchy trip title",
    "vibe": "string - 1-2 sentence vibe description",
    "estimated_total_range_usd": [min_number, max_number],
    "assumptions": ["string array of caveats"]
  },
  "packages": [
    {
      "tier": "BRONZE" | "SILVER" | "GOLD",
      "estimated_total_usd": [min, max],
      "lodging": [
        { "name": "string", "type": "hotel" | "vacation_rental" | "golf_resort", "area": "string", "price_per_night": "string", "url": "string", "why": "string" }
      ],
      "events": [
        { "name": "string", "venue": "string", "date_time": "string", "url": "string", "price_range": "string" }
      ],
      "golf": [
        { "name": "string", "why": "string", "url": "string", "green_fee": "string" }
      ],
      "extras": [
        { "name": "string", "type": "restaurant" | "bar" | "experience" | "attraction", "url": "string", "why": "string" }
      ],
      "itinerary": [
        { "day": "string (e.g. Friday)", "plan": ["string array of activities"] }
      ],
      "safety_notes": "string"
    }
  ]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429) {
        await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
      return new Response(JSON.stringify({ error: "Failed to generate itinerary" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content;

    if (!content) {
      await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
      return new Response(JSON.stringify({ error: "Empty AI response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse JSON from the response (handle markdown code blocks)
    let parsedResult: any;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsedResult = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI JSON:", content.substring(0, 500));
      await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
      return new Response(JSON.stringify({ error: "Invalid AI response format" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save result (share_slug already set during "generating" phase)
    const { error: updateErr } = await supabase
      .from("itineraries")
      .update({
        result_json: parsedResult,
        status: "generated",
      })
      .eq("id", itinerary_id);

    if (updateErr) {
      console.error("Failed to save itinerary:", updateErr);
      return new Response(JSON.stringify({ error: "Failed to save itinerary" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, itinerary_id, share_slug: shareSlug, result: parsedResult }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-itinerary error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
