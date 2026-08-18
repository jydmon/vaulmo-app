-- Phase 11 (Trips) + Phase 12 (Purchases & Warranties) + Phase 13 (Subscription tracking)

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  destination text,
  start_date text,
  end_date text,
  status text NOT NULL DEFAULT 'upcoming',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trips_tenant_idx ON trips(tenant_id);

CREATE TABLE IF NOT EXISTS trip_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,                 -- flight | hotel | train | ticket | car_rental
  details jsonb NOT NULL DEFAULT '{}',
  start_date text,
  end_date text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_items_trip_idx ON trip_items(trip_id);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  merchant text,
  item text NOT NULL,
  amount text,
  purchase_date text,
  category text,
  is_asset boolean NOT NULL DEFAULT false,
  warranty_expiry text,
  receipt_file_id uuid REFERENCES file_objects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_tenant_idx ON purchases(tenant_id);

CREATE TABLE IF NOT EXISTS tracked_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  amount text,
  cycle text NOT NULL DEFAULT 'monthly',
  renewal_date text,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracked_subs_tenant_idx ON tracked_subscriptions(tenant_id);
