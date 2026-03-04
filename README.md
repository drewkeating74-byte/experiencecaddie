# Experience Caddie

Experience Caddie is a curated travel platform that packages golf + live events (concerts, sports) into seamless, bookable weekend experiences.

## 🎯 Vision

Tee Off. Rock Out. Plan Less. Experience More.

We help men 30–60 discover unforgettable golf + event weekends by intelligently pairing:

- 🎵 Concerts & Live Music
- 🏟 Sporting Events
- ⛳ Public Golf Courses
- 🏨 Accommodations

## 🧱 Current Status

MVP Phase:
- Front-end built in Lovable
- GitHub repository initialized
- Backend/API development starting

## 🛠 Tech Stack

- Frontend: (Lovable export — likely React/Next.js)
- Backend: Node.js (planned)
- Version Control: GitHub
- Development Environment: Cursor

## 🚀 Running Locally

(TBD — will update once backend is scaffolded)

## ⚡ Supabase Edge Function (Concert Discovery & Itinerary)

The `generate-itinerary` edge function powers concert discovery and itinerary generation. **Deploy it separately** from the frontend:

```bash
cd apps/web
supabase functions deploy generate-itinerary
```

Set the secret in Supabase Dashboard → Project Settings → Edge Functions → Secrets:
- `PERPLEXITY_API_KEY` — required for concert search and itinerary AI

## 📍 Roadmap

- [ ] Build search API
- [ ] Integrate concert data source
- [ ] Match events with nearby golf courses
- [ ] Create dynamic itinerary packaging logic
- [ ] Explore partner integrations & monetization

---

Founder: Drew