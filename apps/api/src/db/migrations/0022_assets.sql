-- Assets: Properties & Vehicles as first-class records (FAM-03/04/05).
-- A household groups documents, warranties and renewal dates under a house or car.
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,               -- 'property' | 'vehicle'
  name text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_tenant_idx ON assets (tenant_id);

-- Link a document to an asset (e.g. an insurance policy to a car).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS documents_asset_idx ON documents (asset_id);
