import { Router, raw } from 'express';
import { parseEvent, handleEvent } from '../../lib/billing/service';
import { logger } from '../../logger';

// Stripe webhook — UNAUTHENTICATED (Stripe calls it) and needs the RAW body for
// signature verification. Mounted before the JSON body parser. Idempotent.
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post('/webhook', raw({ type: '*/*' }), async (req, res) => {
  const signature = req.get('stripe-signature') ?? '';
  let event;
  try {
    event = parseEvent(req.body as Buffer, signature);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Stripe webhook signature rejected');
    res.status(400).json({ error: 'invalid_signature' });
    return;
  }
  try {
    const action = await handleEvent(event);
    res.json({ received: true, action });
  } catch (e) {
    logger.error({ err: e }, 'Stripe webhook processing failed');
    res.status(500).json({ error: 'processing_failed' });
  }
});
