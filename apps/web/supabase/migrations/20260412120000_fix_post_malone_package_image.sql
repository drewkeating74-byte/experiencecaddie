-- Replace Post Malone package hero image (previous desert golf asset failed to load for some clients).
UPDATE public.packages
SET image_url = 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&h=500&fit=crop&q=80'
WHERE id = 'f3ec0001-0000-0000-0000-000000000003';
