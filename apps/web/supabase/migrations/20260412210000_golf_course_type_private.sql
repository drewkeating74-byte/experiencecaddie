-- Add 'private' to the course_type check constraint on golf_courses.
--
-- The automatic verifier (verify-golf-courses function) and the admin
-- dashboard (Task 3) need to store and display 'private' as a distinct
-- access type so private or likely-private courses are immediately
-- visible at a glance in the review queue.
--
-- Current allowed values: 'public','semi_private','resort','municipal','unknown'
-- New allowed values:      adds 'private'

ALTER TABLE public.golf_courses
  DROP CONSTRAINT IF EXISTS golf_courses_course_type_check;

ALTER TABLE public.golf_courses
  ADD CONSTRAINT golf_courses_course_type_check
  CHECK (
    course_type IS NULL
    OR course_type = ANY (
      ARRAY[
        'public'::text,
        'semi_private'::text,
        'resort'::text,
        'municipal'::text,
        'private'::text,
        'unknown'::text
      ]
    )
  );
