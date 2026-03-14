# Golf API + Routing MVP Implementation Plan

**Created:** 2026-03-04  
**Updated:** 2026-03-04  
**Status:** Ready for implementation  
**Audience:** Non-developer using Cursor

---

## 1. Recommended Golf Data Source

### Google-only for MVP

Use **Google Maps Platform** exclusively for golf discovery in Phase 1:

| Component | API | Purpose |
|-----------|-----|---------|
| **Geocoding** | Geocoding API | Convert city/state to coordinates when venue coords are not available |
| **Golf discovery** | Places API (New) — Nearby Search | Find golf courses by lat/lng + radius |

### Optional fallback (later)

- **GolfCourseAPI** – Free 300 req/day, text search by city. Consider adding if you need a non-Google fallback when Places is unavailable or over quota.

### Deferred (later phases)

- **Golf-course-database.com** – Paid subscription, has `club_membership=Public` filter. Consider if you need guaranteed public-only data.
- **GolfNow API** – Requires partnership; not self-serve.

---

## 2. Google Maps Platform Pricing (Post–March 2025)

As of **March 1, 2025**, Google replaced the blanket $200 monthly credit with **free monthly usage caps per SKU**. Each service has its own free tier; usage above the cap is billed per request.

| API | Free monthly cap (typical) | Notes |
|-----|----------------------------|-------|
| **Geocoding** | 10,000 requests | Essentials tier |
| **Places API (New) — Nearby Search** | Varies by SKU | Pro/Essentials; field mask affects which SKU applies |
| **Places with routing (routingSummaries)** | Varies by SKU | Enterprise+ SKU; different pricing tier |

