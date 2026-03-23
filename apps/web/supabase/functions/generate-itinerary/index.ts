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
        // Clamp dates: start at least 2 weeks from today to avoid past events
        const today = new Date();
        const twoWeeksFromNow = new Date(today);
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
        const nineMonthsLater = new Date(twoWeeksFromNow);
        nineMonthsLater.setMonth(nineMonthsLater.getMonth() + 9);
        const minStart = twoWeeksFromNow.toISOString().slice(0, 10);
        const maxEnd = nineMonthsLater.toISOString().slice(0, 10);
        let discStart = String(p.start_date).slice(0, 10);
        let discEnd = String(p.end_date).slice(0, 10);
        if (discStart < minStart) discStart = minStart;
        if (discEnd <= discStart) discEnd = maxEnd;
        if (discEnd > maxEnd) discEnd = maxEnd;

        const artistSearch = p.artist_search?.trim();
        const cityHint = p.city && p.city !== "flexible" ? `Focus on ${p.city}.` : "Search cities like Nashville, Phoenix, Austin, Las Vegas, Denver, Atlanta, Dallas — places with arenas and good golf nearby.";
        const eventDetails = String(p.event_details || "").toLowerCase();
        const isBroadDiscover = !artistSearch && (eventDetails.includes("genres: any") || eventDetails.includes("discover for me") || !eventDetails.trim());
        const eventHint = artistSearch
          ? `Find 3 different tour dates for "${artistSearch}" in different cities. Each option must be this artist.`
          : isBroadDiscover
          ? "Pick 3 high-demand upcoming arena or amphitheater concerts — any genre. Include major tours (country, rock, pop, etc.). Vary the artists and cities."
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
- Concert MUST be in the United States (US-only). Do NOT return international dates/cities.
- Concert must be in a city with good public golf nearby (Nashville, Phoenix, Austin, Vegas, Denver, Atlanta, Dallas, etc.)
- Use Ticketmaster, SeatGeek, StubHub, or official venue sites. Return real ticket URLs.
- Dates MUST be between ${discStart} and ${discEnd}. Use YYYY-MM-DD format for the date field.
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

        // Filter out past concerts — only when we can reliably parse
        // LLM may use date, event_date, or return "April 15, 2025"; if we can't parse, keep the concert
        let opts = concertOptions.concert_options || [];
        opts = opts.filter((c: Record<string, unknown>) => {
          const raw = String(c.date || c.event_date || c.eventDate || "").trim();
          if (!raw) return true; // no date — keep it
          const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (isoMatch) {
            const d = isoMatch[0];
            return d >= discStart;
          }
          const parsed = new Date(raw);
          if (!isNaN(parsed.getTime())) {
            const d = parsed.toISOString().slice(0, 10);
            return d >= discStart;
          }
          return true; // unknown format — keep it
        });

        return new Response(JSON.stringify({ success: true, concert_options: opts }), {
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

      function buildTicketmasterSearchUrl(searchTerm: string): string {
        const q = (searchTerm || "").trim() || "concerts";
        return `https://www.ticketmaster.com/search?q=${encodeURIComponent(q)}`;
      }

      // When user selected a concert, use Ticketmaster artist search URL only (reliable; avoids 404s from Perplexity/SeatGeek/event-specific URLs).
      if (selectedConcert?.artist && selectedConcert?.city) {
        const concertUrl = buildTicketmasterSearchUrl(selectedConcert.artist);
        const concertLink = {
          url: concertUrl,
          provider: "Ticketmaster",
          category: "concert" as const,
          link_type: "provider_search" as const,
          label: "Find tickets",
          is_verified: false,
          confidence: "medium" as const,
          disclaimer: "Opens Ticketmaster search results for this event",
        };
        events = [{
          id: "selected_concert",
          name: selectedConcert.artist,
          date_time: selectedConcert.date ? `${selectedConcert.date}T20:00:00` : `${p.start_date}T20:00:00`,
          venue: { name: selectedConcert.venue || "Venue", city: selectedConcert.city },
          book_url: concertUrl,
          source_url: concertUrl,
          book_link: concertLink,
          provider: "user_selected",
        }];
      }

      // Fallback mock when frontend doesn't pass search_results
      const fallbackCity = (effectiveCity || selectedConcert?.city || (p.city !== "flexible" ? p.city : null) || "Austin").slice(0, 50);
      const fallbackGolfLink = { url: "https://www.golfnow.com/", provider: "GolfNow", category: "golf" as const, link_type: "provider_search" as const, label: "Search tee times", is_verified: false, confidence: "medium" as const, disclaimer: "Opens external golf search results; tee time availability is not confirmed in Experience Caddie" };
      if (!golfCourses.length && !hotels.length) {
        golfCourses = [
          { id: "fallback_golf_1", name: "Mock Golf Club", city: fallbackCity, state: "TX", public_access: true, rating: 4.4, tee_time_window: { start: "07:00", end: "11:00" }, book_url: "https://www.golfnow.com/", source_url: "https://www.golfnow.com/", book_link: fallbackGolfLink, price_min: 80, price_max: 180, provider: "mock" },
        ];
        hotels = [
          { id: "fallback_hotel_1", name: "Mock Boutique Hotel", city: fallbackCity, state: "TX", stars: 4, rating: 4.6, book_url: "https://www.google.com/travel/hotels?q=hotels", source_url: "https://www.google.com/travel/hotels?q=hotels", price_min: 160, price_max: 320, provider: "mock" },
        ];
      }
      if (!events.length) {
        const city = fallbackCity;
        const state = "TX";
        const fallbackConcertUrl = "https://www.google.com/search?q=concerts+tickets";
        const fallbackConcertLink = {
          url: fallbackConcertUrl,
          provider: "Google",
          category: "concert" as const,
          link_type: "provider_search" as const,
          label: "Search tickets",
          is_verified: false,
          confidence: "medium" as const,
          disclaimer: "Opens ticket search results across multiple vendors; availability is not confirmed in Experience Caddie",
        };
        events = [
          {
            id: "fallback_evt_1",
            name: "Sample Concert",
            date_time: `${p.start_date}T20:00:00-05:00`,
            venue: { name: "Mock Arena", city, state, capacity: 12000 },
            book_url: fallbackConcertUrl,
            source_url: fallbackConcertUrl,
            book_link: fallbackConcertLink,
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
            book_link: fallbackGolfLink,
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
            book_url: "https://www.google.com/travel/hotels?q=hotels",
            source_url: "https://www.google.com/travel/hotels?q=hotels",
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
    const fallbackGolfLink = { url: "https://www.golfnow.com/", provider: "GolfNow", category: "golf" as const, link_type: "provider_search" as const, label: "Search tee times", is_verified: false, confidence: "medium" as const, disclaimer: "Opens external golf search results; tee time availability is not confirmed in Experience Caddie" };
    if (!searchResults.events?.length && !searchResults.golf_courses?.length && !searchResults.hotels?.length) {
      const city = (itinerary.city === "flexible" ? "Austin" : itinerary.city || "Austin").slice(0, 50);
      searchResults = {
        events: [
          { id: "fallback_evt_1", name: "Sample Concert", date_time: `${itinerary.start_date}T20:00:00-05:00`, venue: { name: "Mock Arena", city, state: "TX", capacity: 12000 }, book_url: "https://www.google.com/search?q=concerts+tickets", source_url: "https://www.google.com/search?q=concerts+tickets", price_min: 75, price_max: 250, provider: "mock" },
        ],
        golf_courses: [
          { id: "fallback_golf_1", name: "Mock Golf Club", city, state: "TX", public_access: true, rating: 4.4, tee_time_window: { start: "07:00", end: "11:00" }, book_url: "https://www.golfnow.com/", source_url: "https://www.golfnow.com/", book_link: fallbackGolfLink, price_min: 80, price_max: 180, provider: "mock" },
        ],
        hotels: [
          { id: "fallback_hotel_1", name: "Mock Boutique Hotel", city, state: "TX", stars: 4, rating: 4.6, book_url: "https://www.google.com/travel/hotels?q=hotels", source_url: "https://www.google.com/travel/hotels?q=hotels", price_min: 160, price_max: 320, provider: "mock" },
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
    const golfGoldRaw = poolGold?.length ? poolGold.map(toGolfEntry) : golfCourses.filter((g: any) => g.tier_hint === "gold").map(toGolfEntry);
    const golfUnassigned = golfCourses.filter((g: any) => !g.tier_hint || !["bronze", "silver", "gold"].includes(g.tier_hint)).map(toGolfEntry);
    // Fallback: if Gold pool is empty, use Silver (or Bronze) so Gold package always has golf options
    const golfGold = golfGoldRaw.length > 0 ? golfGoldRaw : (golfSilver.length > 0 ? golfSilver : (golfBronze.length > 0 ? golfBronze : golfUnassigned));
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
${!hasRealHotels && hotels.length > 0 ? `- HOTELS: (none provided – SEARCH the web for real hotels in ${itinerary.city} on Expedia, Booking.com, or Hotels.com. Use actual property names as listed on those sites (e.g. "Hotel Van Zandt", "W Austin") and real booking URLs. Do not use vague names like "convenient option" or "boutique hotel near venue".)` : ""}

Use the URLs above when composing packages. Do not invent different events or links.${!hasRealHotels ? " For hotels, search the web as instructed." : ""}
${events.length > 0 ? `
CONCERT RULE (MANDATORY): For each package, use ONLY concerts from the CONCERTS list above. Do not add or substitute any event not in that list—these are verified events with active ticket listings. Spread the listed concerts across tiers (e.g. different events per tier) so each package has real options.` : ""}
${hasTieredGolf ? `
GOLF TIER RULE (MANDATORY): For each package, pick golf courses ONLY from that package's tier list above. BRONZE package → use only from BRONZE golf list. SILVER → only from SILVER golf list. GOLD → only from GOLD golf list. Do NOT add golf courses from your own web search—use ONLY the courses listed. Exclude country clubs, private clubs, and members-only courses. Never use the same golf course in multiple packages. Each tier must have different golf. All golf, lodging, and the venue are within 30 miles of each other. When golf entries include drive_mins or miles, you may mention them in the "why" for context.` : ""}`
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
1. Concerts/events: Search Ticketmaster first for upcoming shows in ${cityForSearch} between ${itinerary.start_date} and ${itinerary.end_date}. Prefer events that appear on Ticketmaster.com so the "Find Tickets" link works. Venues must be at least 5,000 capacity. Use actual event names, venues, dates, and real ticket purchase URLs.
2. Golf: Search for PUBLIC golf courses only (no private clubs or members-only) within 30 miles of ${cityForSearch}. Use GolfNow, TeeOff, or municipal/city course websites. Include real tee time booking URLs. Do NOT include country clubs or private clubs.
3. Hotels: Search Expedia, Booking.com, or Hotels.com for hotels within 30 miles of ${cityForSearch} (and the venue). Prefer well-known chains or major properties (e.g. Marriott, Hilton, Hyatt, IHG, or established names widely listed on Booking.com) and hotels in main tourist/business districts near the venue—they are more likely to have availability. Use real property names and real booking URLs. Do not use vague names like "convenient option" or "hotel near venue".
4. Extras: Suggest real restaurants, bars, or experiences with Google Maps or OpenTable links.` : ""}

For each tier, include:
- 2-3 lodging options (hotels/vacation rentals/golf resorts only) with real booking URLs. Never put restaurants or bars in lodging.
- 1-2 concert/event options with real ticket URLs
- 2-3 golf course suggestions with real tee time URLs
- 2-4 extras (restaurants, bars, experiences) with real links
- A day-by-day itinerary (covering each day of the trip)
- Estimated total cost range in USD based on typical prices

LODGING RULES (mandatory):
- For each lodging, "name" MUST be the real, official property name as it appears on Booking.com or Expedia (e.g. "Hotel Van Zandt", "The Driskill", "W Austin"). Do NOT use vague descriptions or placeholder names.
- Prefer properties that are likely to have availability: well-known chains (Marriott, Hilton, Hyatt, IHG, etc.) or established names widely listed on Booking.com, and hotels in main tourist or business districts near the venue. Avoid very small boutiques or single-property inns unless they are clearly widely bookable.
- FORBIDDEN lodging names: "Convenient option", "Hotel near venue", "Mid-range hotel", "Budget option", "Luxury downtown hotel", or any phrase that describes the stay instead of naming the property. If you cannot find a real property name, use a specific search result (e.g. "South Congress Hotel" not "Boutique hotel in South Austin").
- "area" must be a real neighborhood or area (e.g. "Downtown Austin", "East Nashville"). Keep "why" to one short sentence.
- In each package, include at least one lodging that is a well-known chain or large property (e.g. Marriott, Hilton, Hyatt, IHG) so users have an option likely to show availability for the dates.

In "assumptions", include one short line that ticket and hotel availability are subject to change and users should confirm on the linked site.

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
        { "name": "string - official property name only (e.g. Hotel Van Zandt)", "type": "hotel" | "vacation_rental" | "golf_resort", "area": "string - neighborhood or area", "price_per_night": "string", "url": "string", "why": "string" }
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

    // Post-filter: remove golf courses from LLM output that match private patterns (LLM sometimes adds these from its own web search)
    const isLikelyPrivateGolf = (name: string): boolean => {
      const n = (name || "").toLowerCase();
      if (/municipal|muny|public\b|city\b|park\b|recreation|community\b/i.test(n)) return false;
      if (/country club|private club|private\b|members only|members'? club|invitation only|invite only|invitational|athletic club|golf & country|golf and country|exclusive|membership|member's club|invite.?only/i.test(n)) return true;
      if (/\bclub\b|golf club/i.test(n) && !/municipal|muny|public|city|park|recreation|community/i.test(n)) return true;
      if (/\bclub\s+at\b|club\s+de\b|the\s+club\s+at|country\s+club/i.test(n)) return true;
      return false;
    };
    for (const pkg of parsedResult.packages || []) {
      if (Array.isArray(pkg.golf)) {
        pkg.golf = pkg.golf.filter((g: any) => !isLikelyPrivateGolf(g?.name || ""));
      }
    }

    // Concert URLs: replace Ticketmaster search/SeatGeek/StubHub links with Google search (aggregates vendors; avoids "no results" on Ticketmaster). Keep direct event URLs (/event/).
    const shouldReplaceConcertUrl = (url: string): boolean => {
      if (!url || typeof url !== "string") return true;
      const u = url.trim().toLowerCase();
      if (!u.startsWith("http")) return true;
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.replace(/^www\./, "");
        const path = parsed.pathname || "";
        if ((host === "ticketmaster.com" || host.endsWith(".ticketmaster.com")) && /\/event\//i.test(path)) return false; // keep direct event links
        const isTicketSite = ["ticketmaster.com", "livenation.com", "seatgeek.com", "stubhub.com", "vividseats.com"].some((d) => host === d || host.endsWith("." + d));
        return isTicketSite;
      } catch {
        return true;
      }
    };
    const extractArtistForSearch = (name: string): string => {
      if (!name || typeof name !== "string") return "concerts";
      const n = name.trim();
      const beforeDash = n.split(/\s+-\s+/)[0]?.trim();
      const beforeAt = n.split(/\s+at\s+/i)[0]?.trim();
      return (beforeDash?.length && beforeDash.length <= (beforeAt?.length ?? 999)) ? beforeDash : (beforeAt || n) || "concerts";
    };
    const buildConcertSearchUrl = (eventName: string, city: string): string => {
      const artist = extractArtistForSearch(eventName || "");
      const cityPart = (city || "").trim().toLowerCase();
      const validCity = cityPart && cityPart !== "flexible" && cityPart !== "various";
      const q = validCity ? `${artist} tickets ${cityPart}`.trim() : `${artist} tickets`.trim();
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      console.log("[CONCERT_LINK_DEBUG] buildConcertSearchUrl", { eventName, artist, city, q, url });
      return url;
    };

    // Always replace OTA hotel URLs with our hotel search link so users get a consistent, working experience
    const shouldReplaceHotelUrl = (url: string): boolean => {
      if (!url || typeof url !== "string") return true;
      const u = url.trim().toLowerCase();
      if (!u.startsWith("http")) return true;
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.replace(/^www\./, "");
        const isOta = ["booking.com", "expedia.com", "hotels.com", "hotel.com"].some((d) => host === d || host.endsWith("." + d));
        if (isOta) return true; // always replace OTA links with our search URL (LLM links often 404 or go to generic page)
        return false; // keep non-OTA URLs (e.g. a hotel's own site)
      } catch {
        return true;
      }
    };
    // Normalize LLM hotel name for hotel search: strip fluff, limit length, detect vague names
    const HOTEL_NAME_FLUFF = /\b(luxury|boutique|downtown|historic|convenient|mid-range|midrange|budget-friendly|premium|upscale|affordable|central|charming|cozy|elegant|modern|traditional)\b/gi;
    const HOTEL_NAME_SUFFIX = /\s*(?:&\s*suites?|&\s*spa|hotel\s*&\s*suites?|-\s*.*)$/i;
    const VAGUE_PATTERNS = /^(option|hotel\s*near|near\s*(venue|airport|downtown)|hotels?\s*in|stays?|accommodation|lodging)$/i;
    const MAX_SEARCH_NAME_WORDS = 5;
    const MAX_SEARCH_NAME_LEN = 50;

    const normalizeHotelNameForSearch = (name: string): { searchName: string; isLowConfidence: boolean } => {
      if (!name || typeof name !== "string") return { searchName: "", isLowConfidence: true };
      let s = name
        .replace(/["']/g, " ")
        .replace(HOTEL_NAME_FLUFF, " ")
        .replace(HOTEL_NAME_SUFFIX, "")
        .replace(/\s+/g, " ")
        .trim();
      const words = s.split(/\s+/).filter(Boolean);
      s = words.slice(0, MAX_SEARCH_NAME_WORDS).join(" ").slice(0, MAX_SEARCH_NAME_LEN).trim();
      const isLowConfidence = s.length < 2 || VAGUE_PATTERNS.test(s) || words.length <= 1 && s.length < 10;
      return { searchName: s, isLowConfidence };
    };

    // Hotel dates: use actual trip dates when span ≤ 14 days; when flexible (wide window), derive from package event date.
    const MAX_HOTEL_STAY_DAYS = 14;
    const DEFAULT_HOTEL_NIGHTS = 4;
    const NIGHTS_AFTER_EVENT = 2; // checkout = event date + 2 days
    const NIGHTS_BEFORE_EVENT = 1; // checkin = event date - 1 day
    const toDate = (s: string): Date | null => {
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const d = new Date(s + "T12:00:00Z");
      return isNaN(d.getTime()) ? null : d;
    };
    const addDays = (s: string, days: number): string => {
      const d = toDate(s);
      if (!d) return s;
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const parseEventDate = (dateTime: string): string | null => {
      if (!dateTime || typeof dateTime !== "string") return null;
      const part = dateTime.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(part) ? part : null;
    };
    const getEarliestEventDate = (events: any[]): string | null => {
      let earliest: string | null = null;
      for (const e of events || []) {
        const d = parseEventDate(e?.date_time);
        if (d && (!earliest || d < earliest)) earliest = d;
      }
      return earliest;
    };
    const getHotelDateRange = (itinerary: any, pkg: any): { checkin: string; checkout: string } | null => {
      const start = itinerary?.start_date && toDate(itinerary.start_date);
      const end = itinerary?.end_date && toDate(itinerary.end_date);
      if (!start) return null;
      const checkin = itinerary.start_date;
      if (end && end > start) {
        const nights = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        if (nights <= MAX_HOTEL_STAY_DAYS) return { checkin, checkout: itinerary.end_date };
      }
      const eventDate = getEarliestEventDate(pkg?.events || []);
      if (eventDate) {
        const checkinFromEvent = addDays(eventDate, -NIGHTS_BEFORE_EVENT);
        const checkoutFromEvent = addDays(eventDate, NIGHTS_AFTER_EVENT);
        return { checkin: checkinFromEvent, checkout: checkoutFromEvent };
      }
      return { checkin, checkout: addDays(checkin, DEFAULT_HOTEL_NIGHTS) };
    };

    // Use Google Hotels search — reliable, shows real results across Booking.com, Expedia, etc. Booking.com direct search URLs often land on generic/dead-end pages.
    const buildHotelSearchUrl = (name: string, city: string, state?: string, _startDate?: string, _endDate?: string): string => {
      const cleanCity = (city || "").trim().toLowerCase();
      const validCity = cleanCity && cleanCity !== "flexible" && cleanCity !== "various";
      const statePart = (state || "").trim() ? ` ${(state || "").trim()}` : "";

      const { searchName, isLowConfidence } = normalizeHotelNameForSearch(name || "");
      let q: string;
      if (isLowConfidence || !searchName) {
        q = validCity ? `hotels in ${cleanCity}${statePart}`.trim() : "hotels";
      } else {
        const nameLower = searchName.toLowerCase().trim();
        const alreadyHasCity = validCity && nameLower.includes(cleanCity);
        const locPart = validCity ? (alreadyHasCity ? "" : ` ${cleanCity}${statePart}`.trim()) : "";
        q = `${searchName.trim()}${locPart}`.trim() || "hotels";
      }
      q = q.slice(0, 150);
      const url = `https://www.google.com/travel/hotels?q=${encodeURIComponent(q)}`;
      console.log("[HOTEL_LINK_DEBUG] buildHotelSearchUrl", { query: q, url });
      return url;
    };

    // Strip any leading/trailing quotes (ASCII + Unicode) and whitespace so the saved value is never wrapped in quotes
    const stripWrappingQuotes = (s: string): string => {
      if (!s || typeof s !== "string") return s || "";
      let u = s.trim();
      // Strip from start
      u = u.replace(/^[\s"'\u201C\u201D\u201E\u201F\u2033\u2036]+/, "");
      // Strip from end
      u = u.replace(/[\s"'\u201C\u201D\u201E\u201F\u2033\u2036]+$/, "");
      return u.trim();
    };
    const sanitizeLodgingUrl = (url: string, fallbackCity: string, fallbackState?: string): string => {
      if (!url || typeof url !== "string") return url || "";
      const u = stripWrappingQuotes(url);
      const looksInvalid = !u.startsWith("http") || /[\s"'\u201C\u201D\u201E\u201F\u2033\u2036]$/.test(u) || /["'\u201C\u201D]/.test(u);
      if (looksInvalid && fallbackCity) {
        const city = (fallbackCity || "").trim().toLowerCase();
        const statePart = (fallbackState || "").trim() ? ` ${(fallbackState || "").trim()}` : "";
        const q = (city && city !== "flexible" && city !== "various") ? `hotels in ${city}${statePart}`.trim() : "hotels";
        return `https://www.google.com/travel/hotels?q=${encodeURIComponent(q)}`;
      }
      return u;
    };
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
          const trustedUrl = src.book_url || src.source_url;
          if (trustedUrl) g.url = trustedUrl;
          if (src.book_link) g.link = src.book_link;
          const mapsUrl = buildMapsUrl(src);
          if (mapsUrl) g.maps_url = mapsUrl;
          if (src.as_of) g.as_of = src.as_of;
          if (src.id) g.place_id = src.id;
          if (src.lat != null) g.lat = src.lat;
          if (src.lng != null) g.lng = src.lng;
        }
      }
      const pkgCity = itinerary?.city || "";
      for (const e of pkg.events || []) {
        const src = eventByName.get(norm(e.name));
        const urlBefore = e.url;
        if (src) {
          if (src.provider) e.provider = src.provider;
          if (src.venue && typeof src.venue === "object") e.venue_obj = src.venue;
          if (src.date_time && !e.date_time) e.date_time = src.date_time;
          if (!shouldReplaceConcertUrl(src.book_url || src.source_url || "")) {
            const trustedUrl = src.book_url || src.source_url;
            if (trustedUrl) e.url = trustedUrl;
            if (src.book_link) e.link = src.book_link;
          }
        }
        let replacedConcert = false;
        if (shouldReplaceConcertUrl(e.url || "")) {
          replacedConcert = true;
          const city = (e.venue_obj?.city ?? (typeof e.venue === "string" ? e.venue : (e.venue as any)?.city) ?? pkgCity) || pkgCity;
          e.url = buildConcertSearchUrl(e.name || "", city);
          e.link = {
            url: e.url,
            provider: "Google",
            category: "concert",
            link_type: "provider_search",
            label: "Search tickets",
            is_verified: false,
            confidence: "medium",
            disclaimer: "Opens ticket search results across multiple vendors; availability is not confirmed in Experience Caddie",
          };
        }
        console.log("[TM_LINK_DEBUG] generate-itinerary enrich event", { name: e.name, url_before: urlBefore, url_after: e.url, matched: !!src, replaced: replacedConcert });
      }
      const hotelDateRange = getHotelDateRange(itinerary, pkg);
      for (const h of pkg.lodging || []) {
        const url = typeof h.url === "string" ? h.url.trim() : "";
        const originalUrl = url;
        const replaced = shouldReplaceHotelUrl(url);
        const city = itinerary?.city || "";
        const state = itinerary?.state ?? (searchResults?.destination as any)?.state;
        if (replaced) {
          const { isLowConfidence } = normalizeHotelNameForSearch(h.name || "");
          if (isLowConfidence && (h.area || city)) {
            h.name = `Hotels in ${(h.area || city).trim()}`;
          }
          h.url = buildHotelSearchUrl(h.name || "Hotel", city, state, hotelDateRange?.checkin, hotelDateRange?.checkout);
        }
        h.url = sanitizeLodgingUrl(h.url || "", city, state);
        // Structured outbound link (Phase 3 hotel trust model)
        const finalUrl = h.url || "";
        if (replaced) {
          h.link = {
            url: finalUrl,
            provider: finalUrl.includes("awin1.com") ? "Booking.com" : (finalUrl.includes("google.com/travel/hotels") ? "Google Hotels" : (finalUrl.includes("booking.com") ? "Booking.com" : "External")),
            category: "hotel",
            link_type: "provider_search",
            label: "Search hotels",
            is_verified: false,
            confidence: "medium",
            disclaimer: "Opens hotel search results; availability and rates are not confirmed in Experience Caddie",
          };
        } else {
          const provider = finalUrl.includes("booking.com") ? "Booking.com" : finalUrl.includes("expedia.com") ? "Expedia" : finalUrl.includes("hotels.com") ? "Hotels.com" : "External";
          h.link = {
            url: finalUrl,
            provider,
            category: "hotel",
            link_type: "direct_listing",
            label: "Check rates",
            is_verified: false,
            confidence: "low",
          };
        }
        console.log("[HOTEL_LINK_DEBUG] lodging", {
          pkg_tier: pkg.tier,
          name: h.name,
          original_url: originalUrl || "(empty)",
          replacement_fired: replaced,
          final_saved_url: h.url,
          final_is_awin: (h.url || "").includes("awin1.com"),
        });
      }
    }
    parsedResult._generated_at = generatedAt;
    for (const pkg of parsedResult.packages || []) {
      for (const e of pkg.events || []) {
        console.log("[TM_LINK_DEBUG] generate-itinerary final saved event", { pkg_tier: pkg.tier, name: e.name, url: e.url });
      }
      // Ensure no lodging URL is saved with wrapping quotes (safety net before DB write)
      for (const h of pkg.lodging || []) {
        if (typeof h.url === "string") h.url = stripWrappingQuotes(h.url);
        if (h.link && typeof h.link.url === "string") h.link.url = stripWrappingQuotes(h.link.url);
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
