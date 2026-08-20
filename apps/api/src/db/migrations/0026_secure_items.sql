-- Password / secrets vault (SEC-30): owner-scoped, encrypted-at-rest secure items.
CREATE TABLE IF NOT EXISTS secure_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'login',
  label text NOT NULL,
  username text,
  url text,
  category text,
  secret_cipher text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS secure_items_owner_idx ON secure_items (tenant_id, owner_user_id);
