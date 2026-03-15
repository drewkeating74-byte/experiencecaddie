# Experience Caddie – Manual Testing Checklist

Use this list when doing a full pass. Check off each item as you go. If something fails, note it in the Bug Log (see BUG_LOG_TEMPLATE.md).

---

## Before you start

- [ ] You have the production (or staging) URL and it loads.
- [ ] You have one test account (email + password) and can log in with Google.
- [ ] Browser DevTools are open (F12) → Network tab, so you can see failed requests (e.g. 400/500).

---

## 1. Artist + major city

- [ ] Go to Home → **Start Your Experience**.
- [ ] Choose **I already know who I want to see** and enter a big artist (e.g. Luke Combs).
- [ ] Enter a major city (e.g. Nashville) and dates that include a real tour date.
- [ ] Set budget and group size → **Generate My Itinerary**.
- [ ] Wait for redirect to itinerary page (no timeout or error).
- [ ] See three tabs: Bronze, Silver, Gold, each with descriptor text.
- [ ] See at least one concert, lodging, and golf per tier.
- [ ] Click **Find Tickets** on a concert → new tab opens (Ticketmaster search or correct site), no 404.
- [ ] In Network tab, one `track-click` request with status **200** (if logged in).

---

## 2. Artist + smaller city

- [ ] Same as above but use a smaller city (e.g. Thackerville OK) and an artist who plays there.
- [ ] Itinerary loads; tiers may have fewer options but no blank or broken sections.
- [ ] **Find Tickets** still opens a valid page (no 404).

---

## 3. Discover flow – best upcoming shows

- [ ] **Start Your Experience** → **Show me the best upcoming shows**.
- [ ] Set city and dates → **Generate My Itinerary**.
- [ ] See “Finding the best concerts…” then **Pick your concert** with a list of options.
- [ ] Click **Build my trip** on one option.
- [ ] See “Crafting Your Legendary Weekend…” then redirect to itinerary.
- [ ] Itinerary matches the concert you picked (artist, city, date).
- [ ] **Find Tickets** on that concert works.

---

## 4. Discover flow – I’m flexible

- [ ] **Start Your Experience** → **I’m flexible — show me something great**.
- [ ] Set city and dates (or leave flexible) → **Generate My Itinerary**.
- [ ] Pick one concert from the list → **Build my trip**.
- [ ] Itinerary loads and matches your pick.

---

## 5. Login redirect

- [ ] Open an itinerary via **share link** in **incognito** (logged out).
- [ ] Click **Find Tickets** (or **Save**). You are sent to the login page and the URL has `?redirect=/itinerary/...`.
- [ ] Log in with Google (or email).
- [ ] You land back on the **same** itinerary URL (not home).
- [ ] Click **Find Tickets** again → track-click returns **200**, new tab opens.

---

## 6. Share link in new window / device

- [ ] From an itinerary, copy the **Share** link (or get it from “Share via email”).
- [ ] Open that link in a **new incognito window** or another device.
- [ ] URL is your **production** domain (not localhost).
- [ ] Page redirects to `/itinerary/...` and the full itinerary loads (all tiers visible).
- [ ] No “Itinerary not found” or blank content.

---

## 7. Ticket / golf / hotel clicks

- [ ] **Logged in**, on an itinerary, click **Find Tickets** on a concert → track-click 200, correct site opens.
- [ ] Click a **hotel** link → track-click 200, hotel site opens.
- [ ] Click a **golf** link → track-click 200, golf site opens.
- [ ] No 400 on any `track-click` request.

---

## 8. Regenerate / repeat / refresh

- [ ] Generate an itinerary (artist + city). Copy the share link.
- [ ] Change nothing; generate **again** with the same inputs.
- [ ] You get a **new** share link (different slug). Both links open and show their own itinerary.
- [ ] On an itinerary page, click **Refresh** (if shown). You see “Refreshing…” then “Refresh complete.” (Note: backend does not actually refresh yet – this is expected.)

---

## 9. Thin or weak results

- [ ] Use an artist with **no** tour dates in your date range (or a tiny city). Generate.
- [ ] Either you get a clear “no results” style message, or an itinerary that doesn’t look broken.
- [ ] For **Discover**, try dates/city with no concerts → you see “No concerts found” (or similar) and can try different dates or artists.
- [ ] No uncaught errors or endless loading.

---

## 10. Save package and return

- [ ] Log in. Open an itinerary. Click **Save** (bookmark) on one tier (e.g. Silver).
- [ ] The bookmark icon updates to “saved” state.
- [ ] Go to **My Trips** (or your saved list). That itinerary appears; open it.
- [ ] Same itinerary loads; the same tier still shows as saved.
- [ ] Open the same itinerary again via its **share link** → still shows as saved when logged in.

---

## Done

- [ ] All scenarios checked or explicitly skipped with a note.
- [ ] Any failures or odd behavior written in the Bug Log.

For full scenario details and “what could go wrong,” see **SCENARIO_TESTING.md**.
