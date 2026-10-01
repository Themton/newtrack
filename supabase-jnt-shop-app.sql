-- Save which J&T application belongs to each shop. No API secrets are stored here.
ALTER TABLE public.fx_shops ADD COLUMN IF NOT EXISTS jt_app text;
NOTIFY pgrst, 'reload schema';
