# Hotel booking link root-cause investigation (no AWIN)

You are **not** using AWIN yet. This doc traces why hotel clicks land on a generic Booking.com page and how to isolate the failing layer.

---

## 1. Full hotel-link path end to end

### Where the lodging URL is first created

- **Source:** The LLM (Perplexity) returns JSON. Each package has `lodging[]` with `name`, `type`, `area`, `price_per_night`, **`url`**, `why`.
- **File:** `apps/web/supabase/functions/generate-itinerary/index.ts`. The URL first appears as whatever the LLM put in `parsedResult.packages[i].lodging[j].url` after we parse the AI response (around line 504).
- **Meaning:** That value is the “original lodging URL from the LLM” — often a Booking.com or Expedia link, or empty/generic.

### Where it is modified or normalized

- **File:** Same file. In the loop `for (const pkg of parsedResult.packages)` then `for (const h of pkg.lodging)` (lines 671–691).
- **Steps:**
  1. `url = typeof h.url === "string" ? h.url.trim() : ""`.
  2. `replaced = shouldReplaceHotelUrl(url)`.  
     Replacement runs if the URL is empty, invalid, or its host is one of: booking.com, expedia.com, hotels.com, hotel.com (we always replace those).
  3. If `replaced` is true:
     - Optionally set `h.name = "Hotels in {area}"` or `"Hotels in {city}"` when the name is low-confidence.
     - Then `h.url = buildHotelSearchUrl(h.name || "Hotel", city, state, itinerary?.start_date, itinerary?.end_date)`.
- **`buildHotelSearchUrl`** (lines 572–599): Builds `ss` from name + city + state (or just city+state), then:
  - `params.set("ss", ss)`, `params.set("checkin", startDate)`, `params.set("checkout", endDate)`, plus `group_adults`, `no_rooms`, `group_children`.
  - Returns `https://www.booking.com/searchresults.html?${params.toString()}`.  
  (With AWIN off, we never wrap; we return that raw URL.)

So the “final raw Booking.com URL” is exactly the return value of `buildHotelSearchUrl` when replacement runs.

### Where the final URL is saved into the itinerary

- **Same loop:** We assign to `h.url`, so `parsedResult.packages[].lodging[].url` is updated in memory.
- **Persistence:** A few lines later, `supabase.from("itineraries").update({ result_json: parsedResult, status: "generated" }).eq("id", itinerary_id)` (lines 701–707) writes that object to the database. So the **saved** value is `result_json.packages[k].lodging[m].url` = the same string we set in the loop (the raw Booking.com URL when replacement fired).

### Where the frontend reads and opens that URL

- **File:** `apps/web/src/pages/ItineraryResults.tsx`. Lodging is rendered from `pkg.lodging` (from `itinerary.result_json.packages`).
- **Read:** The button uses `h.url`: `onClick={() => trackClick(pkg.tier, "hotel", h.name, h.url)}` (around line 405).
- **Open:** `trackClick` receives that `url` as the fourth argument and calls `window.open(url, "_blank", "noopener,noreferrer")` (line 116). So the **clicked** URL is exactly `h.url` from the loaded itinerary.

**Conclusion:** One path only. The frontend opens the same string that is stored in `result_json.packages[].lodging[].url`. With AWIN off, that string is either (a) the raw Booking.com URL we built, or (b) the LLM’s original URL when we did not replace. If users see a generic Booking.com page, the cause is either the **content** of that URL (format/params) or **Booking.com** reacting to it (e.g. redirecting or ignoring params).

---

## 2. Example for one newly generated itinerary (no AWIN)

Assume: city **Austin**, state **TX**, dates **2025-04-01** / **2025-04-03**, one lodging name **Hotel Van Zandt**, and **no** AWIN secrets set.

- **Original lodging URL from the LLM:**  
  e.g. `https://www.booking.com/` or `https://www.expedia.com/Hotel-Search` or a specific property link. (You’ll see this in logs as `original_url`.)

- **Final raw Booking.com URL after replacement logic:**  
  `https://www.booking.com/searchresults.html?ss=Hotel+Van+Zandt+austin+tx&checkin=2025-04-01&checkout=2025-04-03&group_adults=2&no_rooms=1&group_children=0`

- **Exact saved `lodging[].url` in the itinerary record:**  
  The same as above (because we set `h.url` to that string and then save `parsedResult` in `result_json`).

- **Exact URL the frontend opens on click:**  
  The same string again: the button passes `h.url` into `trackClick`, and `window.open(url)` opens it. So saved value = opened value.

