-- Adds brightness scoring and best-image selection columns to golf_courses.
-- Populated by scripts/score-golf-images.mjs.
ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS image_brightness_score float  NULL,
  ADD COLUMN IF NOT EXISTS marketing_image_url    text   NULL;

COMMENT ON COLUMN public.golf_courses.image_brightness_score IS
  'Average pixel brightness of the chosen marketing image, 0 (black) – 100 (white). Null = not yet scored.';
COMMENT ON COLUMN public.golf_courses.marketing_image_url IS
  'The darkest (lowest brightness_score) of image_url / image_url_2 / image_url_3, chosen for Instagram carousel use.';
