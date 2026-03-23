# Golf catalog seed data

## Populating `golf-catalog-phase1a.json`

**Option A: From live search (recommended)**

1. Run the app and search for Phoenix, Nashville, or Austin (artist + city or discover).
2. Open DevTools → Network → find the search request → copy the response JSON.
3. Save to a file, e.g. `search-phoenix.json`.
4. Run: `node scripts/seed-golf-catalog.mjs --from-search search-phoenix.json`

**Option B: Manual JSON**

Add objects with this structure:

```json
{
  "source_id": "ChIJ...",
  "name": "Papago Golf Course",
  "city": "Phoenix",
  "state": "AZ",
  "metro": "Phoenix",
  "canonical_name": "Papago Golf Course",
  "lat": 33.46,
  "lng": -112.0,
  "public_access_confidence": "likely_public",
  "normalized_quality_score": 72,
  "tier_hint": "gold",
  "excluded_reason": null,
  "active": true
}
```

- `source_id`: Google Place ID (required)
- `metro`: "Phoenix" | "Nashville" | "Austin"
- `tier_hint`: "bronze" | "silver" | "gold"
- `excluded_reason`: null for normal courses
