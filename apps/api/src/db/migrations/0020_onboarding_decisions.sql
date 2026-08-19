-- Account & Onboarding: personalised questionnaire (ACC-09) + per-document
-- decisions (ACC-11), plus optional profile fields (ACC-07).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS timezone text;

CREATE TABLE IF NOT EXISTS document_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type_key text NOT NULL,
  decision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type_key)
);
CREATE INDEX IF NOT EXISTS document_decisions_tenant_idx ON document_decisions (tenant_id);
