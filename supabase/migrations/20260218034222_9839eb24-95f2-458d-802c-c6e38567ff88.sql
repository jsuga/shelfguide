
-- Allow anyone to read books for users who have a public profile
CREATE POLICY "Public users books are viewable by everyone"
ON public.books
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = books.user_id
      AND profiles.is_public = true
  )
);
