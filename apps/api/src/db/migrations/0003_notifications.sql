-- Phase 4: Notifications & Reminder Engine

-- Reminder scheduling/escalation/snooze fields.
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS lead_days integer[] NOT NULL DEFAULT '{30,7,1,0}';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

-- Per-user channel preferences.
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT true
);

-- Registered push devices.
CREATE TABLE IF NOT EXISTS device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL,           -- ios | android | web
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

-- Notifications — the record of every in-app/email/push delivery (also the email/push outbox in dev).
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel text NOT NULL,            -- in_app | email | push
  category text NOT NULL,           -- reminder | missing_document | system
  title text NOT NULL,
  body text NOT NULL,
  reminder_id uuid REFERENCES reminders(id) ON DELETE SET NULL,
  dedupe_key text,
  status text NOT NULL DEFAULT 'sent', -- sent | read | failed
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at);
-- Prevent duplicate sends for the same (recipient, channel, dedupe_key).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications(user_id, channel, dedupe_key) WHERE dedupe_key IS NOT NULL;
