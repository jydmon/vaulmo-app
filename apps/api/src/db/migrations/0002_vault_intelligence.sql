-- Phase 2 (Digital Vault) + Phase 3 (AI Document Intelligence)

-- Country for country-specific catalogue/checklist; internal-tester feature gate.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'GB';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_internal_tester boolean NOT NULL DEFAULT false;

DO $$ BEGIN CREATE TYPE document_status AS ENUM ('DRAFT','PROCESSING','AWAITING_CONFIRM','CONFIRMED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE reminder_status AS ENUM ('DRAFT','ACTIVE','DISMISSED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Document catalogue (seeded from code; stored so the API/admin can query + filter by country).
CREATE TABLE IF NOT EXISTS document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  countries text[] NOT NULL DEFAULT '{GLOBAL}',
  recommended boolean NOT NULL DEFAULT false,
  metadata_schema jsonb NOT NULL DEFAULT '[]',
  sort integer NOT NULL DEFAULT 100
);

-- A user's actual document instance.
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id uuid REFERENCES file_objects(id) ON DELETE SET NULL,
  type_key text,
  title text NOT NULL,
  status document_status NOT NULL DEFAULT 'DRAFT',
  ocr_text text,
  classified_type_key text,
  classification_confidence real,
  extracted_metadata jsonb,
  confirmed_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_tenant_idx ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(tenant_id, status);

-- Reminders. Created as DRAFT from extracted dates; only ACTIVATED (go live) once
-- the user confirms the metadata. Enforced in code AND guarded here.
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  due_date text,
  status reminder_status NOT NULL DEFAULT 'DRAFT',
  source text NOT NULL DEFAULT 'extracted',
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);
CREATE INDEX IF NOT EXISTS reminders_tenant_idx ON reminders(tenant_id, status);

-- A live reminder must have been activated. Blocks any row that claims ACTIVE
-- without an activation timestamp — defence in depth for the "confirm first" rule.
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_active_requires_activation;
ALTER TABLE reminders ADD CONSTRAINT reminders_active_requires_activation
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL);
