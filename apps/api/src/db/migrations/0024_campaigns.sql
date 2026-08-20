-- CRM: email campaigns + automated communication workflows.
CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  segment text NOT NULL DEFAULT 'all',   -- all | subscribers | prospects | tag
  tag text,                              -- when segment = 'tag'
  status text NOT NULL DEFAULT 'draft',  -- draft | sent
  recipient_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'sent',   -- sent | failed
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx ON campaign_recipients (campaign_id);

-- Automated communication workflows (welcome, renewal, re-engagement, …).
CREATE TABLE IF NOT EXISTS communication_automations (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  trigger text NOT NULL,                 -- signup | renewal_due | inactivity | payment_failed
  enabled boolean NOT NULL DEFAULT false,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