So for a **new** itinerary with replacement firing, all four are the same raw Booking.com URL. If that URL still leads to a generic page, the problem is either (1) our **format** (Booking.com doesn’t accept these params and shows a generic page) or (2) **replacement not firing** (so the saved/opened URL is still the LLM’s generic link). Debug logs tell you which.

---

## 3. What could be causing the generic landing page

- **Bad raw Booking.com URL format**  
  If Booking.com no longer accepts `checkin`/`checkout` in YYYY-MM-DD or expects different param names/encoding, they might ignore the query and show a generic or homepage experience. **Test:** Paste the exact saved URL (from DB or from logs) into a new tab; if it still goes generic, the format is wrong.

- **Replacement logic not firing**  
  If `shouldReplaceHotelUrl(url)` is false, we never call `buildHotelSearchUrl` and leave the LLM’s `h.url` as-is. That can be a generic link (e.g. `https://www.booking.com/`). **Test:** In Edge Function logs, check `replacement_fired`. If it’s false for some items, the condition is wrong (e.g. non-OTA host or empty string not treated as replace).

- **Saved itinerary still containing old/generic URLs**  
  Only possible if (a) replacement didn’t run for that item, or (b) you’re looking at an **old** itinerary generated before the fix. **Test:** Generate a **brand-new** itinerary after the latest deploy and inspect `result_json.packages[].lodging[].url` in the DB; compare to logs.

- **Frontend using an unexpected field/value**  
  The code uses only `h.url` for the Book button and for `window.open`. There is no other field. So a frontend bug (wrong variable) is unlikely. **Test:** Log the clicked URL in the frontend and compare to the saved value; they should match.

- **Booking.com redirecting/normalizing even a valid search URL**  
  Their site might require cookies, geo, or session and redirect certain incoming links to the homepage. **Test:** Same as “bad format”: paste the exact URL in an incognito tab; if it goes generic, the issue is on Booking.com’s side. Then try a **minimal** URL (e.g. only `?ss=Austin+TX`) and see if that works.

---

## 4. Smallest practical next step (by finding)

- **If the raw Booking.com URL is bad:**  
  Use the logged `raw_booking_url` (or the saved URL from a new itinerary). Paste it in a new tab. If it lands on a generic page, try simplifying: e.g. only `ss` first (`?ss=Austin+TX`), then add `checkin`/`checkout` and see when it breaks. Fix the builder (param names or encoding) accordingly.

- **If replacement logic is not firing:**  
  In Supabase Edge Function logs, for the generate-itinerary request, check `[HOTEL_LINK_DEBUG] lodging`. If `replacement_fired` is false but the `original_url` is clearly generic (e.g. booking.com homepage), then `shouldReplaceHotelUrl` is wrong. Fix the condition (e.g. treat empty or non-http as replace, and ensure all booking.com/expedia/hotels.com hosts trigger replace).

- **If saved data is stale:**  
  Always test with a **brand-new** itinerary created after your latest deploy. Open Supabase → Table Editor → `itineraries` → the new row → expand `result_json` → copy `packages[0].lodging[0].url` (or the one you clicked). That is the exact saved URL. Compare to the frontend log `url_opened`; they must match.

- **If Booking.com itself redirects these links:**  
  If the same URL works when you type it in the address bar in one context but not when opened from a link, or if even a minimal `?ss=...` URL ends up generic, then the site may be normalizing. In that case, use the **simplest** URL that still shows search results (e.g. only `ss`) and accept that dates might not always be prefilled.

---

## 5. Temporary debug logging (already in place)

The following is **already** in the codebase. Use it to see original URL, whether replacement ran, final Booking.com URL, final saved URL, and what the frontend opens.

### Backend — `apps/web/supabase/functions/generate-itinerary/index.ts`

**Inside `buildHotelSearchUrl`** (after building `bookingUrl`):

- We log `[HOTEL_LINK_DEBUG] buildHotelSearchUrl` with `raw_booking_url` and `awin_wrapping`. With AWIN off, `awin_wrapping` is false and the returned URL is that same `raw_booking_url`.

**Inside the lodging loop** (after processing each `h`):

- We log `[HOTEL_LINK_DEBUG] lodging` with:
  - `pkg_tier`, `name`
  - `original_url` — LLM value
  - `replacement_fired` — whether we replaced
  - `final_saved_url` — `h.url` (what gets saved)
  - `final_is_awin` — with AWIN off this is false

View in: Supabase Dashboard → Edge Functions → generate-itinerary → Logs (for the request that created the itinerary).

### Frontend — `apps/web/src/pages/ItineraryResults.tsx`

**Inside `trackClick`** (before `window.open`):

- When `vendor === "hotel"` we log `[HOTEL_LINK_DEBUG] frontend click` with `tier`, `label`, `url_opened: url`. That is the exact URL passed to `window.open`.

