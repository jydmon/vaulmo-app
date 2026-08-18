-- GDPR / data protection: data subject requests + consent records.
CREATE TABLE IF NOT EXISTS dsr_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  subject_email text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  notes text,
  requested_by text NOT NULL DEFAULT 'self',
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dsr_status_idx ON dsr_requests(status);

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip text
);
CREATE INDEX IF NOT EXISTS consent_user_idx ON consent_records(user_id);
