import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reportError } from "../_shared/monitoring.ts";
import {
  buildGoogleTicketsSearchUrl,
  discoverConcertsFromCatalogMetros,
  isWeekendGetawayYmd,
  parseFlexibleDateToYmd,
  resolveConcertFromTicketmaster,
} from "../_shared/ticketmaster.ts";
import { METROS, getMetroByCity, type MetroConfig } from "../_shared/golfCities.ts";
import {
  addCalendarDaysToYmd,
  addMonthsToYmd,
  extractIsoDateYmd,
  minTripStartYmdForTimezone,
  normalizeClientTimeZone,
} from "../_shared/tripWindow.ts";

/** Cities user selected must all map to catalog metros, or we fan out to all 40. */
function resolveDiscoverTargetMetros(cityList: string[]): MetroConfig[] {
  if (cityList.length === 0) return [...METROS];
  const allSupported = cityList.every((c) => getMetroByCity(c) !== null);
  if (allSupported) {
    const metros = cityList.map((c) => getMetroByCity(c)).filter(Boolean) as MetroConfig[];
    const bySlug = new Map<string, MetroConfig>();
    for (const m of metros) bySlug.set(m.slug, m);
    return Array.from(bySlug.values());
  }
  return [...METROS];
}

function concertOptionKey(option: Record<string, unknown>): string {
  return [
    String(option.artist || "").toLowerCase().trim(),
    String(option.city || "").toLowerCase().trim(),
    String(option.date || "").slice(0, 10),
  ].join("|");
}

async function topUpConcertOptionsFromPackages(
  supabase: any,
  currentOptions: Array<Record<string, unknown>>,
  minTripYmd: string,
  maxDiscoveryEnd: string,
  maxReturn: number,
  targetMetros: MetroConfig[]
): Promise<Array<Record<string, unknown>>> {
  if (currentOptions.length >= maxReturn) return currentOptions;
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("packages")
    .select("id,name,event_name,event_date,artist_name,city,verification_evidence_url,events(name,event_date,ticket_url,artists(name),venues(name,city))")
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .limit(100);

  if (error || !Array.isArray(data)) {
    if (error) console.warn("[DISCOVER_TM] package top-up failed:", error.message);
    return currentOptions;
  }

  // Build a set of valid metro slugs so packages are geo-scoped to the user's chosen city.
  // When all metros are targeted (fully flexible), skip the city filter entirely.
  const allMetrosTargeted = targetMetros.length === METROS.length;
  const allowedSlugs = allMetrosTargeted
    ? null
    : new Set(targetMetros.map((m) => m.slug));

  const seen = new Set(currentOptions.map(concertOptionKey));
  const toppedUp = [...currentOptions];
  const packageOptions = data
    .map((row: any) => {
      const event = Array.isArray(row.events) ? row.events[0] : row.events;
      const eventDate = String(row.event_date || event?.event_date || "").slice(0, 10);
      const artist = String(row.artist_name || event?.artists?.name || row.event_name || event?.name || "").trim();
      const eventName = String(row.event_name || event?.name || artist || row.name || "").trim();
      const city = String(row.city || event?.venues?.city || "").trim();
      const venue = String(event?.venues?.name || "Concert Venue").trim();
      const url = String(event?.ticket_url || row.verification_evidence_url || "").trim();
      return { id: `package:${row.id}`, artist, city, venue, date: eventDate, url, eventName };
    })
    .filter((option: Record<string, unknown>) => {
      const date = String(option.date || "").slice(0, 10);
      const eventName = String(option.eventName || option.artist || "");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date < minTripYmd ||
        date > maxDiscoveryEnd ||
        !isWeekendGetawayYmd(date) ||
        String(option.artist || "").trim().length === 0 ||
        String(option.city || "").trim().length === 0 ||
        /\b(nutcracker|ballet|orchestra|symphony|opera)\b/i.test(eventName)
      ) return false;
      // Geo-scope: only include packages whose city resolves to one of the target metros.
      if (allowedSlugs !== null) {
        const packageMetro = getMetroByCity(String(option.city));
        if (!packageMetro || !allowedSlugs.has(packageMetro.slug)) return false;
      }
      return true;
    })
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(a.date || "").localeCompare(String(b.date || "")));

  for (const option of packageOptions) {
    if (toppedUp.length >= maxReturn) break;
    const key = concertOptionKey(option);
    if (seen.has(key)) continue;
    seen.add(key);
    toppedUp.push({
      id: option.id,
      artist: option.artist,
      city: option.city,
      venue: option.venue,
      date: option.date,
      url: option.url,
      _verified_package: true,
    });
  }

  return toppedUp
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(0, maxReturn);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Concert date accuracy rules:
 *   Rule 1 — TM has the event: use TM date + direct ticket link (handled by resolveConcertFromTicketmaster).
 *   Rule 2 — TM doesn't have it but Perplexity confirms a specific date: include with confirmed date
 *            and a Google "[artist] [city] [date] tickets" search URL.
 *   Rule 3 — Neither can confirm a specific date: return null. Caller must drop the concert entirely.
 *
 * Never surfaces a "Date TBD" or a guessed date to users.
 */
