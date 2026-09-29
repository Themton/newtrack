-- Run before deploying the shop carrier selector. Existing shops remain Flash.
ALTER TABLE public.fx_shops
  ADD COLUMN IF NOT EXISTS carrier TEXT NOT NULL DEFAULT 'flash'
  CHECK (carrier IN ('flash', 'jnt'));