**How to use:** Generate a new itinerary, click one lodging “Book” link, then:

1. In **Supabase logs:** find `[HOTEL_LINK_DEBUG] buildHotelSearchUrl` and `[HOTEL_LINK_DEBUG] lodging` for that run. Note `original_url`, `replacement_fired`, `raw_booking_url` (from buildHotelSearchUrl), and `final_saved_url`.
2. In **browser console:** find `[HOTEL_LINK_DEBUG] frontend click` and note `url_opened`.
3. Confirm `url_opened` === `final_saved_url`. If they match and the page is still generic, the problem is the **URL content** or **Booking.com** behavior.

Remove these logs once the root cause is fixed.

---

## 6. Step-by-step manual test plan (3 cases)

Use a **brand-new** itinerary for each case (so `result_json` matches the code you’re testing).

---

### Case 1: Booking.com URL with only `ss`

**Goal:** See if a minimal search URL (no dates, no group_*) lands on a useful search page.

1. **Temporarily change the builder** so it only adds `ss` to the query (comment out `checkin`, `checkout`, `group_adults`, `no_rooms`, `group_children` in `buildHotelSearchUrl`). So the URL is e.g.  
   `https://www.booking.com/searchresults.html?ss=Hotel+Van+Zandt+austin+tx`
2. Deploy: `cd apps/web && npx supabase functions deploy generate-itinerary`.
3. Generate a **new** itinerary (e.g. Austin, TX, any dates).
4. In Supabase → `itineraries` → that row → `result_json` → copy one `packages[].lodging[].url` (or get it from Edge Function logs `final_saved_url`).
5. Paste that URL into a **new browser tab** and open it.
6. **Expected:** Booking.com search results for that `ss` (destination/hotel + city), possibly without dates.  
   **If you get a generic/home page:** Booking.com may not be accepting our `ss` format or the path; try varying `ss` (e.g. “Austin, TX” or “Austin Texas”) and repeat.  
   **If you get a proper search page:** The minimal format works; the issue may be the extra params (checkin/checkout/group_*). Proceed to Case 2.

---

### Case 2: Booking.com URL with `ss` + `checkin` / `checkout`

**Goal:** See if adding dates (and group_*) breaks the landing.

1. **Restore** `checkin`, `checkout`, `group_adults`, `no_rooms`, `group_children` in `buildHotelSearchUrl` so the URL is again like:  
   `https://www.booking.com/searchresults.html?ss=...&checkin=2025-04-01&checkout=2025-04-03&group_adults=2&no_rooms=1&group_children=0`
2. Deploy generate-itinerary. Generate a **new** itinerary.
3. Copy the saved `lodging[].url` from the new row (or from logs).
4. Paste in a new tab and open.
5. **Expected:** Same search destination as Case 1, with check-in/check-out prefilled.  
   **If you get a generic page:** Booking.com may be rejecting or ignoring these params; try removing only `checkin`/`checkout` and keep `group_adults` etc., or try different param names/format per their current docs.

---

### Case 3: Exact saved URL from a brand-new itinerary record

**Goal:** Confirm that what’s saved is what’s opened, and that pasting that URL behaves the same as clicking.

1. With your **current** (production) code and deploy, generate a **new** itinerary.
2. In Supabase → Table Editor → `itineraries` → open the new row → in `result_json` copy the full string for one `packages[].lodging[].url`.
3. In your app, open that itinerary and click the “Book” button for **that same** lodging item.
4. In the browser console, check `[HOTEL_LINK_DEBUG] frontend click` and note `url_opened`.
5. **Compare:** `url_opened` should equal the copied `lodging[].url`. If they differ, the frontend or the loaded data is wrong.
6. Paste the **copied** URL into a new tab and open it.
7. **Compare:** The result (generic vs search results) should be the same as when you clicked in the app. If click and paste behave differently, note which one is correct; that helps distinguish app vs URL/Booking.com issues.

---

## Summary (no AWIN)

- **Path:** LLM → `parsedResult.packages[].lodging[].url` → replace with `buildHotelSearchUrl` (raw Booking.com only) → save in `result_json` → frontend reads `h.url` → `trackClick(..., h.url)` → `window.open(url)`.
- **Saved URL = opened URL.** So the failure is either (1) **replacement not firing** (so we saved a generic LLM URL), or (2) **our built URL** (Booking.com doesn’t like the format and shows a generic page), or (3) **Booking.com** redirecting/normalizing.
- **Next steps:** Use the existing debug logs and the 3-case test plan above to see whether replacement runs, what exact URL is saved and opened, and whether that URL works when pasted. Then fix the builder or the condition as in Section 4.
