-- Replace the ALL admin policy with operation-specific ones that only target authenticated
DROP POLICY "Admin manage itineraries" ON public.itineraries;

CREATE POLICY "Admin select itineraries" ON public.itineraries
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin insert itineraries" ON public.itineraries
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin update itineraries" ON public.itineraries
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin delete itineraries" ON public.itineraries
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
