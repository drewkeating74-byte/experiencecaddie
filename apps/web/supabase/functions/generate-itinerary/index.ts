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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let body: any = {};
    try {
      const raw = await req.text();
      if (!raw || !raw.trim()) {
        return new Response(
          JSON.stringify({ error: "invalid_json", message: "Request body is empty." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      body = JSON.parse(raw);
    } catch (err) {
      console.error("Invalid JSON body:", err);
      return new Response(
        JSON.stringify({ error: "invalid_json", message: "Request body must be valid JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let itinerary: any;
    let itinerary_id: string;

    if (body?.payload) {
      const p = body.payload;
      const validPaths = ["golf_music", "sports", "luxury", "custom"];
      const validBudgets = ["low", "mid", "high"];
      if (!validPaths.includes(p.path)) p.path = "golf_music";
      if (!validBudgets.includes(p.budget_tier)) p.budget_tier = "mid";

      // Stage 1: Concert discovery only — return 3 options for user to pick
      if (p.discover_concerts) {
        if (!p.start_date || !p.end_date) {
          return new Response(JSON.stringify({ error: "Missing start_date or end_date" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const artistSearch = p.artist_search?.trim();
        const cityHint = p.city && p.city !== "flexible" ? `Focus on ${p.city}.` : "Search across US cities with strong golf and live music scenes — vary the cities for different options.";
        const eventHint = artistSearch
          ? `Find 3 different tour dates for "${artistSearch}" in different cities. Each option must be this artist.`
          : (p.event_details ? `User preference: ${String(p.event_details).slice(0, 200)}. Prioritize when relevant.` : "");
        const discoverPrompt = `Search the web for 3 REAL upcoming concerts. Return ONLY valid JSON with this exact structure (no markdown):

{
  "concert_options": [
    { "artist": "string", "city": "string", "venue": "string", "date": "YYYY-MM-DD", "url": "ticket purchase URL" },
    ... (exactly 3 options)
  ]
}

Requirements:
- Venue capacity must be at least 5,000 people (arenas, amphitheaters, large venues only)
- Concert must be in a city that has quality public golf within 25 miles (we add golf in the next step)
- Use Ticketmaster, SeatGeek, StubHub, or official venue sites. Return real ticket URLs.
- Dates between ${p.start_date} and ${p.end_date}
- ${cityHint}
${eventHint}
- Pick 3 different artist+city+date combinations so the user has real choices
${artistSearch ? `- IMPORTANT: All 3 must be "${artistSearch}" — different cities and dates on their tour.` : ""}`;

        const discRes = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You return only valid JSON. No markdown, no explanation." },
              { role: "user", content: discoverPrompt },
            ],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        });
        if (!discRes.ok) {
          const errText = await discRes.text();
          console.error("Perplexity discover error:", discRes.status, errText);
          let errMsg = "Concert discovery failed";
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson?.error?.message || errJson?.error || errMsg;
          } catch { /* use default */ }
          return new Response(JSON.stringify({ error: errMsg }), {
            status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const discData = await discRes.json();
        const discContent = discData.choices?.[0]?.message?.content;
        if (!discContent) {
          return new Response(JSON.stringify({ error: "Empty discovery response" }), {
            status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        let concertOptions: any;
        try {
          const cleaned = discContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          concertOptions = JSON.parse(cleaned);
        } catch {
          const lower = discContent.toLowerCase();
          if (lower.includes("no upcoming") || lower.includes("couldn't find") || lower.includes("could not find") || lower.includes("not touring") || lower.includes("no concerts")) {
            return new Response(JSON.stringify({ success: true, concert_options: [] }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          console.error("Failed to parse discovery JSON:", discContent.substring(0, 300));
          return new Response(JSON.stringify({ error: "Invalid discovery response format" }), {
            status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, concert_options: concertOptions.concert_options || [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Stage 2: Full itinerary — requires (city or selected_concert) and dates
      if (!p.start_date || !p.end_date) {
        return new Response(JSON.stringify({ error: "Missing required fields: start_date, end_date" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const selectedConcert = p.selected_concert;
      const cityFromConcert = selectedConcert?.city;
      const effectiveCity = cityFromConcert || (p.city && p.city !== "flexible" ? p.city : "Austin");

      const rawSearchResults =
        p.search_results ||
        p.searchResults ||
        body?.search_results ||
        body?.searchResults ||
        {};
      let events = Array.isArray(rawSearchResults.events) ? rawSearchResults.events.slice(0, 6) : [];
      console.log("[TM_LINK_DEBUG] generate-itinerary input events", events.map((e: any) => ({ name: e.name, book_url: e.book_url, source_url: e.source_url })));
      let golfCourses = Array.isArray(rawSearchResults.golf_courses)
        ? rawSearchResults.golf_courses.slice(0, 12)
        : [];
      let bronzeGolfCandidates = Array.isArray(rawSearchResults.bronze_golf_candidates) ? rawSearchResults.bronze_golf_candidates : null;
      let silverGolfCandidates = Array.isArray(rawSearchResults.silver_golf_candidates) ? rawSearchResults.silver_golf_candidates : null;
      let goldGolfCandidates = Array.isArray(rawSearchResults.gold_golf_candidates) ? rawSearchResults.gold_golf_candidates : null;
      let hotels = Array.isArray(rawSearchResults.hotels) ? rawSearchResults.hotels.slice(0, 6) : [];

      function buildTicketmasterSearchUrl(name: string, city: string, venue?: string): string {
        const parts = [name];
        if (venue?.trim()) parts.push(venue.trim());
        parts.push(city);
        const q = parts.filter(Boolean).join(" ").trim() || "concerts";
        return `https://www.ticketmaster.com/search?q=${encodeURIComponent(q)}`;
      }

      // When user selected a concert, use it as the sole event. Always use our Ticketmaster search URL
      // so the user lands on Ticketmaster (artist + venue + city) instead of SeatGeek/StubHub/etc. from Perplexity.
      if (selectedConcert?.artist && selectedConcert?.city) {
        const concertUrl = buildTicketmasterSearchUrl(selectedConcert.artist, selectedConcert.city, selectedConcert.venue);
        events = [{
          id: "selected_concert",
          name: selectedConcert.artist,
          date_time: selectedConcert.date ? `${selectedConcert.date}T20:00:00` : `${p.start_date}T20:00:00`,
          venue: { name: selectedConcert.venue || "Venue", city: selectedConcert.city },
          book_url: concertUrl,
          source_url: concertUrl,
          provider: "user_selected",
        }];
      }

      // Fallback mock when frontend doesn't pass search_results
      const fallbackCity = (effectiveCity || selectedConcert?.city || (p.city !== "flexible" ? p.city : null) || "Austin").slice(0, 50);
      if (!golfCourses.length && !hotels.length) {
        golfCourses = [
          { id: "fallback_golf_1", name: "Mock Golf Club", city: fallbackCity, state: "TX", public_access: true, rating: 4.4, tee_time_window: { start: "07:00", end: "11:00" }, book_url: "https://www.golfnow.com/", source_url: "https://www.golfnow.com/", price_min: 80, price_max: 180, provider: "mock" },
        ];
        hotels = [
          { id: "fallback_hotel_1", name: "Mock Boutique Hotel", city: fallbackCity, state: "TX", stars: 4, rating: 4.6, book_url: "https://www.booking.com/", source_url: "https://www.booking.com/", price_min: 160, price_max: 320, provider: "mock" },
        ];
      }
      if (!events.length) {
        const city = fallbackCity;
        const state = "TX";
        events = [
          {
            id: "fallback_evt_1",
            name: "Sample Concert",
            date_time: `${p.start_date}T20:00:00-05:00`,
            venue: { name: "Mock Arena", city, state, capacity: 12000 },
            book_url: "https://www.ticketmaster.com/",
            source_url: "https://www.ticketmaster.com/",
            price_min: 75,
            price_max: 250,
            provider: "mock",
          },
        ];
        golfCourses = [
          {
            id: "fallback_golf_1",
            name: "Mock Golf Club",
            city,
            state,
            public_access: true,
            rating: 4.4,
            tee_time_window: { start: "07:00", end: "11:00" },
            book_url: "https://www.golfnow.com/",
            source_url: "https://www.golfnow.com/",
            price_min: 80,
            price_max: 180,
            provider: "mock",
          },
        ];
        hotels = [
          {
            id: "fallback_hotel_1",
            name: "Mock Boutique Hotel",
            city,
            state,
            stars: 4,
            rating: 4.6,
            book_url: "https://www.booking.com/",
            source_url: "https://www.booking.com/",
            price_min: 160,
            price_max: 320,
            provider: "mock",
          },
        ];
      }

      const dbCity = (effectiveCity || fallbackCity).slice(0, 100);
      const { data: inserted, error: insertErr } = await supabase
        .from("itineraries")
        .insert({
          user_id: p.user_id || null,
          path: p.path || "golf_music",
          city: dbCity,
          start_date: p.start_date,
          end_date: p.end_date,
          budget_tier: p.budget_tier || "mid",
          group_size: Math.min(Math.max(Number(p.group_size) || 2, 1), 20),
          preferences: p.preferences || {},
          event_details: typeof p.event_details === "string" ? p.event_details.slice(0, 1000) : null,
          email: p.email || null,
        })
        .select()
        .single();

      if (insertErr || !inserted) {
        console.error("Insert error:", insertErr);
        return new Response(JSON.stringify({ error: "Failed to create itinerary" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      itinerary = inserted;
      itinerary.search_results = {
        events,
        golf_courses: golfCourses,
        bronze_golf_candidates: bronzeGolfCandidates,
        silver_golf_candidates: silverGolfCandidates,
        gold_golf_candidates: goldGolfCandidates,
        hotels,
      };
      itinerary_id = inserted.id;
    } else {
      // Legacy mode: fetch existing itinerary by ID
      itinerary_id = typeof body?.itinerary_id === "string" ? body.itinerary_id.trim() : "";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!itinerary_id || !uuidRegex.test(itinerary_id)) {
        return new Response(JSON.stringify({ error: "Invalid or missing itinerary_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: fetched, error: fetchErr } = await supabase
        .from("itineraries")
        .select("*")
        .eq("id", itinerary_id)
        .single();

      if (fetchErr || !fetched) {
        return new Response(JSON.stringify({ error: "Itinerary not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      itinerary = fetched;
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

    let searchResults = itinerary.search_results || { events: [], golf_courses: [], hotels: [] };
    if (!searchResults.events?.length && !searchResults.golf_courses?.length && !searchResults.hotels?.length) {
      const city = (itinerary.city === "flexible" ? "Austin" : itinerary.city || "Austin").slice(0, 50);
      searchResults = {
        events: [
          { id: "fallback_evt_1", name: "Sample Concert", date_time: `${itinerary.start_date}T20:00:00-05:00`, venue: { name: "Mock Arena", city, state: "TX", capacity: 12000 }, book_url: "https://www.ticketmaster.com/", source_url: "https://www.ticketmaster.com/", price_min: 75, price_max: 250, provider: "mock" },
        ],
        golf_courses: [
          { id: "fallback_golf_1", name: "Mock Golf Club", city, state: "TX", public_access: true, rating: 4.4, tee_time_window: { start: "07:00", end: "11:00" }, book_url: "https://www.golfnow.com/", source_url: "https://www.golfnow.com/", price_min: 80, price_max: 180, provider: "mock" },
        ],
        hotels: [
          { id: "fallback_hotel_1", name: "Mock Boutique Hotel", city, state: "TX", stars: 4, rating: 4.6, book_url: "https://www.booking.com/", source_url: "https://www.booking.com/", price_min: 160, price_max: 320, provider: "mock" },
        ],
      };
    }
    const events = searchResults.events || [];
    const golfCourses = (searchResults.golf_courses || []).slice(0, 12);
    const hotels = searchResults.hotels || [];
    const poolBronze = Array.isArray(searchResults.bronze_golf_candidates) ? searchResults.bronze_golf_candidates : null;
    const poolSilver = Array.isArray(searchResults.silver_golf_candidates) ? searchResults.silver_golf_candidates : null;
    const poolGold = Array.isArray(searchResults.gold_golf_candidates) ? searchResults.gold_golf_candidates : null;
    const toGolfEntry = (g: any) => ({
      name: g.name,
      url: g.book_url || g.source_url,
      ...(g.drive_time_minutes != null && { drive_mins: g.drive_time_minutes }),
      ...(g.distance_miles != null && { miles: g.distance_miles }),
    });
    const golfBronze = poolBronze?.length ? poolBronze.map(toGolfEntry) : golfCourses.filter((g: any) => g.tier_hint === "bronze").map(toGolfEntry);
    const golfSilver = poolSilver?.length ? poolSilver.map(toGolfEntry) : golfCourses.filter((g: any) => g.tier_hint === "silver").map(toGolfEntry);
    const golfGold = poolGold?.length ? poolGold.map(toGolfEntry) : golfCourses.filter((g: any) => g.tier_hint === "gold").map(toGolfEntry);
    const golfUnassigned = golfCourses.filter((g: any) => !g.tier_hint || !["bronze", "silver", "gold"].includes(g.tier_hint)).map(toGolfEntry);
    const hasRealHotels = hotels.length > 0 && hotels.some((h: any) => h.provider !== "mock");
    const hasRealData = events.length > 0 || golfCourses.length > 0 || hotels.length > 0;
    const hasTieredGolf = golfBronze.length > 0 || golfSilver.length > 0 || golfGold.length > 0;
    const realDataSection = hasRealData
      ? `
REAL DATA PROVIDED (use these exact options in your packages; include their book_url/ticket URLs):
${events.length ? `- CONCERTS: ${JSON.stringify(events.slice(0, 6).map((e: any) => ({ name: e.name, venue: e.venue?.name, date: e.date_time, url: e.book_url || e.source_url })))}` : ""}
${golfCourses.length && !hasTieredGolf ? `- GOLF (all): ${JSON.stringify(golfCourses.slice(0, 6).map((g: any) => ({ name: g.name, url: g.book_url || g.source_url })))}` : ""}
${hasTieredGolf ? `- GOLF by tier (CRITICAL – use ONLY from the matching list per package):
  * BRONZE package golf: ${JSON.stringify(golfBronze.length ? golfBronze : golfUnassigned)}
  * SILVER package golf: ${JSON.stringify(golfSilver.length ? golfSilver : golfUnassigned)}
  * GOLD package golf: ${JSON.stringify(golfGold.length ? golfGold : golfUnassigned)}
  ${golfUnassigned.length ? `(If a tier list is empty, use from: ${JSON.stringify(golfUnassigned)})` : ""}` : ""}
${hasRealHotels ? `- HOTELS: ${JSON.stringify(hotels.slice(0, 6).map((h: any) => ({ name: h.name, url: h.book_url || h.source_url })))}` : ""}
${!hasRealHotels && hotels.length > 0 ? `- HOTELS: (none provided – SEARCH the web for real hotels in ${itinerary.city} on Expedia, Booking.com, or Hotels.com. Use actual hotel names and booking URLs.)` : ""}

Use the URLs above when composing packages. Do not invent different events or links.${!hasRealHotels ? " For hotels, search the web as instructed." : ""}
${hasTieredGolf ? `
GOLF TIER RULE (MANDATORY): For each package, pick golf courses ONLY from that package's tier list above. BRONZE package → use only from BRONZE golf list. SILVER → only from SILVER golf list. GOLD → only from GOLD golf list. Never use the same golf course in multiple packages. Each tier must have different golf. All golf, lodging, and the venue are within 30 miles of each other. When golf entries include drive_mins or miles, you may mention them in the "why" for context.` : ""}`
      : "";

    const systemPrompt = `You are Experience Caddie, an AI travel planner specializing in legendary golf + concert weekend getaways. 
You create curated trip packages with real vendor search links for booking.
You MUST respond with ONLY valid JSON matching the exact schema specified. No markdown, no explanation, just JSON.
CRITICAL: Be concise. Keep "why" and "assumptions" to 1 short sentence each. Limit "plan" arrays to 3-4 items per day. Your response MUST be complete valid JSON — do not truncate.`;

    const cityForSearch = itinerary.city;
    const selectedConcertNote = (searchResults.events || []).find((e: any) => e.provider === "user_selected")
      ? `\nCONCERT ALREADY CHOSEN: The user selected a concert (${(searchResults.events?.[0] as any)?.name} in ${(searchResults.events?.[0] as any)?.venue?.city}). Use this concert in all packages. Focus your search on golf and hotels only. Lodging, concert venue, and golf must all be within 30 miles of each other.`
      : "";
    const userPrompt = `Search the web for REAL upcoming concerts, public golf courses, and hotels, then create 3 curated weekend packages (Bronze, Silver, Gold tiers) for this golf + concert trip.

Trip details:
- City: ${cityForSearch}
- Dates: ${itinerary.start_date} to ${itinerary.end_date}
- Budget: ${budgetLabel}
- Group size: ${itinerary.group_size}
${prefs ? `- Preferences: ${prefsList || "none specified"}` : ""}
${itinerary.event_details ? `- Event details: ${itinerary.event_details}` : ""}
${selectedConcertNote}
${realDataSection}
${!hasRealData ? `
SEARCH for and use REAL data:
1. Concerts/events: Search Ticketmaster, SeatGeek, StubHub, or venue sites for upcoming shows in ${cityForSearch} between ${itinerary.start_date} and ${itinerary.end_date}. Venues must be at least 5,000 capacity. Use actual event names, venues, dates, and real ticket purchase URLs.
2. Golf: Search for public golf courses within 30 miles of ${cityForSearch}. Use GolfNow, TeeOff, or course websites. Include real tee time booking URLs.
3. Hotels: Search Expedia, Booking.com, or Hotels.com for hotels within 30 miles of ${cityForSearch} (and the venue). Use real booking URLs.
4. Extras: Suggest real restaurants, bars, or experiences with Google Maps or OpenTable links.` : ""}

For each tier, include:
- 2-3 lodging options (hotels/vacation rentals/golf resorts only) with real booking URLs. Never put restaurants or bars in lodging.
- 1-2 concert/event options with real ticket URLs
- 2-3 golf course suggestions with real tee time URLs
- 2-4 extras (restaurants, bars, experiences) with real links
- A day-by-day itinerary (covering each day of the trip)
- Estimated total cost range in USD based on typical prices

Return ONLY valid JSON matching this exact structure (no markdown, no explanation). Keep assumptions to 2 short items max:
{
  "summary": {
    "title": "string - catchy trip title",
    "vibe": "string - 1-2 sentence vibe",
    "estimated_total_range_usd": [min_number, max_number],
    "assumptions": ["short string", "short string"]
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

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 16384,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Perplexity API error:", response.status, errText);

      if (response.status === 429) {
        await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 401 || response.status === 402) {
        await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
        return new Response(JSON.stringify({ error: "Perplexity API key invalid or quota exceeded." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let errMsg = "Failed to generate itinerary";
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson?.error?.message || errJson?.error || errMsg;
      } catch { /* use default */ }
      await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
      return new Response(JSON.stringify({ error: errMsg }), {
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
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsedResult = JSON.parse(jsonMatch[0]);
      } catch {
        /* fall through to error */
      }
      if (!parsedResult) {
        console.error("Failed to parse AI JSON:", content.substring(0, 500));
        await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
        return new Response(JSON.stringify({ error: "AI returned invalid format. Please try again." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Enrich packages with trust metadata from search_results (match by name)
    const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const MIN_SUBSTRING_LEN = 15; // avoid "Golf" or "Muni" matching wrong courses
    const allGolfSources = [
      ...(poolBronze || []),
      ...(poolSilver || []),
      ...(poolGold || []),
      ...golfCourses,
    ];
    const golfByName = new Map<string, any>();
    for (const g of allGolfSources) {
      const key = norm(g.name);
      if (!golfByName.has(key)) golfByName.set(key, g);
    }
    for (const g of golfCourses) {
      const key = norm(g.name);
      if (!golfByName.has(key)) golfByName.set(key, g);
    }
    const findGolfMatch = (llmName: string): any | null => {
      const n = norm(llmName);
      const exact = golfByName.get(n);
      if (exact) return exact;
      for (const [srcKey, src] of golfByName) {
        const shorter = n.length <= srcKey.length ? n : srcKey;
        const longer = n.length > srcKey.length ? n : srcKey;
        if (shorter.length >= MIN_SUBSTRING_LEN && longer.includes(shorter)) return src;
      }
      return null;
    };
    const eventByName = new Map<string, any>();
    for (const e of events) {
      const key = norm(e.name);
      if (!eventByName.has(key)) eventByName.set(key, e);
    }
    const generatedAt = new Date().toISOString();
    const buildMapsUrl = (src: any): string | undefined => {
      if (src.google_maps_uri?.includes("google.com/maps")) return src.google_maps_uri;
      const id = (src.id || "").replace(/^places\//, "");
      if (id.startsWith("ChIJ")) return `https://www.google.com/maps/search/?api=1&query_place_id=${id}`;
      if (src.lat != null && src.lng != null) return `https://www.google.com/maps?q=${src.lat},${src.lng}`;
      return undefined;
    };
    for (const pkg of parsedResult.packages || []) {
      for (const g of pkg.golf || []) {
        const src = findGolfMatch(g.name);
        if (src) {
          if (src.drive_time_minutes != null) g.drive_time_minutes = src.drive_time_minutes;
          if (src.distance_miles != null) g.distance_miles = src.distance_miles;
          if (src.public_access_confidence) g.public_access_confidence = src.public_access_confidence;
          if (src.provider) g.provider = src.provider;
          if (src.source_url) g.source_url = src.source_url;
          const mapsUrl = buildMapsUrl(src);
          if (mapsUrl) g.maps_url = mapsUrl;
          if (src.as_of) g.as_of = src.as_of;
          if (src.id) g.place_id = src.id;
          if (src.lat != null) g.lat = src.lat;
          if (src.lng != null) g.lng = src.lng;
        }
      }
      for (const e of pkg.events || []) {
        const src = eventByName.get(norm(e.name));
        const urlBefore = e.url;
        if (src) {
          if (src.provider) e.provider = src.provider;
          if (src.venue && typeof src.venue === "object") e.venue_obj = src.venue;
          if (src.date_time && !e.date_time) e.date_time = src.date_time;
          const trustedUrl = src.book_url || src.source_url;
          if (trustedUrl) e.url = trustedUrl;
        }
        console.log("[TM_LINK_DEBUG] generate-itinerary enrich event", { name: e.name, url_before: urlBefore, url_after: e.url, matched: !!src });
      }
    }
    parsedResult._generated_at = generatedAt;
    for (const pkg of parsedResult.packages || []) {
      for (const e of pkg.events || []) {
        console.log("[TM_LINK_DEBUG] generate-itinerary final saved event", { pkg_tier: pkg.tier, name: e.name, url: e.url });
      }
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
  } catch (e: any) {
    console.error("generate-itinerary error:", e);
    const msg = e?.message?.includes("PERPLEXITY") ? "API configuration error. Please try again later." : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
