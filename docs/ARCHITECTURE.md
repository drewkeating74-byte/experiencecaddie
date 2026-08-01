# Experience Caddie – Architecture

## Runtime Overview

| Platform | Runs |
|----------|------|
| **Vercel** | Frontend only (React/Vite static app) |
| **Supabase** | Database, Auth, Edge Functions |

---

## What runs in Vercel?

Only the **frontend web app** (React/Vite, `apps/web`).

- Static HTML, CSS, and JavaScript
- No backend API; all server logic runs in Supabase Edge Functions

---

## What runs in Supabase?

1. **Database** – PostgreSQL (itineraries, profiles, saved packages, etc.)
2. **Auth** – Sign-up, login, Google OAuth
3. **Edge Functions** (Deno):
   - **search** – Ticketmaster event search + mock golf/hotels
   - **generate-itinerary** – Builds itineraries (Perplexity AI, writes to DB)
   - **send-share-email** – Share emails via Resend
   - **track-click** – Records clicks on booking links

---

## Vercel environment variables

Configure in Vercel → Project → Settings → Environment Variables:

| Variable | Purpose | Public? |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (e.g. `https://xxx.supabase.co`) | Yes, bundled |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key | Yes, bundled |
| `VITE_APP_URL` | Production URL for share links (e.g. `https://yoursite.vercel.app`) | Yes, bundled |

---

## Supabase Edge Function secrets

Configure in Supabase Dashboard → Edge Functions → Secrets:

| Secret | Used by | Purpose |
|--------|---------|---------|
| `TICKETMASTER_API_KEY` | search | Ticketmaster Discovery API |
| `RESEND_API_KEY` | send-share-email | Send share emails |
| `FROM_EMAIL` | send-share-email | Sender address |
| `PERPLEXITY_API_KEY` | generate-itinerary, verify-*, package-quality-monitor, refresh-hot-artists | Perplexity Agent API for itinerary generation and verification jobs |
| `PERPLEXITY_USE_AGENT_API` | same as above | Optional; default `true`. Set `false` to use legacy Sonar chat completions |

---

## Frontend → Supabase calls

| Action | URL |
|--------|-----|
| Search (events, golf, hotels) | `{VITE_SUPABASE_URL}/functions/v1/search` |
| Generate itinerary | `{VITE_SUPABASE_URL}/functions/v1/generate-itinerary` |
| Share email | `{VITE_SUPABASE_URL}/functions/v1/send-share-email` |
| Track click | `{VITE_SUPABASE_URL}/functions/v1/track-click` |

---

## Production flow (button click → result)

1. User fills city/dates/artist and clicks **Generate My Itinerary**.

2. **Search:** The frontend calls the `search` Edge Function for concerts, golf courses, and hotels. On failure, it uses built-in mock data.

3. **Generate:** The frontend POSTs to `generate-itinerary` with user input and search results.

4. **generate-itinerary:** Uses Perplexity Agent API for concert verification and itinerary generation, writes to the DB, returns `share_slug`.

5. **Redirect:** Frontend navigates to `/share/{share_slug}`.

6. **Share page:** Loads itinerary from Supabase by `share_slug` and displays the packages.

---

**Summary:** Vercel serves the frontend. Supabase handles database, auth, and all backend logic via Edge Functions.
