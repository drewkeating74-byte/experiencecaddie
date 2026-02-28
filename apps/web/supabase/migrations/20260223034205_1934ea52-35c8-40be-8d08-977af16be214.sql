-- Add INSERT policy for profiles table as defense-in-depth
CREATE POLICY "Users create own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);