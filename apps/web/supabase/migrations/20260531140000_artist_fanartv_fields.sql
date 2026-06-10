-- Adds MusicBrainz ID (required by Fanart.tv lookups) and the Fanart.tv
-- cinematic background image URL to artists.
-- Populated by scripts/backfill-fanartv-images.mjs.
ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS musicbrainz_id       text NULL,
  ADD COLUMN IF NOT EXISTS fanartv_background_url text NULL;

COMMENT ON COLUMN public.artists.musicbrainz_id IS
  'MusicBrainz Artist ID (mbid). Required to query Fanart.tv. Resolved via MusicBrainz WS2 search.';

COMMENT ON COLUMN public.artists.fanartv_background_url IS
  'Fanart.tv artistbackground image URL — wide-format live performance photo. '
  'Primary background for Instagram concert slides; fallback to spotify_image_url if NULL.';
