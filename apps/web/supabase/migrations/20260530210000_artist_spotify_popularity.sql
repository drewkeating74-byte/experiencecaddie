-- Spotify popularity enrichment for artists. These columns feed the Packages
-- page "top artists / high-demand" ranking and are available for the marketing
-- agent to pick top upcoming shows. All nullable + additive — no effect on the
-- package lifecycle or existing rows.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS spotify_id text NULL,
  ADD COLUMN IF NOT EXISTS spotify_popularity integer NULL,
  ADD COLUMN IF NOT EXISTS spotify_followers bigint NULL,
  ADD COLUMN IF NOT EXISTS spotify_synced_at timestamptz NULL;
