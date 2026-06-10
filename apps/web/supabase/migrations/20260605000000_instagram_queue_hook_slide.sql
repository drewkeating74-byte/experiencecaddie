ALTER TABLE public.instagram_queue
  ADD COLUMN IF NOT EXISTS hook_slide_url text NULL;

COMMENT ON COLUMN public.instagram_queue.hook_slide_url IS
  'BannerBear URL for the Hook Slide (first slide in the 4-slide carousel)';
