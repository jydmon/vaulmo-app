import { db } from '../db/client';
import { auditLogs } from '../db/schema';
import { logger } from '../logger';
import type { Request } from 'express';

// Append-only audit log writer. Every security-relevant event flows through here.
// A failure to audit is logged loudly but never silently swallowed.
export interface AuditInput {
  action: string;
  actorId?: string | null;
  tenantId?: string | null;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'failure';
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      action: input.action,
      actorId: input.actorId ?? null,
      tenantId: input.tenantId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      outcome: input.outcome ?? 'success',
      metadata: input.metadata ?? null,
      ip: input.req?.ip ?? null,
      userAgent: input.req?.get('user-agent') ?? null,
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'AUDIT WRITE FAILED');
  }
}
