-- Expands golf course photo storage from 3 to 10 slots.
-- Slots 4–10 are populated by scripts/expand-golf-photos.mjs for courses
-- that have active packages with upcoming events (the Instagram-relevant set).
ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS image_url_4  text NULL,
  ADD COLUMN IF NOT EXISTS image_url_5  text NULL,
  ADD COLUMN IF NOT EXISTS image_url_6  text NULL,
  ADD COLUMN IF NOT EXISTS image_url_7  text NULL,
  ADD COLUMN IF NOT EXISTS image_url_8  text NULL,
  ADD COLUMN IF NOT EXISTS image_url_9  text NULL,
  ADD COLUMN IF NOT EXISTS image_url_10 text NULL;

COMMENT ON COLUMN public.golf_courses.image_url_4  IS 'Google Places photo slot 4 of 10. Populated by expand-golf-photos.mjs for active-package courses.';
COMMENT ON COLUMN public.golf_courses.image_url_5  IS 'Google Places photo slot 5 of 10.';
COMMENT ON COLUMN public.golf_courses.image_url_6  IS 'Google Places photo slot 6 of 10.';
COMMENT ON COLUMN public.golf_courses.image_url_7  IS 'Google Places photo slot 7 of 10.';
COMMENT ON COLUMN public.golf_courses.image_url_8  IS 'Google Places photo slot 8 of 10.';
COMMENT ON COLUMN public.golf_courses.image_url_9  IS 'Google Places photo slot 9 of 10.';
COMMENT ON COLUMN public.golf_courses.image_url_10 IS 'Google Places photo slot 10 of 10.';
