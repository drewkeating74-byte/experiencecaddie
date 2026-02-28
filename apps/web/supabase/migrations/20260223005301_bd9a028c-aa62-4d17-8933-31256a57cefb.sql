-- Fix: Change the insert policy to PERMISSIVE so anonymous/unauthenticated users can create itineraries
DROP POLICY "Anyone can create itineraries" ON public.itineraries;

CREATE POLICY "Anyone can create itineraries"
ON public.itineraries
FOR INSERT
TO anon, authenticated
WITH CHECK (true);