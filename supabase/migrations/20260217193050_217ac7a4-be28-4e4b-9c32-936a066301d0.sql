
-- Add reason and note columns to copilot_feedback for detailed rejection feedback
ALTER TABLE public.copilot_feedback ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.copilot_feedback ADD COLUMN IF NOT EXISTS note text;

NOTIFY pgrst, 'reload schema';
