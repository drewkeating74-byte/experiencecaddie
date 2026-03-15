# Google Login Audit – Experience Caddie

Plain-English checklist to fix Google Sign-In. Compare what the code expects vs. what must be set in Supabase and Google Cloud.

---

## Code Findings

### Auth flow (no custom callback)

The app does **not** use `/auth/callback`. Supabase handles the OAuth callback on its own domain. Flow:

1. User visits `/auth` (or `/auth?redirect=/itinerary/xyz`)
2. User clicks "Continue with Google"
3. App calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "..." } })`
4. User is sent to Google → signs in → Google sends user to **Supabase** at `https://<project-ref>.supabase.co/auth/v1/callback`
5. Supabase processes the callback, then redirects the user to the `redirectTo` URL (your app) with tokens in the URL hash
6. Supabase JS client reads the hash and restores the session

### Exact redirect path used by the app

| Scenario | redirectTo value |
|----------|------------------|
| Sign in from auth page (no query) | `{origin}/` e.g. `https://experiencecaddie.vercel.app/` |
| Sign in with redirect param | `{origin}{redirect}` e.g. `https://experiencecaddie.vercel.app/itinerary/abc123` |
| Possible paths | `/`, `/itinerary/:id`, `/share/:slug`, `/bookings`, etc. |

**Code location:** `apps/web/src/pages/Auth.tsx` line 69:

```ts
redirectTo: `${window.location.origin}${redirect}`
```

- `window.location.origin` = e.g. `https://experiencecaddie.vercel.app` (no trailing slash)
- `redirect` = `/` or `/itinerary/xyz` (always starts with `/` after our fix)

**Examples of redirectTo values:**
- `https://experiencecaddie.vercel.app/`
- `https://experiencecaddie.vercel.app/itinerary/abc123`
- `https://experiencecaddie.vercel.app/share/my-slug`
- `https://experiencecaddie.vercel.app/bookings`

### Does `/auth/callback` exist?

**No.** There is no app route for `/auth/callback`. The Supabase callback lives at:

```
https://kxibaydbhquospzoefva.supabase.co/auth/v1/callback
```

That URL is used by **Google** to redirect to Supabase, not by your app. You do not need to create `/auth/callback` in the app.

### Supabase project reference

From deployments: **kxibaydbhquospzoefva**

Supabase Auth callback URL (for Google Cloud):  
`https://kxibaydbhquospzoefva.supabase.co/auth/v1/callback`

---

## Supabase settings to verify

Go to: [Supabase Dashboard](https://supabase.com/dashboard/project/kxibaydbhquospzoefva) → **Authentication** → **URL Configuration**.

| Setting | What to set | Why |
|--------|-------------|-----|
| **Site URL** | `https://experiencecaddie.vercel.app` (or your production domain) | Default redirect when no `redirectTo` is passed; must match where the app runs |
| **Redirect URLs** | Add these (replace domain if you use a custom one): | Every `redirectTo` value the app can send must be in this list (or matched by a wildcard) |
| | `https://experiencecaddie.vercel.app` | |
| | `https://experiencecaddie.vercel.app/` | |
| | `https://experiencecaddie.vercel.app/**` | Covers all paths like `/itinerary/xyz`, `/share/slug`, `/bookings` |
| | `http://localhost:5173` | For local dev (optional) |
| | `http://localhost:5173/**` | For local dev paths (optional) |

If you use a custom domain (e.g. `https://experiencecaddie.com`), add those variants too.

---

## Google Cloud settings to verify

Go to: [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → your **OAuth 2.0 Client ID** (Web application).

### Authorized JavaScript origins

These are the origins where your app runs. Google checks that the sign-in request comes from one of these.

| Origin | When |
|--------|------|
| `https://experiencecaddie.vercel.app` | Production |
| `https://your-custom-domain.com` | If you use a custom domain |
| `http://localhost:5173` | Local dev |

Use `https` for production; no trailing slash; no path.

### Authorized redirect URIs

This must be **exactly** the Supabase Auth callback URL. Google sends the user here after sign-in.

| Redirect URI | Notes |
|--------------|-------|
| `https://kxibaydbhquospzoefva.supabase.co/auth/v1/callback` | Must match Supabase project |

Do not add your app URL here. The redirect URI is Supabase’s callback, not your site.

You can copy this from: Supabase Dashboard → **Authentication** → **Providers** → **Google** → “Callback URL (for OAuth)”.

---

## Google provider in Supabase

Supabase Dashboard → **Authentication** → **Providers** → **Google**.

| Setting | What to set |
|---------|-------------|
| **Enable Sign in with Google** | ON |
| **Client ID** | From Google Cloud (Web application client ID) |
| **Client Secret** | From Google Cloud (same client) |

---

## Most likely reason login is failing

**1. Redirect URL mismatch in Supabase (most common)**

Supabase’s **Redirect URLs** list is too strict. If `redirectTo` is e.g. `https://experiencecaddie.vercel.app/itinerary/abc123` and that URL (or a pattern that matches it) is not allowed, Supabase will refuse and you may see an error or blank redirect.

**Fix:** Add `https://experiencecaddie.vercel.app/**` to Redirect URLs in Supabase.

---

**2. Wrong redirect URI in Google Cloud**

If the **Authorized redirect URIs** in Google Cloud is wrong, Google will show “redirect_uri_mismatch” or similar.

**Fix:** Set it to exactly:

`https://kxibaydbhquospzoefva.supabase.co/auth/v1/callback`

---

**3. Wrong Authorized JavaScript origins in Google Cloud**

If your production origin is missing, Google may block the sign-in request.

**Fix:** Add `https://experiencecaddie.vercel.app` (no trailing slash, no path) to Authorized JavaScript origins.

---

**4. Google provider disabled or misconfigured in Supabase**

If the provider is off or Client ID/Secret are wrong, Supabase cannot complete OAuth.

**Fix:** Enable Google, and paste the correct Client ID and Client Secret from Google Cloud.

---

## Quick checklist

- [ ] Supabase → URL Configuration → Site URL = production domain
- [ ] Supabase → URL Configuration → Redirect URLs includes `https://experiencecaddie.vercel.app/**`
- [ ] Supabase → Providers → Google → Enabled, Client ID and Secret set
- [ ] Google Cloud → OAuth client → Authorized JavaScript origins includes `https://experiencecaddie.vercel.app`
- [ ] Google Cloud → OAuth client → Authorized redirect URIs = `https://kxibaydbhquospzoefva.supabase.co/auth/v1/callback`

---

## Concert link “Page not found”

The Ticketmaster URL format is `https://www.ticketmaster.com/event/{eventId}`. A 404 can mean:

1. **Event ID from Discovery API** – The ID may be different from the one used in public URLs. If so, we may need to use `event.url` from the API again, or a different URL format.
2. **Event no longer available** – The event may have been removed or changed.
3. **Different domain** – Some regions use `ticketmaster.com` vs `ticketmaster.co.uk` etc.; a region-specific base URL might be needed.

If 404s persist, we should log a sample event response (including `event.id` and `event.url`) and compare with a known working Ticketmaster event URL.
