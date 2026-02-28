
-- Drop the restrictive insert policy and recreate as permissive
DROP POLICY "Anyone can create itineraries" ON public.itineraries;

CREATE POLICY "Anyone can create itineraries"
  ON public.itineraries
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
