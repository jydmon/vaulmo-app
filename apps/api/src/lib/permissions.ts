// Central definition of roles and their permissions (RBAC).
// Seeded into the database by prisma/seed.ts and enforced by the rbac middleware.

export const PERMISSIONS = {
  // Platform-wide (Super Admin only)
  PLATFORM_MANAGE: 'platform:manage',
  TENANT_READ_ALL: 'tenant:read:all',
  TENANT_MANAGE_ALL: 'tenant:manage:all',
  USER_READ_ALL: 'user:read:all',
  AUDIT_READ_ALL: 'audit:read:all',
  // Granular admin capabilities (for least-privilege admin roles)
  ADMIN_MANAGE: 'admin:manage', // manage admin users & roles
  SECURITY_REVIEW: 'security:review', // emergency-access review + security dashboard
  SUPPORT_MANAGE: 'support:manage', // manage support tickets

  // Tenant-scoped
  TENANT_READ: 'tenant:read',
  TENANT_MANAGE: 'tenant:manage',
  MEMBER_INVITE: 'member:invite',
  MEMBER_MANAGE: 'member:manage',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  AUDIT_READ: 'audit:read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  SECURITY_REVIEWER: 'security_reviewer',
  SUPPORT_AGENT: 'support_agent',
  TENANT_OWNER: 'tenant_owner',
  MEMBER: 'member',
} as const;

// Administrative roles for which two-factor authentication is mandatory.
export const ADMIN_ROLE_KEYS = [ROLES.SUPER_ADMIN, ROLES.SECURITY_REVIEWER, ROLES.SUPPORT_AGENT] as string[];

export const ROLE_DEFINITIONS: Record<
  string,
  { name: string; description: string; permissions: PermissionKey[] }
> = {
  [ROLES.SUPER_ADMIN]: {
    name: 'Super Admin',
    description: 'Vaulmo platform operator. Full platform control; not tied to a tenant.',
    permissions: [
      PERMISSIONS.PLATFORM_MANAGE,
      PERMISSIONS.TENANT_READ_ALL,
      PERMISSIONS.TENANT_MANAGE_ALL,
      PERMISSIONS.USER_READ_ALL,
      PERMISSIONS.AUDIT_READ_ALL,
      PERMISSIONS.ADMIN_MANAGE,
      PERMISSIONS.SECURITY_REVIEW,
      PERMISSIONS.SUPPORT_MANAGE,
    ],
  },
  [ROLES.SECURITY_REVIEWER]: {
    name: 'Security Reviewer',
    description: 'Reviews emergency-access cases and monitors security. Read-only on customer accounts; cannot manage billing or content.',
    permissions: [
      PERMISSIONS.TENANT_READ_ALL,
      PERMISSIONS.USER_READ_ALL,
      PERMISSIONS.AUDIT_READ_ALL,
      PERMISSIONS.SECURITY_REVIEW,
    ],
  },
  [ROLES.SUPPORT_AGENT]: {
    name: 'Support Agent',
    description: 'Handles support tickets and views non-sensitive account information. Cannot review emergency access or manage billing.',
    permissions: [
      PERMISSIONS.TENANT_READ_ALL,
      PERMISSIONS.USER_READ_ALL,
      PERMISSIONS.SUPPORT_MANAGE,
    ],
  },
  [ROLES.TENANT_OWNER]: {
    name: 'Tenant Owner',
    description: 'Owns a customer account (household/individual) and manages their own members.',
    permissions: [
      PERMISSIONS.TENANT_READ,
      PERMISSIONS.TENANT_MANAGE,
      PERMISSIONS.MEMBER_INVITE,
      PERMISSIONS.MEMBER_MANAGE,
      PERMISSIONS.FILE_READ,
      PERMISSIONS.FILE_WRITE,
      PERMISSIONS.AUDIT_READ,
    ],
  },
  [ROLES.MEMBER]: {
    name: 'Member',
    description: 'A member of a tenant account.',
    permissions: [PERMISSIONS.TENANT_READ, PERMISSIONS.FILE_READ, PERMISSIONS.FILE_WRITE],
  },
};

export const ALL_PERMISSIONS: { key: string; name: string }[] = Object.values(PERMISSIONS).map(
  (key) => ({ key, name: key }),
);
