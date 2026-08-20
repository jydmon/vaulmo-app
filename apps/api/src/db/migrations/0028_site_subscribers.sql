-- Waitlist / marketing subscribers captured from the public site (feeds the CRM).
CREATE TABLE IF NOT EXISTS site_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  notify_at_launch boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'website',
  created_at timestamptz NOT NULL DEFAULT now()
);
