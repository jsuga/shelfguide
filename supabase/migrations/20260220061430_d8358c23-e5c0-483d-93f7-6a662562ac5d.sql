
-- Add rotation_state JSONB to copilot_preferences for cursor-based recommendation rotation
ALTER TABLE public.copilot_preferences
ADD COLUMN IF NOT EXISTS rotation_state jsonb DEFAULT '{}'::jsonb;
