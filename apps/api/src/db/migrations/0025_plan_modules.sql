-- Plan management: per-plan feature modules + a discount on the price.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_label text;
