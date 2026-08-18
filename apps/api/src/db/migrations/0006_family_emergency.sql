-- Phase 7 (Family & Next-of-Kin) + Phase 8 (Emergency Access)

-- Household profiles (people in the family; distinct from login users). Dependants included.
CREATE TABLE IF NOT EXISTS family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text,
  is_dependant boolean NOT NULL DEFAULT false,
  date_of_birth text,
  linked_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_tenant_idx ON family_members(tenant_id);

-- Nominated next of kin, invited by email, with granular emergency permissions and a
-- quarterly reconfirmation cadence.
CREATE TABLE IF NOT EXISTS next_of_kin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  relationship text,
  status text NOT NULL DEFAULT 'nominated',   -- nominated|invited|confirmed|declined|revoked
  permissions jsonb NOT NULL DEFAULT '{}',     -- what they may see in an emergency
  invite_token_hash text,
  invited_at timestamptz,
  confirmed_at timestamptz,
  last_reconfirmed_at timestamptz,
  reconfirm_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nok_tenant_idx ON next_of_kin(tenant_id);

-- Emergency access requests — a tightly controlled, audited, multi-step workflow.
CREATE TABLE IF NOT EXISTS emergency_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nok_id uuid REFERENCES next_of_kin(id) ON DELETE SET NULL,
  requester_name text NOT NULL,
  requester_email text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  -- pending -> owner_approved/owner_declined -> security_review -> approved(active) -> revoked/expired
  requested_at timestamptz NOT NULL DEFAULT now(),
  pending_until timestamptz NOT NULL,           -- requested_at + 7 days
  owner_decision text,                          -- approve|decline
  owner_decided_at timestamptz,
  security_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  security_reviewed_at timestamptz,
  security_notes text,
  due_diligence jsonb NOT NULL DEFAULT '{}',
  access_scope jsonb NOT NULL DEFAULT '{}',      -- restricted set granted
  access_granted_at timestamptz,
  access_expires_at timestamptz,                 -- temporary access window
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emergency_tenant_idx ON emergency_requests(tenant_id, status);
