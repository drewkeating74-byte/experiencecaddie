# Search Edge Function – Setup

The `search` Edge Function provides Ticketmaster event search plus mock golf and hotel data.

## Deploy

From the project root (with Supabase CLI linked to your project):

```bash
cd apps/web && supabase functions deploy search
```

Or deploy all functions:

```bash
cd apps/web && supabase functions deploy
```

## Supabase secrets

Add in **Supabase Dashboard** → **Project Settings** → **Edge Functions** → **Secrets**:

| Secret | Required | Purpose |
|--------|----------|---------|
| `TICKETMASTER_API_KEY` | For real concert data | Ticketmaster Discovery API key |
| `TICKETMASTER_CONSUMER_KEY` | Alternative to above | Same as `TICKETMASTER_API_KEY` |

If neither is set, the function returns mock events.

**Via CLI:**

```bash
supabase secrets set TICKETMASTER_API_KEY=your_key_here
```

## Frontend

The frontend calls `{VITE_SUPABASE_URL}/functions/v1/search` when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set in Vercel (or local `.env`).
