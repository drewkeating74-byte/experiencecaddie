# Hotel booking link root-cause investigation

Plain-English trace of where the lodging URL is created, modified, saved, and opened — and how to isolate why it lands on a generic Booking.com page.

---

## 1. Full hotel-link path end to end

### Where the lodging URL is first created

- **Source:** The LLM (Perplexity) returns JSON with `packages[].lodging[]`. Each item has `name`, `type`, `area`, `price_per_night`, **`url`**, `why`.
- **File:** `apps/web/supabase/functions/generate-itinerary/index.ts`.
- **Meaning:** The **first** value of `h.url` is whatever the LLM put in the `url` field (often a Booking.com/Expedia link or a generic one).

### Where it is modified or normalized

- **File:** Same file, `generate-itinerary/index.ts`.
- **Loop:** `for (const pkg of parsedResult.packages || []) { for (const h of pkg.lodging || []) { ... } }` (around lines 668–679).
- **Logic:**
  1. `url = typeof h.url === "string" ? h.url.trim() : ""`.
  2. If `shouldReplaceHotelUrl(url)` is true (any OTA domain or empty/invalid), we **replace** the URL:
     - Optionally rewrite vague names: if `normalizeHotelNameForSearch(h.name)` is low-confidence and we have area/city, set `h.name = "Hotels in {area}"` or `"Hotels in {city}"`.
     - Then set `h.url = buildHotelSearchUrl(h.name || "Hotel", city, state, itinerary?.start_date, itinerary?.end_date)`.
- **`buildHotelSearchUrl`** (same file, ~572–599):
  - Builds `ss` from normalized name + city + state (or just city+state for low-confidence names).
  - Builds query: `ss`, `checkin`, `checkout` (YYYY-MM-DD), `group_adults`, `no_rooms`, `group_children`.
  - **Raw Booking.com URL:** `https://www.booking.com/searchresults.html?${params.toString()}`.
  - **AWIN wrapping (if `awinPublisherId` is set):**  
    `https://www.awin1.com/cread.php?awinmid=6776&awinaffid=${encodeURIComponent(awinPublisherId)}&ued=${encodeURIComponent(bookingUrl)}`  
    So the **destination** inside `ued` is that raw Booking.com URL, encoded once.

### Where AWIN wrapping is applied

- **File:** `generate-itinerary/index.ts`, inside `buildHotelSearchUrl`, right after building `bookingUrl`.
- **Condition:** Only if `awinPublisherId` is set (from env `AWIN_PUBLISHER_ID` or `AWIN_BOOKING_PUBLISHER_ID`).
- **Result:** Return value is either the raw Booking.com URL or the AWIN link; that single value is what gets assigned to `h.url`.

### Where the final URL is saved into the itinerary

- **Same loop:** `h.url = buildHotelSearchUrl(...)` writes into `parsedResult.packages[i].lodging[j].url`.
- **Persistence:** Later, `supabase.from("itineraries").update({ result_json: parsedResult, ... }).eq("id", itinerary_id)` (around 706–611) saves `parsedResult` to the DB. So the **saved** lodging URL is exactly that same string (raw Booking.com or AWIN-wrapped).

### Where the frontend reads and opens that URL

- **File:** `apps/web/src/pages/ItineraryResults.tsx`.
- **Read:** Lodging is rendered from `pkg.lodging` (from `itinerary.result_json.packages`). The button uses `h.url` and passes it to `trackClick`: `onClick={() => trackClick(pkg.tier, "hotel", h.name, h.url)}`.
- **Open:** `trackClick` (same file, ~106–115) does `window.open(url, "_blank", "noopener,noreferrer")` with that same `url` argument. So the **clicked** URL is exactly `h.url` from the saved `result_json` for that lodging item.

**Conclusion:** There is no second source of truth. The frontend opens the same string that is stored in `result_json.packages[].lodging[].url` (which was set in generate-itinerary). If the user lands on a generic Booking.com page, the cause is either (1) that stored URL is wrong or (2) something after the click (AWIN redirect or Booking.com) changes or strips the destination.

---

## 2. Example URLs for one newly generated itinerary

Assume: city Austin, state TX, dates 2025-04-01 / 2025-04-03, one lodging name "Hotel Van Zandt", and AWIN publisher ID set to `123456`.

- **Raw Booking.com URL (before AWIN):**  
  `https://www.booking.com/searchresults.html?ss=Hotel+Van+Zandt+austin+tx&checkin=2025-04-01&checkout=2025-04-03&group_adults=2&no_rooms=1&group_children=0`

- **Final AWIN-wrapped URL (if wrapping is enabled):**  
  `https://www.awin1.com/cread.php?awinmid=6776&awinaffid=123456&ued=https%3A%2F%2Fwww.booking.com%2Fsearchresults.html%3Fss%3DHotel%2BVan%2BZandt%2Baustin%2Btx%26checkin%3D2025-04-01%26checkout%3D2025-04-03%26group_adults%3D2%26no_rooms%3D1%26group_children%3D0`

