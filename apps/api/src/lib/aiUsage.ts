import { db } from '../db/client';
import { aiUsage } from '../db/schema';

// Records an AI usage event for cost/volume monitoring. Tokens are estimated from text
// length when a real provider isn't returning usage; cost is a rough per-token estimate.
export async function logAiUsage(o: {
  userId?: string | null;
  tenantId?: string | null;
  feature: string;
  model?: string;
  promptText?: string;
  completionText?: string;
  status?: 'success' | 'failure';
}) {
  const pt = Math.ceil((o.promptText?.length ?? 0) / 4);
  const ct = Math.ceil((o.completionText?.length ?? 0) / 4);
  const costMicros = Math.round((pt + ct) * 2); // ~$0.000002 per token
  try {
    await db.insert(aiUsage).values({
      userId: o.userId ?? null,
      tenantId: o.tenantId ?? null,
      feature: o.feature,
      model: o.model ?? 'local',
      promptTokens: pt,
      completionTokens: ct,
      costMicros,
      status: o.status ?? 'success',
    });
  } catch {
    // Never let usage logging break the request.
  }
}
