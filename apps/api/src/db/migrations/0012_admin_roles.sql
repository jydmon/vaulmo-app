-- Least-privilege admin roles: Security Reviewer & Support Agent, plus granular permissions.
-- Idempotent: safe to run repeatedly.

-- New permissions
INSERT INTO permissions (key, name) VALUES
  ('admin:manage', 'admin:manage'),
  ('security:review', 'security:review'),
  ('support:manage', 'support:manage')
ON CONFLICT (key) DO NOTHING;

-- New roles
INSERT INTO roles (key, name, description, is_system) VALUES
  ('security_reviewer', 'Security Reviewer', 'Reviews emergency-access cases and monitors security. Read-only on customer accounts; cannot manage billing or content.', true),
  ('support_agent', 'Support Agent', 'Handles support tickets and views non-sensitive account information. Cannot review emergency access or manage billing.', true)
ON CONFLICT (key) DO NOTHING;

-- Grant the new granular permissions to Super Admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'super_admin' AND p.key IN ('admin:manage', 'security:review', 'support:manage')
ON CONFLICT DO NOTHING;

-- Security Reviewer permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'security_reviewer' AND p.key IN ('tenant:read:all', 'user:read:all', 'audit:read:all', 'security:review')
ON CONFLICT DO NOTHING;

-- Support Agent permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'support_agent' AND p.key IN ('tenant:read:all', 'user:read:all', 'support:manage')
ON CONFLICT DO NOTHING;
