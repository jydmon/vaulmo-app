import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  real,
  timestamp,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

// ---- Enums ----
export const tenantType = pgEnum('tenant_type', ['HOUSEHOLD', 'INDIVIDUAL']);
export const tenantStatus = pgEnum('tenant_status', [
  'ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'SUSPENDED',
]);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED']);
export const fileStatus = pgEnum('file_status', ['PENDING', 'STORED', 'QUARANTINED', 'DELETED']);
export const documentStatus = pgEnum('document_status', ['DRAFT', 'PROCESSING', 'AWAITING_CONFIRM', 'CONFIRMED']);
export const reminderStatus = pgEnum('reminder_status', ['DRAFT', 'ACTIVE', 'DISMISSED', 'COMPLETED']);

// ---- Tenants ----
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  type: tenantType('type').notNull().default('HOUSEHOLD'),
  status: tenantStatus('status').notNull().default('ACTIVE'),
  plan: text('plan').notNull().default('starter'),
  country: text('country').notNull().default('GB'),
  onboarding: jsonb('onboarding'), // { completed, answers, completedAt }
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Users ----
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    status: userStatus('status').notNull().default('ACTIVE'),
    emailVerified: boolean('email_verified').notNull().default(false),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    mfaRecoveryCodes: text('mfa_recovery_codes').array().notNull().default([]),
    isInternalTester: boolean('is_internal_tester').notNull().default(false),
    phone: text('phone'),
    timezone: text('timezone'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    termsVersion: text('terms_version'),
    tourSeenAt: timestamp('tour_seen_at', { withTimezone: true }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('users_tenant_idx').on(t.tenantId) }),
);

// ---- RBAC ----
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(true),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) }),
);

// ---- Sessions ----
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    mfaSatisfied: boolean('mfa_satisfied').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }),
);

// ---- Files ----
export const fileObjects = pgTable(
  'file_objects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    checksumSha256: text('checksum_sha256'),
    status: fileStatus('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('files_tenant_idx').on(t.tenantId) }),
);

// ---- Audit log (append-only) ----
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    outcome: text('outcome').notNull().default('success'),
  },
  (t) => ({
    tenantAtIdx: index('audit_tenant_at_idx').on(t.tenantId, t.at),
    actionAtIdx: index('audit_action_at_idx').on(t.action, t.at),
  }),
);

// ---- Phase 2: document catalogue (seeded config) ----
export const documentTypes = pgTable('document_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  countries: text('countries').array().notNull().default(['GLOBAL']),
  recommended: boolean('recommended').notNull().default(false),
  metadataSchema: jsonb('metadata_schema').notNull().default([]),
  reminderLeadDays: integer('reminder_lead_days').array().notNull().default([180, 90, 30, 7]),
  archived: boolean('archived').notNull().default(false),
  sort: integer('sort').notNull().default(100),
});

// ---- Phase 2/3: a user's document instance ----
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => fileObjects.id, { onDelete: 'set null' }),
    typeKey: text('type_key'),
    title: text('title').notNull(),
    status: documentStatus('status').notNull().default('DRAFT'),
    ocrText: text('ocr_text'),
    classifiedTypeKey: text('classified_type_key'),
    classificationConfidence: real('classification_confidence'),
    extractedMetadata: jsonb('extracted_metadata'),
    confirmedMetadata: jsonb('confirmed_metadata'),
    metadataSources: jsonb('metadata_sources').notNull().default({}),
    searchText: text('search_text'),
    version: integer('version').notNull().default(1),
    previousVersionId: uuid('previous_version_id'),
    replacedByDocumentId: uuid('replaced_by_document_id'),
    subjectMemberId: uuid('subject_member_id'),
    assetId: uuid('asset_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('documents_tenant_idx').on(t.tenantId),
    statusIdx: index('documents_status_idx').on(t.tenantId, t.status),
  }),
);

// ---- Account & Onboarding: per-document decisions (ACC-11) ----
export const documentDecisions = pgTable(
  'document_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    typeKey: text('type_key').notNull(),
    decision: text('decision').notNull(), // store_now | upload_later | remind_me | not_applicable | do_not_store
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantTypeIdx: index('document_decisions_tenant_idx').on(t.tenantId) }),
);

// ---- Phase 3: reminders (draft until metadata is confirmed) ----
export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    dueDate: text('due_date'), // stored as ISO date (YYYY-MM-DD)
    status: reminderStatus('status').notNull().default('DRAFT'),
    source: text('source').notNull().default('extracted'),
    recurrence: text('recurrence').notNull().default('none'), // none | monthly | quarterly | yearly
    leadDays: integer('lead_days').array().notNull().default([30, 7, 1, 0]),
    escalationLevel: integer('escalation_level').notNull().default(0),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => ({ tenantIdx: index('reminders_tenant_idx').on(t.tenantId, t.status) }),
);

