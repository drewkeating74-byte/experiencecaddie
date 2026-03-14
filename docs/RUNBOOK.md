# Experience Caddie – Runbook

Quick reference for deployments, env vars, and troubleshooting. Written for non-developers.

---

## 1. Architecture Summary

| Where | What runs |
|-------|-----------|
| **Vercel** | Frontend only (website) |
| **Supabase** | Database, login, and all backend logic (search, itinerary generation, share emails) |

The website lives on Vercel. All server work (searching concerts, building itineraries) happens in Supabase Edge Functions.

---

## 2. Where the Frontend Is Deployed

- **Platform:** Vercel
- **URL:** Your project’s Vercel URL (e.g. `https://experiencecaddie.vercel.app` or your custom domain)
- **Project:** Linked via `vercel link` or connected to your GitHub repo

---

## 3. Where Backend Functions Are Deployed

- **Platform:** Supabase
- **Region:** Your Supabase project’s region
- **Functions:** search, generate-itinerary, send-share-email, track-click
- **Dashboard:** [Supabase Dashboard](https://supabase.com/dashboard) → your project → Edge Functions

---

## 4. Environment Variables & Secrets

### Vercel (frontend)

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (required) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key (required) |
| `VITE_APP_URL` | Production site URL for share links |

Set in: Vercel → Project → Settings → Environment Variables (Production, Preview, Development).

### Supabase (backend)

| Secret | Used by | Purpose |
|--------|---------|---------|
| `TICKETMASTER_API_KEY` | search | Real concert data (mock if missing) |
| `PERPLEXITY_API_KEY` | generate-itinerary | AI itinerary generation (required) |
| `RESEND_API_KEY` | send-share-email | Share emails via Resend |
| `FROM_EMAIL` | send-share-email | Sender email for share emails |

Set in: Supabase Dashboard → Project Settings → Edge Functions → Secrets.

---

## 5. Deploy Frontend

**Option A – Via Git (usual):**

1. Push to your main branch.
2. Vercel auto-deploys from the connected repo.

**Option B – Via CLI:**

```bash
cd <project-root>
npx vercel --prod --yes
```

---

## 6. Deploy Supabase Edge Functions

Supabase config lives under `apps/web`. Deploy from that directory:

```bash
cd apps/web
supabase functions deploy search
supabase functions deploy generate-itinerary
supabase functions deploy send-share-email
supabase functions deploy track-click
```

Or deploy all at once:

```bash
cd apps/web
supabase functions deploy
```

Ensure the Supabase CLI is installed and linked to your project (`supabase link`).

---

## 7. Production Smoke Test

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the production URL | Homepage loads |
| 2 | Go to Experience Builder | Form appears |
| 3 | Enter artist (e.g. Taylor Swift) + city (e.g. Austin) + dates | Search runs |
| 4 | Click Generate My Itinerary | Itinerary generates and redirects to share page |
| 5 | On share page, click “Share” and send email | Email is sent |
| 6 | Click a booking link in the email | Track-click works; partner site opens |

If any step fails, see Section 8.

---

## 8. Troubleshooting

### Search returns no results or errors

- **Check:** Supabase Edge Functions → `search` → Logs (for errors).
- **Likely causes:**
  - `TICKETMASTER_API_KEY` missing or wrong → you’ll get mock data only.
  - Supabase project down or URL wrong → check `VITE_SUPABASE_URL` in Vercel.
- **Fix:** Ensure `TICKETMASTER_API_KEY` is set in Supabase secrets and that `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are correct in Vercel. Redeploy the frontend after changing env vars.

### Itinerary generation fails

- **Check:** Supabase Edge Functions → `generate-itinerary` → Logs.
- **Likely causes:**
  - `PERPLEXITY_API_KEY` missing or invalid.
  - Perplexity API rate limit or outage.
- **Fix:** Confirm `PERPLEXITY_API_KEY` in Supabase Edge Function secrets. If keys are correct, wait and retry or check Perplexity status.

### Share emails not sending

- **Check:** Supabase Edge Functions → `send-share-email` → Logs.
- **Likely causes:**
  - `RESEND_API_KEY` or `FROM_EMAIL` missing or invalid.
  - Resend domain/email not verified.
- **Fix:** Verify Resend API key and domain setup; ensure `FROM_EMAIL` is a verified sender.

### Frontend can’t reach Supabase

- **Symptom:** Search or itinerary never loads; network errors in browser dev tools.
- **Check:** Vercel env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
- **Fix:** Set/update these in Vercel, then redeploy. Env vars are applied at build time.

---

**For more detail:** See `docs/ARCHITECTURE.md` and `docs/SEARCH_EDGE_FUNCTION_SETUP.md`.
