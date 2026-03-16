# Hotel link — controlled comparison test plan

One brand-new itinerary. No code changes until the results point to a specific layer.

---

## 1. Short procedure (one brand-new itinerary)

1. **Create one new itinerary**  
   In the app: pick a city (e.g. Austin) and dates, generate. Wait until it finishes and you see the itinerary page.

2. **Copy the saved lodging URL from Supabase** (see Section 2).

3. **Run the four browser tests in order** (see Section 3). Record what happens for each (search results vs generic/home page).

4. **Interpret results** using Section 4 and decide the next coding move from Section 5.

---

## 2. What to copy from Supabase

1. Open **Supabase Dashboard** → your project → **Table Editor** → **itineraries**.
2. Find the **row you just created** (sort by `created_at` desc or match the share slug you opened).
3. Click that row so the detail panel opens.
4. In the **result_json** cell, click to expand or open the JSON.
5. Go to: **result_json** → **packages** → first package (e.g. **packages[0]**) → **lodging** → first lodging (e.g. **lodging[0]**) → **url**.
6. **Copy the full `url` value** (the whole string). It will look like either:
   - `https://www.booking.com/searchresults.html?ss=...&checkin=...&checkout=...&group_adults=...`  
   or
   - something like `https://www.booking.com/` or another short/generic link.

Paste that string into a text file or note so you can reuse it. Label it **“Saved URL”**.

---

## 3. Browser tests (in this order)

Do all in the **same browser** (e.g. Chrome), ideally in **incognito** so cookies/session don’t affect the result.

### Test A: Saved URL pasted manually

1. Open a **new tab**.
2. Paste the **Saved URL** (the one you copied from Supabase) into the address bar.
3. Press Enter.
4. **Record:** Do you see **Booking.com search results** for a place (e.g. Austin/hotel name), or a **generic/home** Booking.com page?

---

### Test B: In-app Book click

1. Go to the **itinerary page** for that same new itinerary (same browser).
2. Click the **Book** button for the **first** lodging in the first package (same one whose URL you copied).
3. **Record:** Does the new tab show **search results** or a **generic/home** page?
4. Optional: In DevTools → Console, check for `[HOTEL_LINK_DEBUG] frontend click` and confirm `url_opened` matches the Saved URL.

---

### Test C: Simplified URL — only `ss`

1. Build this URL by hand (replace with your city/state if you like):  
   `https://www.booking.com/searchresults.html?ss=Austin+TX`
2. Paste it into a **new tab** and press Enter.
3. **Record:** **Search results** or **generic/home**?

---

### Test D: Simplified URL — `ss` + `checkin` / `checkout`

1. Build this URL (again, adjust city/dates if you like):  
   `https://www.booking.com/searchresults.html?ss=Austin+TX&checkin=2025-04-01&checkout=2025-04-03`
2. Paste into a **new tab** and press Enter.
3. **Record:** **Search results** or **generic/home**?

---

## 4. How to interpret each result (plain English)

- **Saved URL (Test A)**  
  - **Search results:** The URL we save is valid; Booking.com accepts it. The problem is likely **not** “replacement not firing” or “stale data” for this itinerary; if the in-app click (B) still goes generic, something else is going on (e.g. frontend or pop-up).  
  - **Generic/home:** Either (1) we’re saving a **generic** link (replacement not firing or wrong URL built), or (2) we’re saving a “correct” search URL but **Booking.com is normalizing** it to the generic page. Use Tests C and D to tell which.

- **In-app click (Test B)**  
  - **Same as Test A:** Frontend is opening the same URL we saved; no mismatch.  
  - **Different from Test A:** e.g. A = search results, B = generic. Then the **opened** URL is not the saved one (e.g. wrong card, caching, or wrong field). Check console `url_opened` vs Saved URL.

- **Only `ss` (Test C)**  
  - **Search results:** Booking.com accepts at least a minimal `ss` search. So “Booking.com ignores our URL” is not total; they may only be strict about **extra** params (e.g. checkin/checkout).  
  - **Generic/home:** Either our **domain/path** is wrong, or Booking.com doesn’t honor this `ss` format in your region/setup. Then the next move is to fix or simplify the **builder** (format/params), not the replacement condition.

- **`ss` + checkin/checkout (Test D)**  
  - **Search results:** Our full format (with dates) is valid when pasted. If Saved URL (A) was generic but D works, we’re probably **not building** that format (replacement not firing or we’re building a different/wrong string).  
  - **Generic/home:** Booking.com may be **normalizing** or rejecting URLs that include these date params when pasted. If C works but D doesn’t, the next move is to **drop or change** the date params in the builder.

---

## 5. Next coding move (only if results point to one layer)

- **If Saved URL (A) is generic (e.g. `https://www.booking.com/`):**  
  **Replacement not firing** or we’re building the wrong URL.  
  → **Next move:** Fix replacement (e.g. `shouldReplaceHotelUrl` or the place we set `h.url`) or fix the builder so we output a search URL. Check Edge Function logs for that itinerary: `replacement_fired` and `final_saved_url`.

- **If Saved URL (A) looks like a full search URL but lands generic, and Test C (only `ss`) gives search results:**  
  **Booking.com is normalizing or rejecting our full query** (e.g. checkin/checkout or other params).  
  → **Next move:** Change the builder to use only `ss` (or the minimal set that works in C/D). No change to replacement or frontend.

- **If Saved URL (A) looks like a full search URL and Test A gives search results, but Test B (in-app click) gives generic:**  
  **Frontend or environment** is not opening the saved URL (e.g. wrong URL passed to `window.open`, or blocked/redirected).  
  → **Next move:** Fix the frontend so the clicked URL is exactly the saved `lodging[].url` (e.g. ensure the button uses `h.url` and log `url_opened` vs saved).

- **If both A and B give search results:**  
  No bug in this flow for this itinerary. If you still see “generic” sometimes, repeat with another **brand-new** itinerary to rule out **stale data** (old itinerary from before the fix).

- **If C and D both give generic:**  
  Our **domain/path or param format** doesn’t work for Booking.com in your test.  
  → **Next move:** Fix the builder (URL shape and param names) using Booking.com’s current docs or a known-working URL format. No change to replacement logic until the built URL works when pasted.

---

## 6. Summary

| Test | What you do | If search results | If generic/home |
|------|-------------|-------------------|------------------|
| A    | Paste Saved URL from DB | Saved URL is valid; issue may be click (B) or Booking.com with different params | Saved URL is wrong or Booking.com normalizes it |
| B    | Click Book in app       | Same as A → frontend OK | Opened URL ≠ saved URL or same as A |
| C    | Paste `?ss=Austin+TX` only | Minimal format works | Builder format/domain wrong |
| D    | Paste `?ss=...&checkin=...&checkout=...` | Full format works when pasted | Dates (or other params) break the URL |

Use this table and Section 5 to choose the **single** next coding move. Do not change code for a layer that the tests show is working.
