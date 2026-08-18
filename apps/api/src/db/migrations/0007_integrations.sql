-- Phase 9 (Integration Gateway) + Phase 10 (Gmail & Outlook / email detection)

-- Connected external accounts. Tokens are stored ENCRYPTED (never plaintext).
CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,                    -- mock | gmail | outlook
  status text NOT NULL DEFAULT 'connected',  -- connected | disconnected | error
  provider_account_id text,
  access_token_enc text,                     -- AES-256-GCM ciphertext
  refresh_token_enc text,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connections_tenant_idx ON connections(tenant_id);

-- Items detected from connected sources, awaiting user confirmation. Carry provenance
-- (which connection they came from) and the raw + extracted data.
CREATE TABLE IF NOT EXISTS detected_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES connections(id) ON DELETE SET NULL,
  type text NOT NULL,                        -- travel | ticket | purchase | warranty | other
  source text NOT NULL DEFAULT 'email',
  raw_subject text,
  raw_from text,
  extracted jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',     -- pending | confirmed | dismissed
  created_entity_type text,
  created_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS detected_tenant_idx ON detected_items(tenant_id, status);
