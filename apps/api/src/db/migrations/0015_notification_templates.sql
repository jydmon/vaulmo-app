-- Notification templates (email / push / in-app), admin-managed.
CREATE TABLE IF NOT EXISTS notification_templates (
  key text PRIMARY KEY,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  category text NOT NULL DEFAULT 'system',
  subject text,
  body text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
