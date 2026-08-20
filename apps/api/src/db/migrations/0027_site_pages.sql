-- Marketing-site CMS: editable landing pages (vaulmo.com), managed from the admin console.
CREATE TABLE IF NOT EXISTS site_pages (
  slug text PRIMARY KEY,
  title text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