// ---- Phase 4: notifications ----
export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  inApp: boolean('in_app').notNull().default(true),
  email: boolean('email').notNull().default(true),
  push: boolean('push').notNull().default(true),
  quietStart: integer('quiet_start'), // hour 0–23, inclusive; null = disabled
  quietEnd: integer('quiet_end'),     // hour 0–23, exclusive
});

export const deviceTokens = pgTable('device_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  token: text('token').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    reminderId: uuid('reminder_id').references(() => reminders.id, { onDelete: 'set null' }),
    dedupeKey: text('dedupe_key'),
    status: text('status').notNull().default('sent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => ({ userIdx: index('notifications_user_idx').on(t.userId, t.createdAt) }),
);

// ---- Phase 6: billing ----
export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  amount: integer('amount').notNull().default(0),
  currency: text('currency').notNull().default('gbp'),
  interval: text('interval').notNull().default('year'),
  stripeProductId: text('stripe_product_id'),
  stripePriceId: text('stripe_price_id'),
  entitlements: jsonb('entitlements').notNull().default({}),
  modules: jsonb('modules').notNull().default([]),
  features: jsonb('features').notNull().default([]),
  discountPercent: integer('discount_percent').notNull().default(0),
  discountLabel: text('discount_label'),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(100),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  planKey: text('plan_key'),
  status: text('status').notNull().default('none'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  graceUntil: timestamp('grace_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  stripeInvoiceId: text('stripe_invoice_id'),
  amount: integer('amount').notNull().default(0),
  currency: text('currency').notNull().default('gbp'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Auth tokens (email verification + password reset) ----
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 7: family & next of kin ----
export const familyMembers = pgTable('family_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  relationship: text('relationship'),
  isDependant: boolean('is_dependant').notNull().default(false),
  dateOfBirth: text('date_of_birth'),
  linkedUserId: uuid('linked_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Properties & Vehicles (FAM-03/04/05) — first-class asset records.
export const assets = pgTable('assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // property | vehicle
  name: text('name').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index('assets_tenant_idx').on(t.tenantId) }));

export const nextOfKin = pgTable('next_of_kin', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  relationship: text('relationship'),
  status: text('status').notNull().default('nominated'),
  permissions: jsonb('permissions').notNull().default({}),
  inviteTokenHash: text('invite_token_hash'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  lastReconfirmedAt: timestamp('last_reconfirmed_at', { withTimezone: true }),
  reconfirmDueAt: timestamp('reconfirm_due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 9: integration connections ----
export const connections = pgTable('connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('connected'),
  providerAccountId: text('provider_account_id'),
  accessTokenEnc: text('access_token_enc'),
  refreshTokenEnc: text('refresh_token_enc'),
  scopes: text('scopes').array().notNull().default([]),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 10: detected items (email → structured, awaiting confirmation) ----
export const detectedItems = pgTable('detected_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => connections.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  source: text('source').notNull().default('email'),
  rawSubject: text('raw_subject'),
  rawFrom: text('raw_from'),
  extracted: jsonb('extracted').notNull().default({}),
  status: text('status').notNull().default('pending'),
  createdEntityType: text('created_entity_type'),
  createdEntityId: uuid('created_entity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 11: trips ----
export const trips = pgTable('trips', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  destination: text('destination'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  status: text('status').notNull().default('upcoming'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const tripItems = pgTable('trip_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  details: jsonb('details').notNull().default({}),
  startDate: text('start_date'),
  endDate: text('end_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 12: purchases & warranties ----
export const purchases = pgTable('purchases', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  merchant: text('merchant'),
  item: text('item').notNull(),
  amount: text('amount'),
  purchaseDate: text('purchase_date'),
  category: text('category'),
  isAsset: boolean('is_asset').notNull().default(false),
  warrantyExpiry: text('warranty_expiry'),
  receiptFileId: uuid('receipt_file_id').references(() => fileObjects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Phase 13: personal subscription tracking ----
export const trackedSubscriptions = pgTable('tracked_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  amount: text('amount'),
  cycle: text('cycle').notNull().default('monthly'),
  renewalDate: text('renewal_date'),
  status: text('status').notNull().default('active'),
  source: text('source').notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Marketing-site CMS (editable landing pages) ----
export const sitePages = pgTable('site_pages', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  content: jsonb('content').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Waitlist / marketing subscribers captured from the public site.
export const siteSubscribers = pgTable('site_subscribers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  notifyAtLaunch: boolean('notify_at_launch').notNull().default(true),
  source: text('source').notNull().default('website'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Contact-form submissions from the public site (collected in the admin inbox).
export const contactMessages = pgTable('contact_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  subject: text('subject'),
  message: text('message').notNull(),
  status: text('status').notNull().default('new'), // new | read
  source: text('source').notNull().default('website'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Password / secrets vault (SEC-30) ----
// Owner-scoped secure items. The sensitive payload (password, notes, card number,
// PIN) is AES-256-GCM encrypted at rest in `secretCipher`; only non-sensitive labels
// are stored in plaintext for listing. Access is strictly the OWNER user — other
// household members and admins (incl. super_admin) can never read another user's
// secrets, because every query filters on owner_user_id and the payload is encrypted.
export const secureItems = pgTable('secure_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('login'), // login | card | note | pin
  label: text('label').notNull(),
  username: text('username'),
  url: text('url'),
  category: text('category'),
  secretCipher: text('secret_cipher').notNull(), // AES-GCM ciphertext of a JSON payload
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerIdx: index('secure_items_owner_idx').on(t.tenantId, t.ownerUserId) }));

// ---- Phase 8: emergency access ----
export const emergencyRequests = pgTable('emergency_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nokId: uuid('nok_id').references(() => nextOfKin.id, { onDelete: 'set null' }),
  requesterName: text('requester_name').notNull(),
  requesterEmail: text('requester_email').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  pendingUntil: timestamp('pending_until', { withTimezone: true }).notNull(),
  ownerDecision: text('owner_decision'),
  ownerDecidedAt: timestamp('owner_decided_at', { withTimezone: true }),
  securityReviewedBy: uuid('security_reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  securityReviewedAt: timestamp('security_reviewed_at', { withTimezone: true }),
  securityNotes: text('security_notes'),
  dueDiligence: jsonb('due_diligence').notNull().default({}),
  accessScope: jsonb('access_scope').notNull().default({}),
  accessGrantedAt: timestamp('access_granted_at', { withTimezone: true }),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Support desk (tickets + messages) ----
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    category: text('category'),
    status: text('status').notNull().default('open'), // open | pending | closed
    priority: text('priority').notNull().default('normal'), // low | normal | high
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('support_tickets_tenant_idx').on(t.tenantId) }),
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorRole: text('author_role').notNull(), // customer | support
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ticketIdx: index('support_messages_ticket_idx').on(t.ticketId) }),
);

// ---- CRM: lifecycle + notes per customer (tenant) ----
export const crmProfiles = pgTable('crm_profiles', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull().default('active'), // lead | onboarding | active | at_risk | churned
  tags: text('tags').array().notNull().default([]),
  ownerName: text('owner_name'), // internal account owner / CSM
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- CRM: email campaigns + automated communication workflows ----
export const emailCampaigns = pgTable('email_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  format: text('format').notNull().default('html'), // html | text
  segment: text('segment').notNull().default('all'),
  audiences: jsonb('audiences').notNull().default([]), // ['waitlist','contacts','users',...]
  tag: text('tag'),
  status: text('status').notNull().default('draft'), // draft | scheduled | sent
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  recipientCount: integer('recipient_count').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const campaignRecipients = pgTable('campaign_recipients', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  status: text('status').notNull().default('sent'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ campaignIdx: index('campaign_recipients_campaign_idx').on(t.campaignId) }));
export const communicationAutomations = pgTable('communication_automations', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  trigger: text('trigger').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crmNotes = pgTable(
  'crm_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().default('note'), // note | call | email | meeting
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('crm_notes_tenant_idx').on(t.tenantId) }),
);

// ---- CMS: knowledge-base articles ----
export const cmsArticles = pgTable(
  'cms_articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    category: text('category'),
    excerpt: text('excerpt'),
    body: text('body').notNull().default(''),
    status: text('status').notNull().default('draft'), // draft | published
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    views: integer('views').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('cms_articles_status_idx').on(t.status) }),
);

// ---- Configuration: feature flags, announcements, platform settings ----
export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  description: text('description'),
  enabled: boolean('enabled').notNull().default(false),
  rollout: text('rollout').notNull().default('off'), // off | internal | pilot | everyone
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    level: text('level').notNull().default('info'), // info | warning | critical
    audience: text('audience').notNull().default('all'), // all | customers | admins
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ activeIdx: index('announcements_active_idx').on(t.active) }),
);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Notification templates (admin-managed content) ----
export const notificationTemplates = pgTable('notification_templates', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  channel: text('channel').notNull().default('email'), // email | push | in_app
  category: text('category').notNull().default('system'),
  subject: text('subject'),
  body: text('body').notNull().default(''),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- GDPR / data protection ----
export const dsrRequests = pgTable(
  'dsr_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    subjectEmail: text('subject_email').notNull(),
    type: text('type').notNull(), // export | deletion
    status: text('status').notNull().default('pending'), // pending | in_progress | completed | rejected
    reason: text('reason'),
    notes: text('notes'),
    requestedBy: text('requested_by').notNull().default('self'), // self | admin
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('dsr_status_idx').on(t.status) }),
);

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    policy: text('policy').notNull(), // terms | privacy | cookie | marketing
    version: text('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
  },
  (t) => ({ userIdx: index('consent_user_idx').on(t.userId) }),
);

// ---- AI usage tracking (for cost/volume monitoring) ----
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    feature: text('feature').notNull(), // assistant | search | classification | summary
    model: text('model').notNull().default('local'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0), // millionths of a USD
    status: text('status').notNull().default('success'), // success | failure
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ createdIdx: index('ai_usage_created_idx').on(t.createdAt) }),
);
