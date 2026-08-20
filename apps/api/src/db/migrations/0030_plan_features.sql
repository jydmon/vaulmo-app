-- Per-plan marketing feature bullets (shown verbatim on the public Plans page), plus
-- the Premium→Family consolidation: Premium is retired and Family becomes all-inclusive.

-- Editable marketing feature list for each plan. Empty = derive from the plan's modules.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Retire the Premium plan: hide it from customers (kept, not deleted, to preserve history).
UPDATE plans SET active = false WHERE key = 'premium';

-- Family becomes the single paid tier and includes everything (incl. Connected Services).
UPDATE plans
   SET entitlements = jsonb_set(coalesce(entitlements, '{}'::jsonb), '{connectedServices}', 'true'::jsonb),
       modules = '["vault","reminders","assistant","life","assets","family","integrations","passwords"]'::jsonb
 WHERE key = 'family';

-- Seed marketing feature bullets for the standard plans (only if not already customised).
UPDATE plans SET features = '[
  "Secure document vault (up to 50 documents)",
  "Smart scanning & automatic filing",
  "Renewal & expiry reminders",
  "Bank-level encryption & two-factor login",
  "1 household member"
]'::jsonb WHERE key = 'starter' AND (features = '[]'::jsonb OR features IS NULL);

UPDATE plans SET features = '[
  "Everything in Starter",
  "Unlimited documents",
  "Up to 6 household members",
  "AI Assistant — ask questions across your vault",
  "Password vault (encrypted)",
  "Connected Services — automatic email import",
  "Family & emergency access",
  "Priority support"
]'::jsonb WHERE key = 'family' AND (features = '[]'::jsonb OR features IS NULL);
