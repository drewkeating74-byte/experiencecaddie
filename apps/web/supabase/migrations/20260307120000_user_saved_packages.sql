-- Per-package saves (user can save individual Bronze/Silver/Gold tiers)
CREATE TABLE IF NOT EXISTS public.user_saved_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  itinerary_id UUID NOT NULL REFERENCES public.itineraries(id) ON DELETE CASCADE,
  package_tier TEXT NOT NULL CHECK (package_tier IN ('BRONZE', 'SILVER', 'GOLD')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, itinerary_id, package_tier)
);

ALTER TABLE public.user_saved_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own saved packages" ON public.user_saved_packages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own saved packages" ON public.user_saved_packages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own saved packages" ON public.user_saved_packages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_user_saved_packages_user_id ON public.user_saved_packages(user_id);
CREATE INDEX idx_user_saved_packages_itinerary ON public.user_saved_packages(itinerary_id);