- **Saved `lodging[].url` in the itinerary record:**  
  Either the raw URL or the AWIN URL above, depending on whether `AWIN_PUBLISHER_ID` (or `AWIN_BOOKING_PUBLISHER_ID`) is set in the Edge Function secrets.

- **URL the frontend opens on click:**  
  The same string as `lodging[].url` for that card (passed as the fourth argument to `trackClick` and then to `window.open`).

So for a **newly** generated itinerary, the saved value and the opened value are the same. If the user still sees a generic Booking.com page, the problem is either the **content** of that URL (format, params) or the **redirect** (AWIN or Booking.com) that runs after the click.

---

## 3. What could be causing the generic landing page

- **Bad raw Booking.com URL format**  
  If `checkin`/`checkout` or other params are wrong or unsupported, Booking.com might ignore them and show a generic or homepage experience. We currently use `checkin`/`checkout` in YYYY-MM-DD and `ss`; if the site expects different param names or encoding, that could explain it.

- **AWIN wrapping/redirect altering the destination**  
  If AWIN’s redirect for `cread.php` does not pass the full `ued` URL (e.g. strips query string or only keeps the host), the user would land on Booking.com with no or wrong params → generic page. This would be an AWIN-side behavior, not a bug in our builder.

- **Booking.com redirecting even a valid deep link**  
  Booking.com might require cookies, geo, or session and redirect or “normalize” certain incoming URLs to the homepage or a generic search. That would be on their side; we can only try the minimal URL that still works (e.g. only `ss`).

- **Frontend using an unexpected field/value**  
  From the code, the frontend does **not** use a different field: it opens `h.url` from the same object that was saved. So a frontend bug (e.g. wrong field) is unlikely unless there is a different code path (e.g. share or email) that we did not trace.

**Most likely causes to test first:** (1) Booking.com not accepting our current params and effectively dropping them; (2) AWIN redirect not forwarding the full `ued` URL.

---

## 4. Comparison with known AWIN deep-link structure

- **Format we use:**  
  `https://www.awin1.com/cread.php?awinmid=6776&awinaffid=${encodeURIComponent(awinPublisherId)}&ued=${encodeURIComponent(bookingUrl)}`

- **ued:**  
  We set `ued` to `encodeURIComponent(bookingUrl)`. So the destination is URL-encoded **once** as the value of `ued`. That is correct for a query parameter.

- **Merchant ID:**  
  We use `awinmid=6776`. That is the documented Booking.com North America program on AWIN. Correct.

- **Double-encoding / malformed query:**  
  We do **not** double-encode: we build `bookingUrl` as a plain string, then pass it once to `encodeURIComponent` for `ued`. So the implementation matches the usual AWIN deep-link structure. If the generic page still appears when using the AWIN link, the next step is to confirm (via logging or manual test) the **exact** URL that AWIN redirects to (e.g. in DevTools Network or “copy link address” before click).

---

## 5. Smallest practical next steps (by finding)

- **If the raw Booking.com URL is bad:**  
  Add temporary logging to print the exact `bookingUrl` we build (see Section 6). Test that URL by pasting it in a new tab (no AWIN). If it still lands on a generic page, try a minimal form: only `ss` (e.g. `?ss=Austin+TX`), then add `checkin`/`checkout` back and see when it breaks. Fix the builder (param names or encoding) accordingly.

- **If AWIN wrapping is the problem:**  
  Temporarily **bypass** AWIN: do not set `AWIN_PUBLISHER_ID` / `AWIN_BOOKING_PUBLISHER_ID` in Supabase secrets, redeploy generate-itinerary, generate a new itinerary, and test the lodging link. If without AWIN the same raw URL works (search results with dates), then the issue is AWIN’s redirect (e.g. not passing full `ued`). Then either fix the way we pass `ued` (if AWIN docs show a different requirement) or use a different linking method (e.g. Link Builder API) if available.

- **If Booking.com itself redirects these links:**  
  Use the **simplest** URL that still works: e.g. only `ss=<destination>` and drop `checkin`/`checkout` and other params. Document that dates may not be prefilled and keep the rest of the flow unchanged.

- **If the frontend were wrong:**  
  We’d see a mismatch between saved `lodging[].url` and what opens. With the debug logging below (and optionally a `data-hotel-url` + read in handler like events), we can confirm they match.

---

## 6. Temporary debug logging (code to add)

### In `generate-itinerary` (Supabase Edge Function) — ADDED

- **Inside `buildHotelSearchUrl`:** After building `bookingUrl`, we log `[HOTEL_LINK_DEBUG] buildHotelSearchUrl` with `raw_booking_url` and `awin_wrapping` (true/false). So each call logs the exact Booking.com URL and whether it was wrapped.
- **Inside the lodging loop:** After processing each `h`, we log `[HOTEL_LINK_DEBUG] lodging` with `pkg_tier`, `name`, `original_url` (LLM value), `replacement_fired`, `final_saved_url` (h.url), and `final_is_awin` (whether the saved URL contains awin1.com).

