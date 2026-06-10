CREATE TABLE IF NOT EXISTS public.instagram_queue (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id            uuid        REFERENCES public.packages(id) ON DELETE SET NULL,
  cta_slide_url         text,
  golf_slide_url        text,
  concert_slide_url     text,
  selected_course_photo text,
  selected_concert_photo text,
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','posted','skipped')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  posted_at             timestamptz
);

CREATE INDEX IF NOT EXISTS idx_instagram_queue_status     ON public.instagram_queue (status);
CREATE INDEX IF NOT EXISTS idx_instagram_queue_package_id ON public.instagram_queue (package_id);
CREATE INDEX IF NOT EXISTS idx_instagram_queue_created_at ON public.instagram_queue (created_at DESC);

ALTER TABLE public.instagram_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.instagram_queue IS
  'Approved Instagram carousel posts awaiting scheduling. Populated by scripts/review-tool.mjs.';
