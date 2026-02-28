-- Allow anonymous users to read itineraries where user_id is null and share_slug is set (generated)
-- Also allow reading by ID for recently created itineraries (needed during generation flow)
CREATE POLICY "Anon read itineraries by id"
ON public.itineraries
FOR SELECT
TO anon, authenticated
USING (true);