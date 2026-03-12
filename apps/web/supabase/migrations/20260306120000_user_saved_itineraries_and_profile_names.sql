-- User saved itineraries (saved trips)
CREATE TABLE IF NOT EXISTS public.user_saved_itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  itinerary_id UUID NOT NULL REFERENCES public.itineraries(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, itinerary_id)
);

ALTER TABLE public.user_saved_itineraries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own saved itineraries" ON public.user_saved_itineraries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own saved itineraries" ON public.user_saved_itineraries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own saved itineraries" ON public.user_saved_itineraries
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_user_saved_itineraries_user_id ON public.user_saved_itineraries(user_id);

-- Update handle_new_user to capture first_name, last_name from signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 1)),
    COALESCE(NEW.raw_user_meta_data->>'last_name', NULLIF(trim(substring(COALESCE(NEW.raw_user_meta_data->>'full_name', '') from position(' ' in COALESCE(NEW.raw_user_meta_data->>'full_name', '') || ' ') for 100)), ''))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
