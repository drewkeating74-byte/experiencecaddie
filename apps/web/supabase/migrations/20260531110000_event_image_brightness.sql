-- Adds brightness score to events so Ticketmaster press-photo images can be
-- flagged and skipped in favour of a dark placeholder.
-- Populated by scripts/score-event-images.mjs.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS image_brightness_score float NULL;

COMMENT ON COLUMN public.events.image_brightness_score IS
  'Average pixel brightness of image_url, 0 (black) – 100 (white). Values > 70 indicate likely press headshot on white/grey background. Null = not yet scored.';
