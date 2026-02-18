
-- Add google_volume_id column to books table
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS google_volume_id text;

-- Add unique constraint per user where google_volume_id is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_user_google_volume_id
  ON public.books (user_id, google_volume_id)
  WHERE google_volume_id IS NOT NULL;
