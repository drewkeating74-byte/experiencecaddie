-- Drop the overly permissive "Anon read itineraries by id" policy
-- The "Public read shared itineraries" policy (share_slug IS NOT NULL) provides safe anonymous access
DROP POLICY IF EXISTS "Anon read itineraries by id" ON public.itineraries;