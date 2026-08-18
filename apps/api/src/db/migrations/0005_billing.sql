-- Phase 6: Subscriptions & Stripe billing.

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  amount integer NOT NULL DEFAULT 0,          -- annual price in minor units (pence)
  currency text NOT NULL DEFAULT 'gbp',
  interval text NOT NULL DEFAULT 'year',
  stripe_product_id text,
  stripe_price_id text,
  entitlements jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 100
);

-- One subscription record per tenant (the customer account).
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_key text,
  status text NOT NULL DEFAULT 'none',         -- none|trialing|active|past_due|canceled|incomplete
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  grace_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Webhook idempotency: each Stripe event is processed at most once.
CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_invoice_id text,
  amount integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'gbp',
  status text NOT NULL DEFAULT 'open',          -- open|paid|failed
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices(tenant_id, created_at);
