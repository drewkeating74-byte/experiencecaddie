-- Ticketmaster verification audit columns for packages (updated by verify-packages edge function).
--
-- Ops: apply migration, deploy functions/verify-packages, then run the workflow
-- "Verify packages (Ticketmaster)" (workflow_dispatch) or curl POST with service role.
-- Use ?suggest=1 on that function for metro_gaps when planning new curated rows.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS last_ticketmaster_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ticketmaster_last_ok BOOLEAN;

COMMENT ON COLUMN public.packages.last_ticketmaster_check_at IS
  'When verify-packages last ran a Ticketmaster check for this row.';
COMMENT ON COLUMN public.packages.ticketmaster_last_ok IS
  'True if the last check found a matching TM event on the same calendar date; false if not found or date mismatch; null if never checked.';

CREATE INDEX IF NOT EXISTS idx_packages_tm_check_active
  ON public.packages (last_ticketmaster_check_at)
  WHERE active = true;
