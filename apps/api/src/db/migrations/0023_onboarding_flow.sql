-- Onboarding & gating flow: Terms of Business acceptance + platform tour state.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS tour_seen_at timestamptz;