View these in Supabase Dashboard → Edge Functions → generate-itinerary → Logs (for a request that just generated an itinerary).

### In the frontend (ItineraryResults.tsx) — ADDED

- **Inside `trackClick`:** When `vendor === "hotel"`, we log `[HOTEL_LINK_DEBUG] frontend click` with `tier`, `label`, and `url_opened: url`. So the exact URL passed to `window.open` is in the browser console.

Compare `url_opened` in the frontend log to `final_saved_url` in the Edge Function log to confirm they match. Remove these logs once root cause is fixed.

---

## 7. Manual test plan (four cases)

Use a **newly generated** itinerary so the saved data matches the current code and deploy.

### Case A: Raw Booking.com URL with only `ss`

1. In `buildHotelSearchUrl`, temporarily comment out the `checkin`/`checkout` and group_* params so the URL is only `?ss=...` (e.g. `https://www.booking.com/searchresults.html?ss=Hotel+Van+Zandt+austin+tx`).
2. Deploy: `cd apps/web && npx supabase functions deploy generate-itinerary`.
3. Ensure **AWIN is off** (no `AWIN_PUBLISHER_ID` / `AWIN_BOOKING_PUBLISHER_ID` in Supabase secrets).
4. Generate a new itinerary (e.g. Austin, TX, any dates).
5. In DB or via a small debug response, copy one `result_json.packages[].lodging[].url`.
6. Paste that URL in a new browser tab and open it.
7. **Expected:** Booking.com search results for that `ss` (possibly without dates).  
   **If you get generic/home:** Booking.com is not accepting our `ss`-only URL; try a different `ss` format (e.g. “Austin, TX” or “Austin Texas”) and repeat.

### Case B: Raw Booking.com URL with `ss` + `checkin`/`checkout`

1. Restore `checkin`/`checkout` and group_* in `buildHotelSearchUrl` so the URL includes all current params.
2. Keep AWIN off. Deploy, generate a **new** itinerary.
3. Copy one saved `lodging[].url` (must be the raw Booking.com link, not AWIN).
4. Paste in a new tab and open.
5. **Expected:** Search results for the destination with check-in/check-out prefilled.  
   **If you get generic/home:** Booking.com is likely rejecting or ignoring our param set; try Case A (only `ss`) and/or different param names/format per their current docs.

### Case C: AWIN-wrapped version of the same URL

1. Set `AWIN_PUBLISHER_ID` (or `AWIN_BOOKING_PUBLISHER_ID`) in Supabase Edge Function secrets. Deploy generate-itinerary.
2. Generate a **new** itinerary.
3. Copy one saved `lodging[].url` (should start with `https://www.awin1.com/cread.php?...&ued=...`).
4. Paste in a new tab and open. Let the redirect complete.
5. **Expected:** You end up on the same Booking.com search as in Case B (or A if you only use `ss`).  
   **If you get generic Booking.com:** Decode the `ued` value (e.g. in DevTools or a decoder). Compare decoded URL to the raw URL from Case B. If they match, the problem is AWIN’s redirect (e.g. not sending full URL). If they don’t match, our encoding or building of `ued` is wrong.

### Case D: Exact saved URL from a new itinerary record

1. Generate a new itinerary with the **exact** code/deploy you want to test (AWIN on or off).
2. In Supabase Dashboard → Table Editor → `itineraries`, open that row and copy from `result_json` one full `packages[].lodging[].url` string.
3. In the app UI, click the “Book” button for that same lodging item.
4. In the browser console, confirm the `[HOTEL_LINK_DEBUG] frontend click` log shows `url_opened` equal to the copied string.
5. Paste the copied string into a new tab and open it.
6. **Expected:** Same destination as when clicking in the app.  
   **If click and paste behave differently:** Note which one lands on generic vs correct; that will tell you if the issue is in-app (e.g. pop-up blocker, wrong variable) or in the URL itself / redirect.

---

## Summary

- **Path:** LLM → `parsedResult.packages[].lodging[].url` → replace with `buildHotelSearchUrl` (raw Booking.com, then optionally AWIN wrap) → save in `result_json` → frontend reads `h.url` and passes to `trackClick` → `window.open(url)`.
- **Saved and opened URL are the same.** So the failure is either the **built URL** (format/params) or the **redirect** (AWIN or Booking.com).
- **Next steps:** Add the debug logs, run Cases A–D, and compare logs + behavior to see whether the fault is (1) raw URL format, (2) AWIN redirect, or (3) Booking.com handling. Then apply the smallest fix (builder params, AWIN bypass, or minimal `ss`-only URL) as in Section 5.
