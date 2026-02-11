alter table public.copilot_preferences
  add column if not exists ui_theme text;

alter table public.copilot_preferences
  add constraint copilot_preferences_ui_theme_check
  check (ui_theme is null or ui_theme in ('default', 'fantasy', 'scifi', 'history', 'romance', 'thriller'));
