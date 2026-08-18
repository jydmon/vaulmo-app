// Central definition of roles and their permissions (RBAC).
// Seeded into the database by prisma/seed.ts and enforced by the rbac middleware.

export const PERMISSIONS = {
  // Platform-wide (Super Admin only)
  PLATFORM_MANAGE: 'platform:manage',
  TENANT_READ_ALL: 'tenant:read:all',
  TENANT_MANAGE_ALL: 'tenant:manage:all',
  USER_READ_ALL: 'user:read:all',
  AUDIT_READ_ALL: 'audit:read:all',

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
  TENANT_OWNER: 'tenant_owner',
  MEMBER: 'member',
} as const;

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
