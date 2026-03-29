-- Trip window for operator clarity (optional). Event date remains on `events`.
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS package_start_date date,
  ADD COLUMN IF NOT EXISTS package_end_date date;
