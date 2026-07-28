-- Social post usage tracking for carousel, Group Chat, and Excuse templates.
-- Populated by scripts/review-tool.mjs (and schedule-*-post scripts) on approve.

CREATE TABLE IF NOT EXISTS public.social_post_usage (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type   text        NOT NULL
                              CHECK (template_type IN ('carousel', 'group_chat', 'excuse')),
  variant_key     text        NOT NULL,
  label           text,
  image_url       text,
  caption         text,
  buffer_post_id  text,
  used_at         timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_social_post_usage_type_key
  ON public.social_post_usage (template_type, variant_key);

CREATE INDEX IF NOT EXISTS idx_social_post_usage_type_used
  ON public.social_post_usage (template_type, used_at DESC);

ALTER TABLE public.social_post_usage ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.social_post_usage IS
  'Tracks approved social posts by template type so the review tool can flag previously used variants.';

-- Backfill carousel usage from existing instagram_queue rows.
INSERT INTO public.social_post_usage (
  template_type,
  variant_key,
  label,
  image_url,
  used_at,
  metadata
)
SELECT
  'carousel',
  iq.package_id::text,
  coalesce(a.name || ' · ' || gc.name, iq.package_id::text),
  iq.hook_slide_url,
  coalesce(iq.posted_at, iq.created_at),
  jsonb_build_object(
    'source', 'instagram_queue_backfill',
    'queue_status', iq.status,
    'package_id', iq.package_id
  )
FROM public.instagram_queue iq
LEFT JOIN public.packages p ON p.id = iq.package_id
LEFT JOIN public.events e ON e.id = p.event_id
LEFT JOIN public.artists a ON a.id = e.artist_id
LEFT JOIN public.golf_courses gc ON gc.id = p.golf_course_id
WHERE iq.package_id IS NOT NULL
  AND iq.status IN ('scheduled', 'posted', 'pending')
  AND NOT EXISTS (
    SELECT 1
    FROM public.social_post_usage u
    WHERE u.template_type = 'carousel'
      AND u.variant_key = iq.package_id::text
      AND u.used_at = coalesce(iq.posted_at, iq.created_at)
  );
