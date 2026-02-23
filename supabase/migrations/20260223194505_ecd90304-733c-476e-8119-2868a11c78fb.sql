
-- Add user_comment column to books table
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS user_comment text DEFAULT NULL;

-- Add description column to copilot_recommendations for synopsis caching  
ALTER TABLE public.copilot_recommendations ADD COLUMN IF NOT EXISTS description text DEFAULT NULL;
