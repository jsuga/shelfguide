alter table public.copilot_preferences
  add column if not exists atmosphere text default 'cozy';

update public.copilot_preferences
set atmosphere = coalesce(nullif(btrim(atmosphere), ''), 'cozy');
