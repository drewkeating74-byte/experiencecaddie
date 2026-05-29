-- Add two additional photo slots to golf_courses for the Google Places
-- photo backfill (primary image_url already exists). Columns are nullable;
-- Postgres appends them at the end of the table (ordinal position is cosmetic).

ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS image_url_2 text NULL,
  ADD COLUMN IF NOT EXISTS image_url_3 text NULL;
