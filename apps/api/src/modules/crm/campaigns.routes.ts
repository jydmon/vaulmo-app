import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { db } from '../../db/client';
import { emailCampaigns, campaignRecipients, communicationAutomations, users, subscriptions, crmProfiles, siteSubscribers, contactMessages } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { sendEmail } from '../../lib/notify';
import { logger } from '../../logger';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth, requireMfaSatisfied);

// Legacy single-segment values (kept so old campaigns still resolve).
const SEGMENTS = ['all', 'subscribers', 'prospects', 'tag'] as const;

// The selectable audience groups a campaign can target. Multiple can be combined; the
// final recipient list is the de-duplicated union of everyone across the chosen groups.
export const AUDIENCES = [
  { key: 'users', label: 'App users (all)', desc: 'Everyone with a Vaulmo account (one email per household).' },
  { key: 'subscribers', label: 'App users — paying subscribers', desc: 'Accounts with an active, trialing or past-due subscription.' },
  { key: 'prospects', label: 'App users — no active plan', desc: 'Accounts without an active subscription.' },
  { key: 'waitlist', label: 'Website waitlist sign-ups', desc: 'People who joined the waitlist on vaulmo.com.' },
  { key: 'contacts', label: 'Contact-form senders', desc: 'People who messaged you via the website contact form.' },
] as const;
const AUDIENCE_KEYS = AUDIENCES.map((a) => a.key) as unknown as [string, ...string[]];

type Recipient = { email: string; name: string; tenantId: string | null };

// One account-owner email per household, with subscription status for filtering.
async function appOwners(): Promise<{ owner: Recipient; isSubscriber: boolean }[]> {
  const us = await db.select({ email: users.email, name: users.fullName, tenantId: users.tenantId, createdAt: users.createdAt })
    .from(users).where(isNotNull(users.tenantId)).orderBy(users.createdAt);
  const ownerByTenant = new Map<string, Recipient>();
  for (const u of us) if (u.tenantId && !ownerByTenant.has(u.tenantId)) ownerByTenant.set(u.tenantId, { email: u.email, name: u.name, tenantId: u.tenantId });
  const subs = await db.select().from(subscriptions);
  const statusByTenant = new Map(subs.map((s) => [s.tenantId, s.status]));
  const isSub = (tid: string) => ['active', 'trialing', 'past_due'].includes(statusByTenant.get(tid) ?? 'none');
  return [...ownerByTenant.values()].map((owner) => ({ owner, isSubscriber: owner.tenantId ? isSub(owner.tenantId) : false }));
}

// Resolve the de-duplicated recipient union for a set of audience groups (+ legacy segment/tag).
async function resolveAudiences(audiences: string[], legacy?: { segment?: string; tag?: string | null }): Promise<Recipient[]> {
  const groups = new Set(audiences ?? []);
  // Map a legacy single-segment campaign onto the new groups.
  if (legacy?.segment && !groups.size) {
    if (legacy.segment === 'all') groups.add('users');
    else groups.add(legacy.segment);
  }
  const byEmail = new Map<string, Recipient>();
  const add = (r: Recipient) => { const e = r.email?.toLowerCase().trim(); if (e && !byEmail.has(e)) byEmail.set(e, { ...r, email: e }); };

  const needOwners = groups.has('users') || groups.has('subscribers') || groups.has('prospects') || groups.has('tag');
  if (needOwners) {
    const owners = await appOwners();
    if (groups.has('users')) owners.forEach((o) => add(o.owner));
    if (groups.has('subscribers')) owners.filter((o) => o.isSubscriber).forEach((o) => add(o.owner));
    if (groups.has('prospects')) owners.filter((o) => !o.isSubscriber).forEach((o) => add(o.owner));
    if (groups.has('tag')) {
      const profs = await db.select().from(crmProfiles);
      const tagged = new Set(profs.filter((p) => (p.tags ?? []).includes(String(legacy?.tag ?? ''))).map((p) => p.tenantId));
      owners.filter((o) => o.owner.tenantId && tagged.has(o.owner.tenantId)).forEach((o) => add(o.owner));
    }
  }
  if (groups.has('waitlist')) {
    const rows = await db.select().from(siteSubscribers);
    rows.forEach((r) => add({ email: r.email, name: r.name, tenantId: null }));
  }
  if (groups.has('contacts')) {
    const rows = await db.select().from(contactMessages);
    rows.forEach((r) => add({ email: r.email, name: r.name, tenantId: null }));
  }
  return [...byEmail.values()];
}

function view(c: any) {
  return { id: c.id, name: c.name, subject: c.subject, body: c.body, format: c.format ?? 'html', segment: c.segment, audiences: Array.isArray(c.audiences) ? c.audiences : [], tag: c.tag, status: c.status, scheduledAt: c.scheduledAt, recipientCount: c.recipientCount, sentAt: c.sentAt, createdAt: c.createdAt };
}

// Deliver a campaign's email to its resolved audience, recording each recipient.
async function deliverCampaign(c: any): Promise<number> {
  const audience = await resolveAudiences(view(c).audiences, { segment: c.segment, tag: c.tag });
  for (const a of audience) {
    try {
      await sendEmail(a.email, c.subject, c.body);
      await db.insert(campaignRecipients).values({ campaignId: c.id, tenantId: a.tenantId, email: a.email, status: 'sent' });
    } catch {
      await db.insert(campaignRecipients).values({ campaignId: c.id, tenantId: a.tenantId, email: a.email, status: 'failed' });
    }
  }
  await db.update(emailCampaigns).set({ status: 'sent', recipientCount: audience.length, sentAt: new Date(), updatedAt: new Date() }).where(eq(emailCampaigns.id, c.id));
  return audience.length;
}