**What to do:**
- Check current caps at [Google Maps Platform Pricing](https://mapsplatform.google.com/pricing/).
- Use field masking (Section 7) to request only needed fields and stay in lower tiers when possible.
- Set billing alerts in Google Cloud Console to avoid surprises.

---

## 3. How to Find Golf Near a Venue or Destination

### Flow

1. **When user picks a concert**  
   Ticketmaster events include `venue.location.latitude` and `venue.location.longitude`. Use these as the search center.

2. **When user only enters a city**  
   Call **Google Geocoding API** with `address={city}, {state}, USA` to get lat/lng. Use that as the search center.

3. **Search logic**

   - **If we have lat/lng (venue or geocoded city):**  
     Call Google Places Nearby Search with:
     - `locationRestriction.circle.center`: `{ latitude, longitude }`
     - `locationRestriction.circle.radius`: 40,000 meters (≈25 miles)
     - `includedTypes`: `["golf_course"]`
     - `maxResultCount`: 10 (or up to 20)
     - `rankPreference`: `"DISTANCE"`
   - **If geocoding fails:**  
     Return mock golf or empty array; log the error. GolfCourseAPI can be added later as an optional fallback.

---

## 4. How to Identify Public / Playable Courses

### MVP approach

- **Google Places** does not expose public vs. private. All golf courses are returned.
- **Heuristic:** Infer from course name:
  - `likely_private` – name contains "Country Club", "Private", "Members Only"
  - `likely_public` – name contains "Municipal", "Public", "City", or none of the private markers
  - `unknown` – when heuristic does not apply
- **UI note:** Add disclaimer: *"Call ahead to confirm public access and tee time availability."*
- **Deferred:** Paid DB with `club_membership=Public`, manual curation, or future data source.

---

## 5. Proposed Response Shape for `golf_courses`

Keep compatibility with the existing `GolfCourseResult` type and what `generate-itinerary` expects:

```typescript
type GolfCourseResult = {
  id: string;                    // Unique ID (e.g. Google place_id or "golf_1")
  name: string;                  // Course name
  city: string;
  state?: string;
  public_access?: boolean;       // Deprecated in favor of public_access_confidence
  public_access_confidence?: "likely_public" | "unknown" | "likely_private";
  rating?: number;               // 1–5 if available (Google); else undefined
  tee_time_window?: { start: string; end: string };  // Optional; from request
  lat?: number;
  lng?: number;
  distance_miles?: number;       // From venue/center (Phase 2, when routing used)
  drive_time_minutes?: number;   // From venue/center (Phase 2, when routing used)
  image_url?: string;
  source_url?: string;           // Place details, course website, or tee-time search link
  book_url?: string;             // Course website OR GolfNow/TeeOff tee-time search link
  price_min?: number;
  price_max?: number;
  source: string;                // "google_places" | "mock"
  as_of: string;                 // ISO 8601 timestamp when data was fetched
  provider: "google_places" | "mock";  // For backward compatibility
};
```

### Book URL / source_url (tee times)

- **MVP:** Each golf result should have **at least one** of:
  - Course website (`places.websiteUri` from Google)
  - Tee-time search link (GolfNow or TeeOff deep link with course name + city)
  - Google Maps link to the place
- Any of these is acceptable for the "Tee Times" or equivalent button. Prefer tee-time search when available; fall back to website or Maps if not.

---

## 6. Required Secrets and Config

### Supabase Edge Function Secrets

| Secret | Used by | Purpose |
|--------|---------|---------|
| `GOOGLE_PLACES_API_KEY` | search | Geocoding + Places Nearby Search (golf discovery) |
| *(existing)* `TICKETMASTER_API_KEY` | search | Concert data (venue coords) |

### Google Cloud setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable **Geocoding API**.
3. Enable **Places API (New)**.
4. Create an API key under **Credentials**.
5. (Recommended) Restrict the key to Geocoding API and Places API only.
6. Copy the key and add it as `GOOGLE_PLACES_API_KEY` in Supabase secrets.
7. Set billing alerts ($50–100) to avoid surprises.

---

## 7. Phased Implementation Steps

### Phase 1: Golf discovery (Google-only, no routing)

**Goal:** Replace mock golf with real courses from Google Places.

| Step | Task | Where | Cursor prompt idea |
|------|------|-------|--------------------|
| 1.1 | Add `GOOGLE_PLACES_API_KEY` to Supabase secrets | Supabase Dashboard | N/A (manual) |
| 1.2 | Add `geocodeCity(city, state)` using Geocoding API | `apps/web/supabase/functions/search/index.ts` | "Add a function that geocodes city and state to lat/lng using Google Geocoding API" |
| 1.3 | Add `searchGolfGooglePlaces(lat, lng, radiusMeters)` | Same file | "Add a function that calls Google Places Nearby Search for golf_course type" |
| 1.4 | **Request params:** `maxResultCount: 10`, `rankPreference: "DISTANCE"`, `locationRestriction.circle` with center + radius 40000 | Same file | "Use maxResultCount 10, rankPreference DISTANCE, and 40km radius in Places Nearby Search" |
| 1.5 | **Field mask:** Request only needed fields to minimize cost. Minimum: `places.id`, `places.displayName`, `places.formattedAddress`, `places.addressComponents`, `places.location`, `places.websiteUri`, `places.rating` (Pro SKU). Omit `routingSummaries` and Enterprise fields in Phase 1. | Same file | "Use X-Goog-FieldMask with only places.id, places.displayName, places.formattedAddress, places.addressComponents, places.location, places.websiteUri, places.rating" |
| 1.6 | Replace `mockGolf()` with real golf when `GOOGLE_PLACES_API_KEY` exists; geocode city when only city/state provided | Same file | "Replace mockGolf with real golf: geocode city when no coords, then call Places Nearby Search" |
| 1.7 | Map Places response to `GolfCourseResult` including `source`, `as_of`, `public_access_confidence` | Same file | "Map Places response to GolfCourseResult with source, as_of, and public_access_confidence heuristic" |
| 1.8 | Set `book_url` or `source_url` to course website, GolfNow/TeeOff search link, or Maps link | Same file | "Set book_url/source_url from websiteUri or build GolfNow/TeeOff search link from course name and city" |
| 1.9 | Deploy search function, smoke test | CLI | `supabase functions deploy search` |

### Phase 2: Routing (drive time + distance)

**Goal:** Use Places Nearby Search routing to get travel summaries from venue to each course.

| Step | Task | Where | Notes |
|------|------|-------|-------|
| 2.1 | Add `routingParameters.origin` to the Places Nearby Search request body with venue/city lat/lng | search function | [Places API routing](https://developers.google.com/maps/documentation/places/web-service/routing-summary): pass `origin: { latitude, longitude }` |
| 2.2 | Add `routingSummaries` to the field mask | Same | Required to receive routing data; may change SKU to Enterprise+ |
| 2.3 | Parse `routingSummaries` from the response | Same | Each place may have routing summary with `travelDuration` and `travelDistance`; format and availability may vary—see API docs |
| 2.4 | Map to `drive_time_minutes` and `distance_miles` when present | Same | Convert duration/distance from API units as documented |
| 2.5 | Sort golf courses by `drive_time_minutes` when available | Same | Ascending order |
| 2.6 | Update LLM prompt in generate-itinerary to mention drive time when present | generate-itinerary | Optional; improves itinerary copy |

**Note:** Routing behavior depends on Google's API. Use `routingParameters.origin` and `routingSummaries` as documented; if response shape or availability differs, handle gracefully (e.g., omit routing fields, keep distance sort as best-effort).

### Phase 3: Polish

| Step | Task |
|------|------|
| 3.1 | Prefer tee-time search links when building `book_url`; fall back to website or Maps |
| 3.2 | Add "Call ahead to confirm public access" note in itinerary UI |
| 3.3 | Update RUNBOOK.md with new secrets and troubleshooting |
| 3.4 | (Optional) Add GolfCourseAPI fallback when Places fails or key is missing |

---

## 8. Acceptance Criteria for MVP

### Must have

- [ ] User enters city (e.g. Austin) + dates → search returns **real** golf courses (no mock when API key is set).
- [ ] User selects a concert (with venue) → golf results are **near that venue** (within ~25 miles).
- [ ] Each golf result has: name, city, state, and **at least one** usable link—course website, tee-time search (GolfNow/TeeOff), or Google Maps link.
- [ ] When Google Places or Geocoding fails or has no key → fallback to mock with no crash.
- [ ] Search Edge Function logs errors clearly; RUNBOOK includes troubleshooting for missing keys.

### Nice to have (Phase 2)

- [ ] Golf courses sorted by drive time from venue.
- [ ] `distance_miles` and `drive_time_minutes` shown in itinerary (if UI is updated).

### Out of scope for MVP

- Real-time tee time availability.
- Guaranteed public-only filtering.
- Caching or advanced rate-limit handling.

---

## 9. What to Defer Until Later

| Item | Reason |
|------|--------|
| GolfCourseAPI fallback | Google-only for MVP; add later if needed |
| GolfNow / TeeOff official API | Requires partnership; deep links or website are enough |
| Caching golf results | On-demand is fine for MVP |
| Paid golf DB (e.g. golf-course-database.com) | Budget decision |
| Admin UI to manage golf sources | YAGNI for MVP |
| Separate Distance Matrix API | Places routing covers MVP; add only if needed |
| Hole-by-hole or slope/rating | Not needed for discovery |
| Multi-origin routing (hotel + venue) | Single origin (venue or city center) is enough |

---

## Quick Reference: Key Files

| File | Purpose |
|------|---------|
| `apps/web/supabase/functions/search/index.ts` | Where to add golf + routing logic |
| `apps/web/src/lib/api/search.ts` | Frontend types; `GolfCourseResult` |
| `docs/RUNBOOK.md` | Add `GOOGLE_PLACES_API_KEY`; troubleshooting |

---

## Next Step

Start with **Phase 1, Step 1.1** (add `GOOGLE_PLACES_API_KEY` to Supabase), then use Cursor to implement Step 1.2–1.5 with a prompt like:

> "In apps/web/supabase/functions/search/index.ts, add searchGolfGooglePlaces(lat, lng, radiusMeters) that calls Google Places API (New) Nearby Search for golf_course type. Use maxResultCount 10, rankPreference DISTANCE, and a field mask with only places.id, places.displayName, places.formattedAddress, places.addressComponents, places.location, places.websiteUri, places.rating. Use GOOGLE_PLACES_API_KEY. Map the response to GolfCourseResult including source, as_of, and public_access_confidence."