async function resolveOrVerifyConcert(
  PERPLEXITY_API_KEY: string,
  artist: string,
  city: string,
  startDate: string,
  endDate: string,
  dateHintYmd?: string | null
): Promise<{
  artist: string;
  city: string;
  venue: string;
  date: string;
  url: string;
  _verified_ticketmaster: boolean;
} | null> {
  // Step 1: Try Ticketmaster (Rule 1)
  try {
    const tmResolved = await resolveConcertFromTicketmaster({
      artist,
      city,
      startDate,
      endDate,
      dateHintYmd,
    });
    if (tmResolved) {
      const ymd = tmResolved.date_time.slice(0, 10);
      return {
        artist,
        city: tmResolved.venue.city,
        venue: tmResolved.venue.name,
        date: ymd,
        url: tmResolved.book_url,
        _verified_ticketmaster: true,
      };
    }
  } catch (tmErr) {
    console.log("[resolveOrVerify] TM lookup failed:", tmErr);
  }

  // Step 2: Perplexity secondary verification (Rule 2)
  const dateContext = dateHintYmd
    ? `around ${dateHintYmd}`
    : `between ${startDate} and ${endDate}`;
  const verifyPrompt = `Is "${artist}" performing in ${city} ${dateContext}?

Return ONLY valid JSON. No markdown, no extra text:
If confirmed with a source: {"confirmed":true,"date":"YYYY-MM-DD","venue":"exact venue name"}
If not confirmed: {"confirmed":false}

IMPORTANT: Return confirmed=true ONLY if you have a reliable web source for this specific date. Do not guess.`;

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: "Concert verification assistant. Return only valid JSON. Never guess dates." },
          { role: "user", content: verifyPrompt },
        ],
        temperature: 0.1,
        max_tokens: 128,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim();
    let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    if (!cleaned.startsWith("{")) {
      const s = cleaned.indexOf("{"); const e = cleaned.lastIndexOf("}");
      if (s !== -1 && e > s) cleaned = cleaned.slice(s, e + 1);
    }
    const parsed = JSON.parse(cleaned);
    if (!parsed.confirmed || !parsed.date) return null;

    const ymd = parseFlexibleDateToYmd(String(parsed.date));
    if (!ymd || ymd < startDate || ymd > endDate) {
      console.log(`[resolveOrVerify] Perplexity date ${parsed.date} out of range [${startDate}, ${endDate}]`);
      return null;
    }

    // Build Google ticket search URL — surfaces StubHub, Vivid Seats, venue box office, etc.
    const d = new Date(ymd + "T12:00:00Z");
    const datePart = !isNaN(d.getTime())
      ? d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : ymd;
    const q = [artist, city, datePart, "tickets"].filter(Boolean).join(" ");
    const googleTicketUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    console.log(`[resolveOrVerify] Perplexity confirmed: ${artist} @ ${city} on ${ymd}`);
    return {
      artist,
      city,
      venue: String(parsed.venue || "Venue TBD").trim(),
      date: ymd,
      url: googleTicketUrl,
      _verified_ticketmaster: false,
    };
  } catch (err) {
    console.log("[resolveOrVerify] Perplexity secondary verify error:", err);
    return null;
  }
}

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
    let isRefreshMode = false;

    // REFRESH MODE: itinerary_id + search_results in request — keep share_slug, only update on success
    const refreshSearchResults = body.payload?.search_results || body.search_results;
    const hasRefreshData = refreshSearchResults && typeof refreshSearchResults === "object" &&
      (Array.isArray(refreshSearchResults.events) || Array.isArray(refreshSearchResults.golf_courses) || Array.isArray(refreshSearchResults.hotels));
    if (body.itinerary_id && hasRefreshData) {
      itinerary_id = String(body.itinerary_id).trim();
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
      itinerary.search_results = refreshSearchResults;
      isRefreshMode = true;
    } else if (body?.payload) {
      const p = body.payload;
      const payloadClientTz = normalizeClientTimeZone(p.client_timezone ?? body.client_timezone);
      const minTripYmd = minTripStartYmdForTimezone(payloadClientTz);
      const validPaths = ["golf_music", "sports", "luxury", "custom"];
      const validBudgets = ["low", "mid", "high"];
      if (!validPaths.includes(p.path)) p.path = "golf_music";
      if (!validBudgets.includes(p.budget_tier)) p.budget_tier = "mid";

      // Stage 1: Concert discovery — Ticketmaster-only across catalog golf metros (no LLM inventing cities/dates).
      if (p.discover_concerts) {
        if (!p.start_date || !p.end_date) {
          return new Response(JSON.stringify({ error: "Missing start_date or end_date" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const artistSearch = p.artist_search?.trim();

        const maxEnd = addMonthsToYmd(minTripYmd, 9);
        let discStart = String(p.start_date).slice(0, 10);
        let discEnd = String(p.end_date).slice(0, 10);
        if (discStart < minTripYmd) discStart = minTripYmd;
        if (discEnd <= discStart) discEnd = maxEnd;
        if (discEnd > maxEnd) discEnd = maxEnd;

        const rawCityInput = p.city && p.city !== "flexible" ? String(p.city).trim() : "";
        const cityList = rawCityInput
          ? rawCityInput.split(",").map((s: string) => s.trim()).filter(Boolean)
          : [];

        const genreMatch = String(p.event_details || "").match(/genres:\s*(.+)$/i);
        const specifiedGenres = genreMatch ? genreMatch[1].trim() : null;
        const hasSpecificGenres = Boolean(specifiedGenres && specifiedGenres.toLowerCase() !== "any");
        const genreTokens =
          hasSpecificGenres && specifiedGenres
            ? specifiedGenres.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
        const excludeEventIds = Array.isArray(p.exclude_event_ids)
          ? p.exclude_event_ids
              .filter((id: unknown): id is string => typeof id === "string")
              .map((id: string) => id.trim())
              .filter(Boolean)
              .slice(0, 25)
          : [];

        const targetMetros = resolveDiscoverTargetMetros(cityList);
        const MAX_RETURN = 5;
        const isSurpriseDiscovery = String(p.event_details || "").trim().toLowerCase().startsWith("surprise me");
        const allowExtendedDiscovery = p.allow_extended_discovery === true || isSurpriseDiscovery;
        const maxDiscoveryEnd = allowExtendedDiscovery ? addCalendarDaysToYmd(discEnd, 180) : discEnd;

        console.log(
          `[DISCOVER_TM] metros=${targetMetros.length} slug=${targetMetros.map((m) => m.slug).join(",")} ` +
            `artist=${artistSearch || "(genre)"} genres=${genreTokens.join("|") || "any"} window=${discStart}..${discEnd}`
        );

        let opts = await discoverConcertsFromCatalogMetros({
          metros: targetMetros,
          startDate: discStart,
          endDate: discEnd,
          artistKeyword: artistSearch || undefined,
          genreTokens,
          maxReturn: MAX_RETURN,
          excludeEventIds,
        });

        opts = opts
          .filter((v) => {
            const d = String(v.date || "").trim().slice(0, 10);
            return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= minTripYmd && d <= maxDiscoveryEnd;
          })
          // Best concert first (highest score), tie-break by date ascending.
          // _score is set by the TM discovery path; packages default to 0 but are only
          // used as fill-ins, so they naturally rank below scored TM results.
          .sort((a, b) => (Number(b._score ?? 0) - Number(a._score ?? 0)) || String(a.date || "").localeCompare(String(b.date || "")))
          .slice(0, MAX_RETURN);

        // Only top-up with catalog packages when no specific artist was requested.
        // For a named artist, padding with unrelated concerts is misleading and hides
        // the "no results" UX the user should see instead.
        if (allowExtendedDiscovery && opts.length < MAX_RETURN && !artistSearch) {
          opts = await topUpConcertOptionsFromPackages(supabase, opts, minTripYmd, maxDiscoveryEnd, MAX_RETURN, targetMetros);
        }

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
      const startYmdGen = String(p.start_date).slice(0, 10);
      if (startYmdGen < minTripYmd) {
        return new Response(
          JSON.stringify({
            error: "invalid_start_date",
            message: "Trip start must be at least 14 calendar days from today in your timezone.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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

      // When a specific concert was selected (homepage package or concert picker),
      // lock all tiers to that single event so the LLM can't assign different dates per tier.
      if (selectedConcert?.artist && (selectedConcert?.date || selectedConcert?.date_time)) {
        const selArtistLower = String(selectedConcert.artist).toLowerCase().trim();
        const selDate = String(selectedConcert.date || selectedConcert.date_time || "").slice(0, 10);
        const isUsableSearchEventMatch = (e: any) => {
          if (!e || e.provider === "mock") return false;
          const u = String(e.book_url || e.source_url || "").toLowerCase();
          if (u.includes("ticketmaster.com/search")) return false;
          return true;
        };
        // Try to find a real search result (not mock / not TM artist search) matching artist + date
        const tmMatch = events.find((e: any) => {
          if (!isUsableSearchEventMatch(e)) return false;
          const eName = String(e.name || "").toLowerCase();
          const eDate = String(e.date_time || "").slice(0, 10);
          const artistInName = eName.includes(selArtistLower) || selArtistLower.includes(eName.split(/\s+/)[0]);
          return artistInName && (!selDate || eDate === selDate);
        });
        if (tmMatch) {
          events = [{ ...tmMatch, provider: "user_selected" }];
        } else {
          // No TM match — synthesise a locked event from the selection
          events = [{
            id: "selected_concert",
            name: `${selectedConcert.artist}${selectedConcert.venue ? ` at ${selectedConcert.venue}` : ""}`,
            date_time: selDate || selectedConcert.date || selectedConcert.date_time || "",
            venue: {
              name: selectedConcert.venue || "Concert Venue",
              city: selectedConcert.city || effectiveCity,
            },
            book_url: selectedConcert.url ||
              buildGoogleTicketsSearchUrl({
                performer: String(selectedConcert.artist).trim(),
                city: String(selectedConcert.city || effectiveCity).trim(),
                venue: selectedConcert.venue ? String(selectedConcert.venue).trim() : undefined,
                dateYmd: selDate || undefined,
              }),
            source_url: selectedConcert.url ||
              buildGoogleTicketsSearchUrl({
                performer: String(selectedConcert.artist).trim(),
                city: String(selectedConcert.city || effectiveCity).trim(),
                venue: selectedConcert.venue ? String(selectedConcert.venue).trim() : undefined,
                dateYmd: selDate || undefined,
              }),
            provider: "user_selected",
          }];
        }
        console.log("[CONCERT_LOCK] selected_concert locked to single event", { artist: selectedConcert.artist, date: selDate, tmMatch: !!tmMatch });
      }

      // Stage 2 dedup: if TM returned multiple dates for the same artist in the same city
      // (happens when artist has multiple upcoming shows), keep only the earliest per artist+city
      // so the LLM can't assign different dates to Bronze/Silver/Gold tiers.
      if (events.length > 1) {
        const artistCityMap = new Map<string, any>();
        for (const e of events) {
          const rawName = String(e.name || "").toLowerCase();
          // Strip "at Venue" / "- City" suffixes to get the artist portion
          const artist = rawName.split(/\s+(?:at|@|-)\s+/)[0].trim() || rawName;
          const city = String(e.venue?.city || "").toLowerCase().trim();
          const key = `${artist}|${city}`;
          const eDate = String(e.date_time || "").slice(0, 10);
          if (!artistCityMap.has(key)) {
            artistCityMap.set(key, e);
          } else {
            const existingDate = String(artistCityMap.get(key).date_time || "").slice(0, 10);
            if (eDate && existingDate && eDate < existingDate) {
              artistCityMap.set(key, e);
            }
          }
        }
        if (artistCityMap.size < events.length) {
          console.log(`[CONCERT_DEDUP] Reduced ${events.length} events → ${artistCityMap.size} by artist+city`);
          events = Array.from(artistCityMap.values());
        }
      }

      events = events.filter((e: any) => {
        const ed = extractIsoDateYmd(e?.date_time);
        if (!ed) return true;
        if (e.provider === "user_selected") return true;
        return ed >= minTripYmd;
      });

      console.log("[TM_LINK_DEBUG] generate-itinerary input events", events.map((e: any) => ({ name: e.name, book_url: e.book_url, source_url: e.source_url })));
      let golfCourses = Array.isArray(rawSearchResults.golf_courses)
        ? rawSearchResults.golf_courses.slice(0, 12)
        : [];
      let bronzeGolfCandidates = Array.isArray(rawSearchResults.bronze_golf_candidates) ? rawSearchResults.bronze_golf_candidates : null;
      let silverGolfCandidates = Array.isArray(rawSearchResults.silver_golf_candidates) ? rawSearchResults.silver_golf_candidates : null;
      let goldGolfCandidates = Array.isArray(rawSearchResults.gold_golf_candidates) ? rawSearchResults.gold_golf_candidates : null;
      let hotels = Array.isArray(rawSearchResults.hotels) ? rawSearchResults.hotels.slice(0, 6) : [];
      // Catalog venues from the internal catalog (arenas/amphitheaters in this metro).
      // Passed to the LLM as context so it knows which real venues exist in this city.
      const catalogVenuesForPrompt: Array<{ name: string; city: string; type?: string; url?: string }> =
        Array.isArray(rawSearchResults.catalog_venues)
          ? (rawSearchResults.catalog_venues as any[]).slice(0, 8).map((v: any) => ({
              name: v.name,
              city: v.city,
              ...(v.venue_type && { type: v.venue_type }),
              ...(v.ticketmaster_url || v.website_url
                ? { url: v.ticketmaster_url ?? v.website_url }
                : {}),
            }))
          : [];
      const catalogMeta = rawSearchResults.catalog_meta ?? null;
      if (catalogMeta) {
        console.log(
          `[CATALOG] generate-itinerary received: metro=${catalogMeta.metro_slug} golf_source=${catalogMeta.golf_source} venues=${catalogMeta.venues_from_catalog}`
        );
      }

      // When user selected a concert (e.g. from discovery), resolve date/venue against Ticketmaster — never trust LLM dates alone.
      if (selectedConcert?.artist && selectedConcert?.city) {
        const hint = parseFlexibleDateToYmd(String(selectedConcert.date || ""));
        const resolved = await resolveConcertFromTicketmaster({
          artist: String(selectedConcert.artist).trim(),
          city: String(selectedConcert.city).trim(),
          startDate: String(p.start_date).slice(0, 10),
          endDate: String(p.end_date).slice(0, 10),
          dateHintYmd: hint,
        });
        if (resolved) {
          const resolvedYmd = resolved.date_time.slice(0, 10);
          // If the user/package gave a specific day, do not substitute a different TM show/date.
          if (!hint || resolvedYmd === hint) {
            events = [{ ...resolved, provider: "user_selected" }];
          } else {
            console.log(
              `[CONCERT] TM resolved ${resolvedYmd} but selection hint is ${hint} — keeping locked event (package/picker date)`
            );
          }
        } else {
          // TM couldn't confirm. Try Perplexity secondary verification (Rule 2).
          // Use a ±14-day window around the hint so minor date shifts don't cause misses.
          const hintDate = hint || String(p.start_date).slice(0, 10);
          const minAllowedYmd = minTripYmd;
          const broadStartRaw = (() => {
            const d = new Date(hintDate + "T12:00:00Z");
            d.setDate(d.getDate() - 14);
            return d.toISOString().slice(0, 10);
          })();
          const broadStart = broadStartRaw >= minAllowedYmd ? broadStartRaw : minAllowedYmd;
          const broadEnd = (() => {
            const d = new Date(hintDate + "T12:00:00Z");
            d.setDate(d.getDate() + 14);
            return d.toISOString().slice(0, 10);
          })();

          const perplexityVerified = await resolveOrVerifyConcert(
            PERPLEXITY_API_KEY,
            String(selectedConcert.artist).trim(),
            String(selectedConcert.city).trim(),
            broadStart,
            broadEnd,
            hint
          );

          if (perplexityVerified) {
            const pyYmd = parseFlexibleDateToYmd(String(perplexityVerified.date || ""));
            if (hint && pyYmd && pyYmd !== hint) {
              console.log(`[CONCERT] Perplexity date ${pyYmd} !== selection ${hint} — using hint + Google link`);
              const fallbackDate = hint;
              const concertUrl = buildGoogleTicketsSearchUrl({
                performer: String(selectedConcert.artist).trim(),
                city: String(selectedConcert.city || effectiveCity).trim(),
                venue: selectedConcert.venue ? String(selectedConcert.venue).trim() : undefined,
                dateYmd: fallbackDate,
              });
              events = [{
                id: "selected_concert",
                name: String(selectedConcert.artist).trim(),
                date_time: `${fallbackDate}T20:00:00`,
                venue: { name: String(selectedConcert.venue || "Venue TBD"), city: String(selectedConcert.city).trim() },
                book_url: concertUrl,
                source_url: concertUrl,
                book_link: {
                  url: concertUrl,
                  provider: "Google",
                  category: "concert" as const,
                  link_type: "provider_search" as const,
                  label: "Find tickets",
                  is_verified: false,
                  confidence: "low" as const,
                  disclaimer: "Opens Google results for this show and date (multiple ticket options may appear)",
                },
                provider: "user_selected",
              }];
            } else {
              // Rule 2: Perplexity confirmed — use verified date + Google ticket search URL
              events = [{
                id: "selected_concert",
                name: perplexityVerified.venue !== "Venue TBD"
                  ? `${perplexityVerified.artist} at ${perplexityVerified.venue}`
                  : perplexityVerified.artist,
                date_time: `${perplexityVerified.date}T20:00:00`,
                venue: { name: perplexityVerified.venue, city: perplexityVerified.city },
                book_url: perplexityVerified.url,
                source_url: perplexityVerified.url,
                book_link: {
                  url: perplexityVerified.url,
                  provider: "Google",
                  category: "concert" as const,
                  link_type: "provider_search" as const,
                  label: "Find tickets",
                  is_verified: false,
                  confidence: "medium" as const,
                  disclaimer: "Date confirmed via web search — link opens Google ticket results",
                },
                provider: "user_selected",
              }];
            }
          } else {
            // Neither TM nor Perplexity confirmed a specific date.
            // The user explicitly selected this concert, so always build the itinerary
            // around it using the best available date (picker hint) and a TM search link.
            const fallbackDate = hint || String(p.start_date).slice(0, 10);
            const concertUrl = buildGoogleTicketsSearchUrl({
              performer: String(selectedConcert.artist).trim(),
              city: String(selectedConcert.city || effectiveCity).trim(),
              venue: selectedConcert.venue ? String(selectedConcert.venue).trim() : undefined,
              dateYmd: fallbackDate,
            });
            console.log(`[CONCERT] TM + Perplexity unconfirmed for ${selectedConcert.artist} — using hint date ${fallbackDate} with Google ticket search link`);
            events = [{
              id: "selected_concert",
              name: String(selectedConcert.artist).trim(),
              date_time: `${fallbackDate}T20:00:00`,
              venue: { name: String(selectedConcert.venue || "Venue TBD"), city: String(selectedConcert.city).trim() },
              book_url: concertUrl,
              source_url: concertUrl,
              book_link: {
                url: concertUrl,
                provider: "Google",
                category: "concert" as const,
                link_type: "provider_search" as const,
                label: "Find tickets",
                is_verified: false,
                confidence: "low" as const,
                disclaimer: "Opens Google results for this show and date (multiple ticket options may appear)",
              },
              provider: "user_selected",
            }];
          }
        }
      }

      // Fallback mock when frontend doesn't pass search_results
      const fallbackCity = (effectiveCity || selectedConcert?.city || (p.city !== "flexible" ? p.city : null) || "Austin").slice(0, 50);
      const fallbackGolfLink = { url: "https://www.golfnow.com/", provider: "GolfNow", category: "golf" as const, link_type: "provider_search" as const, label: "Search tee times", is_verified: false, confidence: "medium" as const, disclaimer: "Opens external golf search results; tee time availability is not confirmed in Experience Caddie" };
      if (!golfCourses.length && !hotels.length) {
        golfCourses = [
          { id: "fallback_golf_1", name: "Sample Golf Course", city: fallbackCity, state: "TX", public_access: true, rating: 4.4, tee_time_window: { start: "07:00", end: "11:00" }, book_url: "https://www.golfnow.com/", source_url: "https://www.golfnow.com/", book_link: fallbackGolfLink, price_min: 80, price_max: 180, provider: "mock" },
        ];
        hotels = [
          { id: "fallback_hotel_1", name: "Sample Hotel", city: fallbackCity, state: "TX", stars: 4, rating: 4.6, book_url: "https://www.google.com/maps/search/?api=1&query=hotels", source_url: "https://www.google.com/maps/search/?api=1&query=hotels", price_min: 160, price_max: 320, provider: "mock" },
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
            venue: { name: "Local Venue", city, state, capacity: 12000 },
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
            name: "Sample Golf Course",
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
            name: "Sample Hotel",
            city,
            state,
            stars: 4,
            rating: 4.6,
            book_url: "https://www.google.com/maps/search/?api=1&query=hotels",
            source_url: "https://www.google.com/maps/search/?api=1&query=hotels",
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
    // In refresh mode, preserve existing share_slug so the link stays stable
    const shareSlug = isRefreshMode
      ? (itinerary.share_slug || `${itinerary.city?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip"}-${Date.now().toString(36)}`)
      : `${itinerary.city.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;

    // Mark as generating and set share_slug (skip for refresh — frontend handles loading; no DB write until success)
    if (!isRefreshMode) {
      await supabase.from("itineraries").update({ status: "generating", share_slug: shareSlug }).eq("id", itinerary_id);
    }

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
          { id: "fallback_evt_1", name: "Sample Concert", date_time: `${itinerary.start_date}T20:00:00-05:00`, venue: { name: "Local Venue", city, state: "TX", capacity: 12000 }, book_url: "https://www.google.com/search?q=concerts+tickets", source_url: "https://www.google.com/search?q=concerts+tickets", price_min: 75, price_max: 250, provider: "mock" },
        ],
        golf_courses: [
          { id: "fallback_golf_1", name: "Sample Golf Course", city, state: "TX", public_access: true, rating: 4.4, tee_time_window: { start: "07:00", end: "11:00" }, book_url: "https://www.golfnow.com/", source_url: "https://www.golfnow.com/", book_link: fallbackGolfLink, price_min: 80, price_max: 180, provider: "mock" },
        ],
        hotels: [
          { id: "fallback_hotel_1", name: "Sample Hotel", city, state: "TX", stars: 4, rating: 4.6, book_url: "https://www.google.com/maps/search/?api=1&query=hotels", source_url: "https://www.google.com/maps/search/?api=1&query=hotels", price_min: 160, price_max: 320, provider: "mock" },
        ],
      };
    }

    const genClientTz = normalizeClientTimeZone(body?.payload?.client_timezone ?? body?.client_timezone);
    const genMinConcertYmd = minTripStartYmdForTimezone(genClientTz);
    const tripStartYmd = String(itinerary.start_date ?? "").slice(0, 10);
    const tripEndYmd = String(itinerary.end_date ?? "").slice(0, 10);
    const tripStartOk = /^\d{4}-\d{2}-\d{2}$/.test(tripStartYmd);
    const tripEndOk = /^\d{4}-\d{2}-\d{2}$/.test(tripEndYmd);
    const filterSearchEventsForTrip = (evts: unknown[] | undefined) =>
      (evts ?? []).filter((e: any) => {
        if (e?.provider === "user_selected") return true;
        const ymd = extractIsoDateYmd(e?.date_time);
        if (!ymd) return true;
        if (ymd < genMinConcertYmd) return false;
        if (tripStartOk && ymd < tripStartYmd) return false;
        if (tripEndOk && ymd > tripEndYmd) return false;
        return true;
      });
    searchResults = {
      ...searchResults,
      events: filterSearchEventsForTrip(searchResults.events as unknown[]),
    };
    itinerary.search_results = searchResults;

    const events = searchResults.events || [];
    const golfCourses = (searchResults.golf_courses || []).slice(0, 12);
    const hotels = searchResults.hotels || [];
    const poolBronze = Array.isArray(searchResults.bronze_golf_candidates) ? searchResults.bronze_golf_candidates : null;
    const poolSilver = Array.isArray(searchResults.silver_golf_candidates) ? searchResults.silver_golf_candidates : null;
    const poolGold = Array.isArray(searchResults.gold_golf_candidates) ? searchResults.gold_golf_candidates : null;
    const catalogVenuesForPrompt: Array<{ name: string; city: string; type?: string; url?: string }> =
      Array.isArray(searchResults.catalog_venues)
        ? (searchResults.catalog_venues as any[]).slice(0, 8).map((v: any) => ({
            name: v.name,
            city: v.city,
            ...(v.venue_type && { type: v.venue_type }),
            ...(v.ticketmaster_url || v.website_url
              ? { url: v.ticketmaster_url ?? v.website_url }
              : {}),
          }))
        : [];
    const toGolfEntry = (g: any) => ({
      name: g.name,
      url: g.book_url || g.source_url,
      ...(g.price_min != null && { price_min: g.price_min }),
      ...(g.price_max != null && { price_max: g.price_max }),
      ...(g.rating != null && { rating: g.rating }),
      ...(g.drive_time_minutes != null && { drive_mins: g.drive_time_minutes }),
      ...(g.distance_miles != null && { miles: g.distance_miles }),
    });
    const golfBronzeRaw  = poolBronze?.length ? poolBronze.map(toGolfEntry) : golfCourses.filter((g: any) => g.tier_hint === "bronze").map(toGolfEntry);
    const golfSilverRaw  = poolSilver?.length ? poolSilver.map(toGolfEntry) : golfCourses.filter((g: any) => g.tier_hint === "silver").map(toGolfEntry);
    const golfGoldRaw    = poolGold?.length   ? poolGold.map(toGolfEntry)   : golfCourses.filter((g: any) => g.tier_hint === "gold").map(toGolfEntry);
    const golfUnassigned = golfCourses.filter((g: any) => !g.tier_hint || !["bronze", "silver", "gold"].includes(g.tier_hint)).map(toGolfEntry);

    // Enforce mutual exclusivity: each course belongs to exactly one tier (gold > silver > bronze).
    // This prevents the same course appearing in multiple packages.
    const normGolfName = (g: any) => ((g.name ?? "") as string).toLowerCase().trim();
    const claimedForTier = new Set<string>();
    const claimNew = (g: any) => { const k = normGolfName(g); if (!k || claimedForTier.has(k)) return false; claimedForTier.add(k); return true; };
    const golfGoldExcl   = golfGoldRaw.filter(claimNew);
    const golfSilverExcl = golfSilverRaw.filter(claimNew);
    const golfBronzeExcl = golfBronzeRaw.filter(claimNew);

    // Silver fallback: if no silver-tier courses, promote unassigned courses not already claimed.
    // If unassigned is also empty, carve the top half of bronze out as silver so there is always
    // a middle tier with different courses from bronze.
    const golfUnassignedUnclaimed = golfUnassigned.filter((g: any) => { const k = normGolfName(g); return k && !claimedForTier.has(k); });

    let golfBronze: ReturnType<typeof toGolfEntry>[];
    let golfSilver: ReturnType<typeof toGolfEntry>[];
    let golfGold: ReturnType<typeof toGolfEntry>[];

    if (golfGoldExcl.length > 0 && golfSilverExcl.length > 0) {
      // Best case: real gold and silver pools exist.
      golfGold   = golfGoldExcl;
      golfSilver = golfSilverExcl;
      golfBronze = golfBronzeExcl;
    } else if (golfGoldExcl.length > 0) {
      // Gold exists, silver is empty — fill silver from unassigned or carved bronze.
      golfGold = golfGoldExcl;
      if (golfUnassignedUnclaimed.length > 0) {
        golfSilver = golfUnassignedUnclaimed.slice(0, 5);
        golfBronze = golfBronzeExcl;
      } else {
        const carveCount = Math.max(1, Math.ceil(golfBronzeExcl.length / 2));
        golfSilver = golfBronzeExcl.slice(0, carveCount);
        golfBronze = golfBronzeExcl.slice(carveCount);
      }
    } else if (golfSilverExcl.length > 0) {
      // Silver exists, gold is empty — promote silver to gold, fill silver from unassigned or carved bronze.
      golfGold = golfSilverExcl;
      if (golfUnassignedUnclaimed.length > 0) {
        golfSilver = golfUnassignedUnclaimed.slice(0, 5);
        golfBronze = golfBronzeExcl;
      } else {
        const carveCount = Math.max(1, Math.ceil(golfBronzeExcl.length / 2));
        golfSilver = golfBronzeExcl.slice(0, carveCount);
        golfBronze = golfBronzeExcl.slice(carveCount);
      }
    } else {
      // Neither gold nor silver have dedicated courses — divide available courses into thirds.
      const all = [...golfUnassignedUnclaimed, ...golfBronzeExcl];
      const n = all.length;
      const third = Math.max(1, Math.floor(n / 3));
      golfBronze = all.slice(0, third);
      golfSilver = all.slice(third, third * 2);
      golfGold   = all.slice(third * 2);
      // Ensure each tier has at least one entry.
      if (golfBronze.length === 0) golfBronze = all.slice(0, 1);
      if (golfSilver.length === 0) golfSilver = all.slice(0, 1);
      if (golfGold.length === 0)   golfGold   = all.slice(-1);
    }
    const goldPoolIsThin = golfGoldExcl.length === 0 && golfGold.length > 0;
    const hasRealHotels = hotels.length > 0 && hotels.some((h: any) => h.provider !== "mock");
    // Separate verified events (direct TM event page) from search-URL events.
    // Both are valid — direct URLs link to a confirmed event, search URLs land on a TM
    // search for the artist+city which the user can browse. Concerts must always appear.
    const verifiedEvents = (events || []).filter(
      (e: any) => e?.book_link?.link_type === "direct_event"
    );
    const allNonMockEvents = (events || []).filter(
      (e: any) => e && e.provider && e.provider !== "mock"
    );
    const hasRealData = allNonMockEvents.length > 0 || golfCourses.length > 0 || hotels.length > 0;
    const hasTieredGolf = golfBronze.length > 0 || golfSilver.length > 0 || golfGold.length > 0;
    const realDataSection = hasRealData
      ? `
REAL DATA PROVIDED (use these exact options in your packages; include their book_url/ticket URLs and prices when available):
${allNonMockEvents.length ? `- CONCERTS: ${JSON.stringify(allNonMockEvents.slice(0, 6).map((e: any) => ({ name: e.name, venue: e.venue?.name, date: e.date_time, url: e.book_url || e.source_url, price_min: e.price_min, price_max: e.price_max, confirmed: e.book_link?.link_type === "direct_event" })))}` : ""}
${golfCourses.length && !hasTieredGolf ? `- GOLF (all): ${JSON.stringify(golfCourses.slice(0, 6).map((g: any) => ({ name: g.name, url: g.book_url || g.source_url })))}` : ""}
${hasTieredGolf ? `- GOLF by tier (CRITICAL – use ONLY from the matching list per package):
  TIER QUALITY GUIDE — use this to set green_fee and explain the "why" per course:
  * BRONZE: Affordable public/municipal courses, green fees ~$40–$90. Good for value-conscious golfers.
  * SILVER: Well-rated public courses with solid conditions and amenities, green fees ~$80–$150. Great choice for avid golfers.
  * GOLD: ${goldPoolIsThin ? `Best available courses in this destination (premium resort courses are limited here). Use the courses from the GOLD list — they represent the top-rated, most recommended options in the area.` : `Premium, resort, or destination-quality public courses, green fees ~$130–$200+. Exceptional conditions, scenic settings, or signature design.`}
  When price_min/price_max are provided for a course, use those exact values in the green_fee field.
  * BRONZE package golf: ${JSON.stringify(golfBronze.length ? golfBronze : golfUnassigned)}
  * SILVER package golf: ${JSON.stringify(golfSilver.length ? golfSilver : golfUnassigned)}
  * GOLD package golf: ${JSON.stringify(golfGold.length ? golfGold : golfUnassigned)}
  ${golfUnassigned.length ? `(If a tier list is empty, use from: ${JSON.stringify(golfUnassigned)})` : ""}` : ""}
${hasRealHotels ? `- HOTELS: ${JSON.stringify(hotels.slice(0, 6).map((h: any) => ({ name: h.name, url: h.book_url || h.source_url, price_min: h.price_min, price_max: h.price_max })))}` : ""}
${!hasRealHotels && hotels.length > 0 ? `- HOTELS: (none provided – SEARCH the web for real hotels in ${itinerary.city} on Expedia, Booking.com, or Hotels.com. Use actual property names as listed on those sites (e.g. "Hotel Van Zandt", "W Austin") and real booking URLs. Do not use vague names like "convenient option" or "boutique hotel near venue".)` : ""}
${catalogVenuesForPrompt.length > 0 ? `- KNOWN CONCERT VENUES IN THIS METRO (real, confirmed venues — reference these when suggesting events or when Ticketmaster data is limited): ${JSON.stringify(catalogVenuesForPrompt)}` : ""}

Use the URLs above when composing packages. Do not invent different events or links.
PRICE RULE: When concerts or hotels include price_min/price_max, use them. For events: set price_range as a string like "$75–$250" or "From $50" using the provided numbers. For lodging: set price_per_night using the range (e.g. "$160–$320/night"). If no price data is provided, estimate based on the Bronze/Silver/Gold tier of the package (Bronze = value, Silver = mid, Gold = premium).${!hasRealHotels ? " For hotels, search the web as instructed." : ""}
${events.length > 0 ? `
CONCERT RULE (MANDATORY): For each package, use ONLY concerts from the CONCERTS list above. Do not add or substitute any event not in that list—these are verified events with active ticket listings. If only one concert is provided, ALL three tiers (Bronze, Silver, Gold) must use that exact same concert — same artist, same venue, same date, same URL. Only spread different events across tiers if multiple distinct concerts are listed.` : `
NO CONCERTS RULE (MANDATORY): No concerts have been provided or confirmed for this trip. Do NOT include any events, concerts, or performances in the packages—not from your own web search, not from training data, not from any source. The "events" array in every package MUST be an empty array []. Build packages around golf and hotels only.`}
${hasTieredGolf ? `
GOLF TIER RULE (MANDATORY): For each package, pick golf courses ONLY from that package's tier list above. BRONZE package → use only from BRONZE golf list. SILVER → only from SILVER golf list. GOLD → only from GOLD golf list. Do NOT add golf courses from your own web search—use ONLY the courses listed. Exclude country clubs, private clubs, and members-only courses. EACH PACKAGE MUST USE DIFFERENT GOLF COURSES — never repeat the same course across Bronze, Silver, and Gold. Each tier must have at least one golf option. All golf, lodging, and the venue are within 30 miles of each other. When golf entries include drive_mins or miles, you may mention them in the "why" for context.${goldPoolIsThin ? `
GOLD HONESTY NOTE: Premium (Gold-tier) golf options are limited for this destination. For the GOLD package, add to safety_notes: "Premium course availability is limited in this area; we've included the best available public courses."` : ""}` : ""}`
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

WEEKEND GETAWAY RULES (mandatory):
- Concerts and golf must fit a Thursday, Friday, Saturday, or Sunday getaway.
- Do NOT schedule a round of golf, tee time, golf warmup, golf lesson, or golf course visit on Monday, Tuesday, or Wednesday.
- The itinerary "day" value for any golf plan item must be Thursday, Friday, Saturday, or Sunday.
- If the trip window includes Monday-Wednesday, use those days only for arrival, travel, rest, dining, checkout, or non-golf extras.

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
        if (!isRefreshMode) await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 401 || response.status === 402) {
        if (!isRefreshMode) await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
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
      if (!isRefreshMode) await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content;

    if (!content) {
      if (!isRefreshMode) await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
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
        if (!isRefreshMode) await supabase.from("itineraries").update({ status: "error" }).eq("id", itinerary_id);
        return new Response(JSON.stringify({ error: "AI returned invalid format. Please try again." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Rule 3 enforcement: if no events were verified (neither TM nor Perplexity secondary),
    // clear any concerts the LLM may have added from its own web search. A concert with an
    // unconfirmed date must never appear — drop it rather than show wrong information.
    const nonMockEvents = allNonMockEvents;
    if (nonMockEvents.length === 0 && Array.isArray(parsedResult.packages)) {
      for (const pkg of parsedResult.packages) {
        if (Array.isArray(pkg.events) && pkg.events.length > 0) {
          console.log(`[CONCERT] Rule 3: cleared ${pkg.events.length} LLM-generated event(s) from ${pkg.tier} package — no verified concerts`);
          pkg.events = [];
        }
      }
    }

    // Overwrite LLM concert rows with canonical verified events from search_results (Rule 1 / Rule 2).
    if (nonMockEvents.length > 0 && Array.isArray(parsedResult.packages)) {
      const formatSearchEventForPackage = (e: any) => {
        const v = e.venue || {};
        const venueLine = [v.name, v.city].filter(Boolean).join(", ");
        let dateTimeStr = String(e.date_time || "");
        if (dateTimeStr.includes("T")) {
          try {
            const d = new Date(dateTimeStr);
            if (!isNaN(d.getTime())) {
              dateTimeStr = d.toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });
            }
          } catch {
            /* keep raw */
          }
        }
        const pr =
          e.price_min != null && e.price_max != null
            ? `$${e.price_min}–$${e.price_max}`
            : e.price_min != null
              ? `From $${e.price_min}`
              : "";
        return {
          name: e.name,
          venue: venueLine || "Venue TBD",
          date_time: dateTimeStr,
          url: e.book_url || e.source_url || "",
          price_range: pr,
        };
      };
      const rows = nonMockEvents.slice(0, 3).map(formatSearchEventForPackage);
      for (const pkg of parsedResult.packages) {
        pkg.events = rows.map((r) => ({ ...r }));
      }
      console.log(`[CONCERT] clamped package.events to search_results (n=${nonMockEvents.length})`);
    }

    const floorConcertYmd = tripStartOk && tripStartYmd >= genMinConcertYmd ? tripStartYmd : genMinConcertYmd;
    for (const pkg of parsedResult.packages || []) {
      if (!Array.isArray(pkg.events)) continue;
      pkg.events = pkg.events.filter((ev: any) => {
        const ymd = extractIsoDateYmd(ev?.date_time);
        if (!ymd) return true;
        if (ymd < genMinConcertYmd || ymd < floorConcertYmd) return false;
        if (tripEndOk && ymd > tripEndYmd) return false;
        return true;
      });
    }

    // Enrich packages with trust metadata from search_results (match by name)
    const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const MIN_SUBSTRING_LEN = 15; // avoid "Golf" or "Muni" matching wrong courses

    // Post-filter: remove golf courses from LLM output that match explicit private-membership patterns
    // (LLM sometimes adds these from its own web search). "Golf Club" alone is NOT private —
    // most bookable semi-private courses use this naming convention.
    const isLikelyPrivateGolf = (name: string): boolean => {
      const n = (name || "").toLowerCase();
      if (/municipal|muny|public\b|city\b|park\b|recreation|community\b/i.test(n)) return false;
      if (/private club|private\b golf|members[- ]only|members'? club|invitation[- ]only|invite[- ]only|proprietary|exclusive\b.*club/i.test(n)) return true;
      if (/military|naval|navy|marine corps|air force|army|coast guard|\bbase\b|\bmwr\b|\bdod\b|camp pendleton|miramar|sea 'n air|sea n air/i.test(n)) return true;
      if (/(country club|golf & country|golf and country)\b/i.test(n) && !/resort|lodge|inn|hotel|spa/i.test(n)) return true;
      return false;
    };
    for (const pkg of parsedResult.packages || []) {
      if (Array.isArray(pkg.golf)) {
        pkg.golf = pkg.golf.filter((g: any) => !isLikelyPrivateGolf(g?.name || ""));
      }
    }

    // Keep direct Ticketmaster/Live Nation event pages (ticketmaster.com/event/...).
    // Replace TM search URLs — they surface unrelated upcoming events, not the specific
    // event in the itinerary, which is confusing when the user's dates don't match.
    // Replace third-party resellers we don't control.
    const shouldReplaceConcertUrl = (url: string): boolean => {
      if (!url || typeof url !== "string") return true;
      const u = url.trim().toLowerCase();
      if (!u.startsWith("http")) return true;
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.replace(/^www\./, "");
        // Keep direct Ticketmaster EVENT pages (e.g. ticketmaster.com/event/...).
        // Replace TM search pages — they show unrelated events, not the itinerary date.
        if (host === "ticketmaster.com" || host.endsWith(".ticketmaster.com")) {
          return parsed.pathname.startsWith("/search");
        }
        // Keep Live Nation direct event pages; replace their search pages too.
        if (host === "livenation.com" || host.endsWith(".livenation.com")) {
          return parsed.pathname.startsWith("/search");
        }
        // Replace third-party resellers (we don't control their URLs or availability).
        const isReseller = ["seatgeek.com", "stubhub.com", "vividseats.com", "axs.com"].some(
          (d) => host === d || host.endsWith("." + d)
        );
        return isReseller;
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
    // Fallback ticket search uses Google — surfaces SeatGeek, StubHub, AXS, venue box
    // offices, and any other seller, not just Ticketmaster. Including the date makes the
    // search specific enough to return results for the right event.
    const buildConcertSearchUrl = (eventName: string, city: string, dateStr?: string): string => {
      const artist = extractArtistForSearch(eventName || "");
      const cityPart = (city || "").trim();
      const validCity = cityPart && cityPart.toLowerCase() !== "flexible" && cityPart.toLowerCase() !== "various";
      // Format date as "June 2026" or "Jun 14 2026" if we have it — enough to narrow results.
      let datePart = "";
      if (dateStr) {
        try {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            datePart = d.toLocaleString("en-US", { month: "long", year: "numeric" });
          }
        } catch { /* skip */ }
      }
      const parts = [artist, validCity ? cityPart : "", datePart, "tickets"].filter(Boolean);
      const q = parts.join(" ");
      const url = `https://www.google.com/search?q=${encodeURIComponent(q.trim())}`;
      console.log("[CONCERT_LINK_DEBUG] buildConcertSearchUrl", { eventName, artist, city, datePart, q, url });
      return url;
    };

    // Replace OTA / affiliate hotel URLs with Google Hotels search (direct brand sites stay).
    // Keep in sync with apps/web/src/lib/outboundLinks.ts shouldReplaceOtaHotelUrl.
    const shouldReplaceHotelUrl = (url: string): boolean => {
      if (!url || typeof url !== "string") return true;
      const raw = url.trim();
      const u = raw.toLowerCase();
      if (!u.startsWith("http")) return true;
      const otaInFullString =
        /(^|\/\/|\.)(expedia\.(com|net|[a-z]{2,3})|booking\.com|hotels\.com|hotel\.com|agoda\.com|priceline\.com|orbitz\.com|travelocity\.com|trip\.com|vrbo\.com|trivago\.com|momondo\.com|kayak\.com|hometogo\.com)\b/i.test(
          u
        ) ||
        /\b(awin1\.com|linksynergy\.com|shareasale\.com|anrdoezrs\.net|ojrq\.net|dpbolvw\.net|kqzyfj\.com|jdoqocy\.com|goto\.target)\b/i.test(
          u
        );
      if (
        otaInFullString &&
        !u.includes("google.com/travel/hotels") &&
        !u.includes("google.com/maps") &&
        !u.includes("maps.google")
      ) {
        return true;
      }
      try {
        const parsed = new URL(raw);
        const host = parsed.hostname.replace(/^www\./, "");
        const brand = [
          "marriott.com",
          "hilton.com",
          "hyatt.com",
          "ihg.com",
          "choicehotels.com",
          "wyndhamhotels.com",
          "bestwestern.com",
        ];
        if (brand.some((d) => host === d || host.endsWith("." + d))) return false;
        const ota = [
          "booking.com",
          "expedia.com",
          "hotels.com",
          "hotel.com",
          "agoda.com",
          "priceline.com",
          "orbitz.com",
          "travelocity.com",
          "trip.com",
          "vrbo.com",
          "trivago.com",
        ];
        if (ota.some((d) => host === d || host.endsWith("." + d))) return true;
        if (host === "awin1.com" || host.endsWith(".awin1.com")) return true;
        if (host.includes("expedia.")) return true;
        if (host.includes("linksynergy.com") || host.includes("shareasale.com")) return true;
        return false;
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

    // Google Maps hotel search — match web client outboundLinks.buildGoogleMapsHotelSearchUrl (dates in query when available).
    const buildHotelSearchUrl = (name: string, city: string, state?: string, startDate?: string, endDate?: string): string => {
      const cleanCity = (city || "").trim().toLowerCase();
      const validCity = cleanCity && cleanCity !== "flexible" && cleanCity !== "various";
      const statePart = (state || "").trim() ? ` ${(state || "").trim()}` : "";

      const { searchName, isLowConfidence } = normalizeHotelNameForSearch(name || "");
      let destPart: string;
      if (isLowConfidence || !searchName) {
        destPart = validCity ? `hotels in ${cleanCity}${statePart}`.trim() : "";
      } else {
        const nameLower = searchName.toLowerCase().trim();
        const alreadyHasCity = validCity && nameLower.includes(cleanCity);
        const locPart = validCity ? (alreadyHasCity ? "" : ` ${cleanCity}${statePart}`.trim()) : "";
        destPart = `${searchName.trim()}${locPart}`.trim();
      }
      const base = destPart ? `${destPart} hotels` : "hotels";
      const sd = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : "";
      const ed = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : "";
      let q: string;
      if (sd && ed && ed !== sd) {
        q = destPart ? `${destPart} ${sd} to ${ed} hotels`.trim() : `${sd} to ${ed} hotels`;
      } else if (sd) {
        q = destPart ? `${destPart} ${sd} hotels`.trim() : `${sd} hotels`;
      } else {
        q = base.slice(0, 150);
      }
      q = q.slice(0, 200);
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
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
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
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
          // Only inject the source URL if it's a confirmed direct event page.
          // TM search URLs fall through to the Google fallback below so the user
          // gets results from all sellers (SeatGeek, StubHub, AXS, venue, etc.).
          if (!shouldReplaceConcertUrl(src.book_url || src.source_url || "")) {
            const trustedUrl = src.book_url || src.source_url;
            if (trustedUrl) e.url = trustedUrl;
            if (src.book_link) e.link = src.book_link;
          }
        }
        // No confirmed direct event URL — fall back to a Google search that includes the
        // artist, city, and month so the user sees all sellers for that specific event.
        if (shouldReplaceConcertUrl(e.url || "")) {
          const city = (e.venue_obj?.city ?? (typeof e.venue === "string" ? e.venue : (e.venue as any)?.city) ?? pkgCity) || pkgCity;
          const dateIso = src?.date_time || e.date_time || "";
          e.url = buildConcertSearchUrl(e.name || "", city, dateIso);
          e.link = {
            url: e.url,
            provider: "Google",
            category: "concert",
            link_type: "provider_search",
            label: "Find tickets",
            is_verified: false,
            confidence: "medium",
            disclaimer: "Search results include Ticketmaster, SeatGeek, StubHub, and other sellers — confirm availability for your dates",
          };
        }
        console.log("[TM_LINK_DEBUG] generate-itinerary enrich event", { name: e.name, url_before: urlBefore, url_after: e.url, matched: !!src, link_type: e.link?.link_type ?? "none" });
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
          h.url = buildHotelSearchUrl(
            h.name || "Hotel",
            city,
            state,
            hotelDateRange?.checkin,
            hotelDateRange?.checkout
          );
        }
        h.url = sanitizeLodgingUrl(h.url || "", city, state);
        // Structured outbound link (Phase 3 hotel trust model)
        const finalUrl = h.url || "";
        if (replaced) {
          h.link = {
            url: finalUrl,
            provider: finalUrl.includes("awin1.com") ? "Booking.com" : (finalUrl.includes("google.com/maps") || finalUrl.includes("maps.google") ? "Google Maps" : finalUrl.includes("google.com/travel/hotels") ? "Google Hotels" : (finalUrl.includes("booking.com") ? "Booking.com" : "External")),
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

    // Save result (share_slug already set during "generating" phase; refresh mode never touches share_slug)
    const { error: updateErr } = await supabase
      .from("itineraries")
      .update({
        result_json: parsedResult,
        status: "generated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", itinerary_id);

    if (updateErr) {
      console.error("Failed to save itinerary:", updateErr);
      return new Response(JSON.stringify({ error: "Failed to save itinerary" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Non-blocking funnel event — only uses outer-scoped variables (itinerary, itinerary_id, isRefreshMode)
    // so it is safe regardless of which code path (new / refresh / legacy) reached this point.
    const catalogVenuesSrc = Array.isArray((itinerary?.search_results as any)?.catalog_venues);
    const auditSearchResults = itinerary?.search_results as any;
    supabase.from("analytics_events").insert({
      event_type: "itinerary_generated",
      metro_slug: (itinerary?.city ?? "").toLowerCase().replace(/[\s,]+/g, "-").slice(0, 100) || null,
      artist_name: (itinerary?.event_details ?? "").slice(0, 200) || null,
      extra: {
        itinerary_id,
        budget_tier: itinerary?.budget_tier ?? null,
        group_size: itinerary?.group_size ?? null,
        golf_source: catalogVenuesSrc ? "catalog" : "live_api",
        is_refresh: isRefreshMode,
        // Provenance audit fields — captures context at generation time that
        // cannot be fully reconstructed from the itinerary row alone.
        destination: itinerary?.city ?? null,
        start_date: (itinerary as any)?.start_date ?? null,
        end_date: (itinerary as any)?.end_date ?? null,
        providers_called: auditSearchResults?.meta?.providers ?? [],
        results_returned: {
          events: (auditSearchResults?.events ?? []).length,
          golf: (auditSearchResults?.golf_courses ?? []).length,
          hotels: (auditSearchResults?.hotels ?? []).length,
        },
        generated_at: generatedAt,
      },
    }).then(() => {}).catch(() => {});

    return new Response(
      JSON.stringify({ success: true, itinerary_id, share_slug: shareSlug, result: parsedResult }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await reportError(e, { function: "generate-itinerary" });
    const msg = errMsg.includes("PERPLEXITY") ? "API configuration error. Please try again later." : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
