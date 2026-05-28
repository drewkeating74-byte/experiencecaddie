-- Expand course_type CHECK to include non-playable-course classifications
-- introduced by the agent verification passes (batch 1 and batch 2).
-- New values: simulator, driving_range, mini_golf, not_golf

ALTER TABLE public.golf_courses
  DROP CONSTRAINT golf_courses_course_type_check;

ALTER TABLE public.golf_courses
  ADD CONSTRAINT golf_courses_course_type_check CHECK (
    course_type IS NULL OR course_type = ANY (ARRAY[
      'public',
      'semi_private',
      'resort',
      'municipal',
      'private',
      'military',
      'unknown',
      'simulator',
      'driving_range',
      'mini_golf',
      'not_golf'
    ])
  );
