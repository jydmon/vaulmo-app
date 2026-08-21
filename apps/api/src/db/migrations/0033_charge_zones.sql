-- UK & Western driving-charge zones (ULEZ / Clean Air Zones / congestion charges / low-
-- emission zones / tolls) for the mobile geolocation alerts, plus a log of alerts shown.
CREATE TABLE IF NOT EXISTS charge_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  country text NOT NULL DEFAULT 'GB',
  type text NOT NULL,                        -- ulez | caz | lez | congestion | toll
  lat real NOT NULL,
  lng real NOT NULL,
  radius_m integer NOT NULL,                  -- circular geofence radius (approx.)
  amount integer NOT NULL DEFAULT 0,          -- charge in minor units (pence/cents)
  currency text NOT NULL DEFAULT 'GBP',
  unit text NOT NULL DEFAULT 'day',           -- day | trip
  compliant_free boolean NOT NULL DEFAULT false, -- emission-compliant vehicles pay nothing
  hours text,                                 -- human-readable operating hours
  info_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charge_zones_active_idx ON charge_zones (active);

CREATE TABLE IF NOT EXISTS zone_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  zone_key text NOT NULL,
  zone_name text NOT NULL,
  vehicle_label text,
  amount integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zone_alerts_user_idx ON zone_alerts (user_id, at DESC);
