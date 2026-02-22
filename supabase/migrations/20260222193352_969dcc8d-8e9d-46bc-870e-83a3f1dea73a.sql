
-- Experience path enum
CREATE TYPE public.experience_path AS ENUM ('golf_music', 'sports', 'luxury', 'custom');

-- Budget tier enum
CREATE TYPE public.budget_tier AS ENUM ('low', 'mid', 'high');

-- Itinerary status enum
CREATE TYPE public.itinerary_status AS ENUM ('draft', 'generating', 'generated', 'error');

-- Vendor type enum for click tracking
CREATE TYPE public.vendor_type AS ENUM ('ticket', 'hotel', 'flight', 'golf', 'experience', 'restaurant');

-- Itineraries table
CREATE TABLE public.itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  path experience_path NOT NULL,
  city text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  budget_tier budget_tier NOT NULL DEFAULT 'mid',
  group_size integer NOT NULL DEFAULT 2,
  preferences jsonb DEFAULT '{}',
  event_details text,
  prompt_version text DEFAULT 'v1',
  result_json jsonb,
  share_slug text UNIQUE,
  email text,
  status itinerary_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Click events table
CREATE TABLE public.click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id uuid REFERENCES public.itineraries(id) ON DELETE CASCADE NOT NULL,
  package_tier text NOT NULL,
  vendor vendor_type NOT NULL,
  label text,
  target_url text NOT NULL,
  user_agent text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.click_events ENABLE ROW LEVEL SECURITY;

-- Itinerary policies
CREATE POLICY "Users read own itineraries"
  ON public.itineraries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Public read shared itineraries"
  ON public.itineraries FOR SELECT
  USING (share_slug IS NOT NULL);

CREATE POLICY "Anyone can create itineraries"
  ON public.itineraries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users update own itineraries"
  ON public.itineraries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admin manage itineraries"
  ON public.itineraries FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Click events policies (public insert for tracking, admin read)
CREATE POLICY "Anyone can insert click events"
  ON public.click_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admin read click events"
  ON public.click_events FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read own click events"
  ON public.click_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.itineraries
      WHERE itineraries.id = click_events.itinerary_id
      AND itineraries.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_itineraries_user_id ON public.itineraries(user_id);
CREATE INDEX idx_itineraries_share_slug ON public.itineraries(share_slug);
CREATE INDEX idx_itineraries_status ON public.itineraries(status);
CREATE INDEX idx_click_events_itinerary_id ON public.click_events(itinerary_id);

-- Triggers for updated_at
CREATE TRIGGER update_itineraries_updated_at
  BEFORE UPDATE ON public.itineraries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
