import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { emailCampaigns, campaignRecipients, communicationAutomations, users, subscriptions, crmProfiles } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { sendEmail } from '../../lib/notify';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth, requireMfaSatisfied);

const SEGMENTS = ['all', 'subscribers', 'prospects', 'tag'] as const;

// Resolve the recipient list for a segment: one account-owner email per household.
async function resolveAudience(segment: string, tag?: string | null): Promise<{ tenantId: string; email: string; name: string }[]> {
  const us = await db.select({ email: users.email, name: users.fullName, tenantId: users.tenantId, createdAt: users.createdAt })
    .from(users).where(isNotNull(users.tenantId)).orderBy(users.createdAt);
  const ownerByTenant = new Map<string, { email: string; name: string; tenantId: string }>();
  for (const u of us) if (u.tenantId && !ownerByTenant.has(u.tenantId)) ownerByTenant.set(u.tenantId, { email: u.email, name: u.name, tenantId: u.tenantId });
  let owners = [...ownerByTenant.values()];

  const subs = await db.select().from(subscriptions);
  const statusByTenant = new Map(subs.map((s) => [s.tenantId, s.status]));
  const isSubscriber = (tid: string) => ['active', 'trialing', 'past_due'].includes(statusByTenant.get(tid) ?? 'none');

  if (segment === 'subscribers') owners = owners.filter((o) => isSubscriber(o.tenantId));
  else if (segment === 'prospects') owners = owners.filter((o) => !isSubscriber(o.tenantId));
  else if (segment === 'tag') {
    const profs = await db.select().from(crmProfiles);
    const tagged = new Set(profs.filter((p) => (p.tags ?? []).includes(String(tag ?? ''))).map((p) => p.tenantId));
    owners = owners.filter((o) => tagged.has(o.tenantId));
  }
  return owners;
}

function view(c: any) {
  return { id: c.id, name: c.name, subject: c.subject, body: c.body, segment: c.segment, tag: c.tag, status: c.status, recipientCount: c.recipientCount, sentAt: c.sentAt, createdAt: c.createdAt };
}

// ---- Campaigns ----
campaignsRouter.get('/campaigns', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const rows = await db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt));
  res.json({ campaigns: rows.map(view) });
});

const campaignSchema = z.object({
  name: z.string().min(1).max(160),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  segment: z.enum(SEGMENTS).default('all'),
  tag: z.string().max(60).optional(),
});
campaignsRouter.post('/campaigns', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = campaignSchema.parse(req.body);
  const [row] = await db.insert(emailCampaigns).values({ name: b.name, subject: b.subject, body: b.body, segment: b.segment, tag: b.segment === 'tag' ? b.tag ?? null : null, createdBy: req.auth!.sub }).returning();
  await audit({ action: 'crm.campaign.created', actorId: req.auth!.sub, metadata: { name: b.name, segment: b.segment }, req });
  res.status(201).json({ campaign: view(row) });
});

campaignsRouter.get('/campaigns/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Campaign not found');
  const recips = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id)).orderBy(desc(campaignRecipients.sentAt)).limit(50);
  res.json({ campaign: view(c), recipients: recips.map((r) => ({ email: r.email, status: r.status, sentAt: r.sentAt })) });
});

// Preview the audience size + a sample, without sending.
campaignsRouter.post('/campaigns/:id/audience', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Campaign not found');
  const audience = await resolveAudience(c.segment, c.tag);
  res.json({ count: audience.length, sample: audience.slice(0, 5).map((a) => a.email) });
});

// Send now — records each recipient and dispatches via the email adapter.
campaignsRouter.post('/campaigns/:id/send', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Campaign not found');
  if (c.status === 'sent') throw new AppError(409, 'already_sent', 'This campaign has already been sent');
  const audience = await resolveAudience(c.segment, c.tag);
  for (const a of audience) {
    try {
      await sendEmail(a.email, c.subject, c.body);
      await db.insert(campaignRecipients).values({ campaignId: c.id, tenantId: a.tenantId, email: a.email, status: 'sent' });
    } catch {
      await db.insert(campaignRecipients).values({ campaignId: c.id, tenantId: a.tenantId, email: a.email, status: 'failed' });
    }
  }
  const [updated] = await db.update(emailCampaigns).set({ status: 'sent', recipientCount: audience.length, sentAt: new Date(), updatedAt: new Date() }).where(eq(emailCampaigns.id, c.id)).returning();
  await audit({ action: 'crm.campaign.sent', actorId: req.auth!.sub, metadata: { name: c.name, recipients: audience.length }, req });
  res.json({ campaign: view(updated), sent: audience.length });
});

campaignsRouter.delete('/campaigns/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [row] = await db.delete(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).returning();
  if (!row) throw new AppError(404, 'not_found', 'Campaign not found');
  await audit({ action: 'crm.campaign.deleted', actorId: req.auth!.sub, req });
  res.json({ deleted: true });
});

// ---- Automated communication workflows ----
const DEFAULT_AUTOMATIONS = [
  { key: 'welcome', name: 'Welcome email', description: 'Sent when a new household finishes signing up.', trigger: 'signup', enabled: true, subject: 'Welcome to Vaulmo 👋', body: 'Hi {{name}}, welcome to Vaulmo! Add your first document and we’ll help you stay on top of renewals and reminders.' },
  { key: 'renewal_due', name: 'Renewal reminder', description: 'Sent before a subscription renews.', trigger: 'renewal_due', enabled: true, subject: 'Your Vaulmo plan renews soon', body: 'Hi {{name}}, your Vaulmo subscription renews shortly. No action is needed to continue — manage your plan any time from Plan & Billing.' },
  { key: 'inactivity', name: 'Re-engagement', description: 'Sent to households that have been inactive for a while.', trigger: 'inactivity', enabled: false, subject: 'We’ve kept your vault safe', body: 'Hi {{name}}, it’s been a while. Your documents are safe in Vaulmo — pop back in to check your reminders and what might need attention.' },
  { key: 'payment_failed', name: 'Payment issue', description: 'Sent when a payment fails (grace period begins).', trigger: 'payment_failed', enabled: true, subject: 'There was a problem with your payment', body: 'Hi {{name}}, we couldn’t process your latest Vaulmo payment. Your access continues during a short grace period — please update your payment method to avoid interruption.' },
];
async function ensureAutomations() {
  const existing = await db.select().from(communicationAutomations);
  if (existing.length) return existing;
  await db.insert(communicationAutomations).values(DEFAULT_AUTOMATIONS).onConflictDoNothing();
  return db.select().from(communicationAutomations);
}
campaignsRouter.get('/automations', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const rows = await ensureAutomations();
  res.json({ automations: rows.sort((a, b) => a.name.localeCompare(b.name)) });
});
const automationSchema = z.object({ enabled: z.boolean().optional(), subject: z.string().max(200).optional(), body: z.string().max(20000).optional() });
campaignsRouter.put('/automations/:key', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = automationSchema.parse(req.body);
  await ensureAutomations();
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.enabled !== undefined) set.enabled = b.enabled;
  if (b.subject !== undefined) set.subject = b.subject;
  if (b.body !== undefined) set.body = b.body;
  const [row] = await db.update(communicationAutomations).set(set).where(eq(communicationAutomations.key, req.params.key)).returning();
  if (!row) throw new AppError(404, 'not_found', 'Automation not found');
  await audit({ action: 'crm.automation.updated', actorId: req.auth!.sub, metadata: { key: req.params.key, enabled: row.enabled }, req });
  res.json({ automation: row });
});
