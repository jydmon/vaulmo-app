-- CRM (lifecycle + notes) and CMS (knowledge-base articles)

CREATE TABLE IF NOT EXISTS crm_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'active',
  tags text[] NOT NULL DEFAULT '{}',
  owner_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'note',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_notes_tenant_idx ON crm_notes(tenant_id);

CREATE TABLE IF NOT EXISTS cms_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text,
  excerpt text,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  views integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_articles_status_idx ON cms_articles(status);