// Called by the worker tick: send any scheduled campaigns whose time has come.
export async function processDueCampaigns(now = new Date()): Promise<{ sent: number; recipients: number }> {
  const due = await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.status, 'scheduled'), isNotNull(emailCampaigns.scheduledAt), lte(emailCampaigns.scheduledAt, now)));
  let recipients = 0;
  for (const c of due) {
    try { recipients += await deliverCampaign(c); }
    catch (err) { logger.error({ err, campaign: c.id }, 'scheduled campaign send failed'); }
  }
  if (due.length) logger.info({ sent: due.length, recipients }, 'processed scheduled campaigns');
  return { sent: due.length, recipients };
}

// ---- Campaigns ----
campaignsRouter.get('/campaigns', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const rows = await db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt));
  res.json({ campaigns: rows.map(view) });
});

// Expose the audience catalogue so the admin UI can render the group checkboxes.
campaignsRouter.get('/campaigns-meta', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  res.json({ audiences: AUDIENCES });
});

const campaignSchema = z.object({
  name: z.string().min(1).max(160),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(200000), // rich HTML can be large
  format: z.enum(['html', 'text']).default('html'),
  audiences: z.array(z.enum(AUDIENCE_KEYS)).min(1).max(AUDIENCES.length),
  scheduledAt: z.string().datetime().nullable().optional(), // ISO; when set → scheduled
  // Legacy single-segment support (optional).
  segment: z.enum(SEGMENTS).optional(),
  tag: z.string().max(60).optional(),
});
campaignsRouter.post('/campaigns', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = campaignSchema.parse(req.body);
  const when = b.scheduledAt ? new Date(b.scheduledAt) : null;
  const status = when ? 'scheduled' : 'draft';
  const [row] = await db.insert(emailCampaigns).values({
    name: b.name, subject: b.subject, body: b.body, format: b.format,
    audiences: b.audiences as any, segment: b.segment ?? 'all', tag: b.tag ?? null,
    scheduledAt: when, status, createdBy: req.auth!.sub,
  }).returning();
  await audit({ action: 'crm.campaign.created', actorId: req.auth!.sub, metadata: { name: b.name, audiences: b.audiences, scheduled: !!when }, req });
  res.status(201).json({ campaign: view(row) });
});

// Edit a draft or scheduled campaign (a sent one is locked).
const campaignPatchSchema = campaignSchema.partial();
campaignsRouter.put('/campaigns/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Campaign not found');
  if (c.status === 'sent') throw new AppError(409, 'already_sent', 'A sent campaign cannot be edited');
  const b = campaignPatchSchema.parse(req.body);
  const set: any = { updatedAt: new Date() };
  for (const k of ['name', 'subject', 'body', 'format', 'tag'] as const) if (b[k] !== undefined) set[k] = b[k];
  if (b.audiences !== undefined) set.audiences = b.audiences as any;
  if (b.scheduledAt !== undefined) { set.scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null; set.status = b.scheduledAt ? 'scheduled' : 'draft'; }
  const [row] = await db.update(emailCampaigns).set(set).where(eq(emailCampaigns.id, c.id)).returning();
  await audit({ action: 'crm.campaign.updated', actorId: req.auth!.sub, metadata: { id: c.id }, req });
  res.json({ campaign: view(row) });
});

campaignsRouter.get('/campaigns/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Campaign not found');
  const recips = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id)).orderBy(desc(campaignRecipients.sentAt)).limit(50);
  res.json({ campaign: view(c), recipients: recips.map((r) => ({ email: r.email, status: r.status, sentAt: r.sentAt })) });
});

// Preview the audience size + a sample, without sending. Accepts either a saved
// campaign's id, or an ad-hoc { audiences } body so the editor can preview live.
campaignsRouter.post('/campaigns/:id/audience', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  let audienceKeys: string[] | undefined; let legacy: any;
  if (req.params.id === 'preview') {
    audienceKeys = Array.isArray(req.body?.audiences) ? req.body.audiences : [];
  } else {
    const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).limit(1);
    if (!c) throw new AppError(404, 'not_found', 'Campaign not found');
    audienceKeys = view(c).audiences; legacy = { segment: c.segment, tag: c.tag };
  }
  const audience = await resolveAudiences(audienceKeys ?? [], legacy);
  res.json({ count: audience.length, sample: audience.slice(0, 5).map((a) => a.email) });
});

// Send now — records each recipient and dispatches via the email adapter.
campaignsRouter.post('/campaigns/:id/send', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Campaign not found');
  if (c.status === 'sent') throw new AppError(409, 'already_sent', 'This campaign has already been sent');
  const sent = await deliverCampaign(c);
  const [updated] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id)).limit(1);
  await audit({ action: 'crm.campaign.sent', actorId: req.auth!.sub, metadata: { name: c.name, recipients: sent }, req });
  res.json({ campaign: view(updated), sent });
});

// Manually process any due scheduled campaigns (the worker also does this on its tick).
campaignsRouter.post('/campaigns/process-due', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const r = await processDueCampaigns(new Date());
  res.json(r);
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
