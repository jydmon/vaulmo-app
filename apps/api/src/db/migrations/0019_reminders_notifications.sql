-- Reminders & Notifications user-phase: custom + recurring reminders, explicit
-- completion, and quiet hours.

-- New reminder lifecycle state (safe on PG12+: added, not used, in this tx).
ALTER TYPE reminder_status ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Quiet hours: integer hours 0–23 (inclusive start, exclusive end). NULL = disabled.
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS quiet_start integer,
  ADD COLUMN IF NOT EXISTS quiet_end integer;
