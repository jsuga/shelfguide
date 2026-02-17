
-- ============================================================
-- ShelfGuide: Create all missing tables
-- ============================================================

-- 1. BOOKS
CREATE TABLE public.books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  genre TEXT DEFAULT '',
  series_name TEXT,
  is_first_in_series BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'tbr',
  isbn TEXT,
  isbn13 TEXT,
  goodreads_book_id TEXT,
  default_library_id INTEGER,
  published_year INTEGER,
  rating INTEGER,
  date_read TEXT,
  shelf TEXT,
  description TEXT,
  page_count INTEGER,
  thumbnail TEXT,
  cover_url TEXT,
  cover_storage_path TEXT,
  cover_cached_at TIMESTAMPTZ,
  cover_cache_status TEXT,
  cover_cache_error TEXT,
  cover_source TEXT,
  cover_failed_at TIMESTAMPTZ,
  source TEXT,
  dedupe_key TEXT GENERATED ALWAYS AS (
    CASE
      WHEN COALESCE(TRIM(isbn13), '') <> '' THEN 'isbn13:' || LOWER(TRIM(isbn13))
      WHEN COALESCE(TRIM(isbn), '') <> '' THEN 'isbn10:' || LOWER(TRIM(isbn))
      WHEN COALESCE(TRIM(goodreads_book_id), '') <> '' THEN 'gr:' || LOWER(TRIM(goodreads_book_id))
      WHEN default_library_id IS NOT NULL THEN 'default:' || default_library_id::TEXT
      ELSE 'title_author_year:' || LOWER(TRIM(title)) || '|' || LOWER(TRIM(author)) || '|' || COALESCE(published_year::TEXT, 'unknown')
    END
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX books_user_dedupe ON public.books (user_id, dedupe_key);
CREATE INDEX books_user_id_idx ON public.books (user_id);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own books"
  ON public.books FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own books"
  ON public.books FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own books"
  ON public.books FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own books"
  ON public.books FOR DELETE
  USING (auth.uid() = user_id);

-- Service role needs full access for edge functions
CREATE POLICY "Service role full access on books"
  ON public.books FOR ALL
  USING (auth.role() = 'service_role');

-- 2. PROFILES
CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Public profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (is_public = true);

-- 3. COPILOT_PREFERENCES
CREATE TABLE public.copilot_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  preferred_genres TEXT[] DEFAULT '{}',
  avoided_genres TEXT[] DEFAULT '{}',
  preferred_formats TEXT[] DEFAULT '{}',
  preferred_pace TEXT,
  notes TEXT,
  ui_theme TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.copilot_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own preferences"
  ON public.copilot_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own preferences"
  ON public.copilot_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences"
  ON public.copilot_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- 4. COPILOT_FEEDBACK
CREATE TABLE public.copilot_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  book_id TEXT,
  title TEXT NOT NULL,
  author TEXT,
  genre TEXT,
  tags TEXT[] DEFAULT '{}',
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX copilot_feedback_user_idx ON public.copilot_feedback (user_id);

ALTER TABLE public.copilot_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own feedback"
  ON public.copilot_feedback FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own feedback"
  ON public.copilot_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own feedback"
  ON public.copilot_feedback FOR DELETE
  USING (auth.uid() = user_id);

-- 5. COPILOT_RECOMMENDATIONS
CREATE TABLE public.copilot_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  book_id TEXT,
  title TEXT NOT NULL,
  author TEXT,
  genre TEXT,
  tags TEXT[] DEFAULT '{}',
  summary TEXT,
  source TEXT,
  reasons TEXT[] DEFAULT '{}',
  why_new TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX copilot_recs_user_idx ON public.copilot_recommendations (user_id);

ALTER TABLE public.copilot_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own recommendations"
  ON public.copilot_recommendations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own recommendations"
  ON public.copilot_recommendations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recommendations"
  ON public.copilot_recommendations FOR DELETE
  USING (auth.uid() = user_id);

-- Service role for edge function inserts
CREATE POLICY "Service role full access on copilot_recommendations"
  ON public.copilot_recommendations FOR ALL
  USING (auth.role() = 'service_role');

-- 6. COPILOT_RATE_LIMITS
CREATE TABLE public.copilot_rate_limits (
  key TEXT PRIMARY KEY,
  user_id UUID,
  ip TEXT,
  window_start TIMESTAMPTZ DEFAULT now(),
  count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.copilot_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own rate limits"
  ON public.copilot_rate_limits FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on rate limits"
  ON public.copilot_rate_limits FOR ALL
  USING (auth.role() = 'service_role');

-- 7. IMPORT_LOGS (referenced in delete library)
CREATE TABLE public.import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  file_name TEXT,
  row_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own import logs"
  ON public.import_logs FOR ALL
  USING (auth.uid() = user_id);

-- 8. STORAGE BUCKET for book covers
INSERT INTO storage.buckets (id, name, public)
VALUES ('book-covers', 'book-covers', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access for book covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'book-covers');

CREATE POLICY "Users can upload their own covers"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'book-covers' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own covers"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'book-covers' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role full access on book-covers storage"
  ON storage.objects FOR ALL
  USING (bucket_id = 'book-covers' AND (select auth.role()) = 'service_role');

-- 9. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_books_updated_at
  BEFORE UPDATE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_copilot_preferences_updated_at
  BEFORE UPDATE ON public.copilot_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10. Schema reload notification
NOTIFY pgrst, 'reload schema';
