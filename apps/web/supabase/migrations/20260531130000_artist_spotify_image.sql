-- Stores the Spotify artist image URL for use in BannerBear marketing posts.
-- Populated by scripts/backfill-spotify-images.mjs.
ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS spotify_image_url text NULL;

COMMENT ON COLUMN public.artists.spotify_image_url IS
  'Largest Spotify artist image (typically 640×640+). Preferred over artists.image_url and events.image_url for Instagram carousel concert slides.';
