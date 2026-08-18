import crypto from 'node:crypto';
import { env } from '../../env';

// Payment gateway behind one interface. Two drivers:
//  - fake   : deterministic, no network — used for Stripe *Test Mode* dev + CI. Webhook
//             signatures are real HMAC (so signature verification is genuinely exercised).
//  - stripe : the real Stripe SDK (dynamic import), enabled by env in staging/live.
// Callers never change when flipping Stripe Test → Live; only STRIPE_DRIVER + keys do.

export interface CheckoutParams {
  customerId: string;
  priceId: string;
  tenantId: string;
  planKey: string;
  successUrl: string;
  cancelUrl: string;
}
export interface StripeEvent {
  id: string;
  type: string;
  data: any;
}
export interface Gateway {
  ensureCustomer(tenantId: string, email: string): Promise<string>;
  createProductPrice(plan: { key: string; name: string; amount: number; currency: string; interval: string }): Promise<{ productId: string; priceId: string }>;
  createCheckoutSession(p: CheckoutParams): Promise<{ url: string; sessionId: string }>;
  createBillingPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  verifyAndParseEvent(rawBody: Buffer, signature: string): StripeEvent;
}

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_dev';

function hmac(raw: Buffer | string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
}

// Exposed so tests (and a dev webhook simulator) can produce a valid signature.
export function signWebhookPayload(raw: string): string {
  return hmac(raw);
}

class FakeGateway implements Gateway {
  async ensureCustomer(tenantId: string): Promise<string> {
    return `cus_fake_${tenantId.slice(0, 12)}`;
  }
  async createProductPrice(plan: { key: string }): Promise<{ productId: string; priceId: string }> {
    return { productId: `prod_fake_${plan.key}`, priceId: `price_fake_${plan.key}` };
  }
  async createCheckoutSession(p: CheckoutParams): Promise<{ url: string; sessionId: string }> {
    const sessionId = `cs_fake_${crypto.randomUUID().slice(0, 12)}`;
    // In real Stripe this is a hosted URL. Here it's a marker the client can complete
    // in dev; completion is simulated by the checkout.session.completed webhook.
    return { url: `https://checkout.stripe.test/${sessionId}?plan=${p.planKey}`, sessionId };
  }
  async createBillingPortal(customerId: string): Promise<{ url: string }> {
    return { url: `https://billing.stripe.test/portal/${customerId}` };
  }
  verifyAndParseEvent(rawBody: Buffer, signature: string): StripeEvent {
    const expected = hmac(rawBody);
    // constant-time comparison
    const ok = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) throw new Error('invalid_signature');
    return JSON.parse(rawBody.toString('utf8'));
  }
}

// Real Stripe driver — dynamically imports the SDK so the package is only needed
// where STRIPE_DRIVER=stripe. Interface-compatible with the fake.
class StripeGateway implements Gateway {
  private stripe: any;
  private async sdk() {
    if (!this.stripe) {
      const spec = 'stripe'; // non-literal so TS doesn't require the optional dep at build time
      const mod: any = await import(spec).catch(() => {
        throw new Error("The 'stripe' package is required for STRIPE_DRIVER=stripe (npm i stripe)");
      });
      this.stripe = new mod.default(process.env.STRIPE_SECRET_KEY);
    }
    return this.stripe;
  }
  async ensureCustomer(tenantId: string, email: string): Promise<string> {
    const s = await this.sdk();
    const c = await s.customers.create({ email, metadata: { tenantId } });
    return c.id;
  }
  async createProductPrice(plan: { key: string; name: string; amount: number; currency: string; interval: string }) {
    const s = await this.sdk();
    const product = await s.products.create({ name: plan.name, metadata: { key: plan.key } });
    const price = await s.prices.create({ product: product.id, unit_amount: plan.amount, currency: plan.currency, recurring: { interval: plan.interval } });
    return { productId: product.id, priceId: price.id };
  }
  async createCheckoutSession(p: CheckoutParams) {
    const s = await this.sdk();
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: p.customerId,
      line_items: [{ price: p.priceId, quantity: 1 }],
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      metadata: { tenantId: p.tenantId, planKey: p.planKey },
      subscription_data: { metadata: { tenantId: p.tenantId, planKey: p.planKey } },
    });
    return { url: session.url, sessionId: session.id };
  }
  async createBillingPortal(customerId: string, returnUrl: string) {
    const s = await this.sdk();
    const portal = await s.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: portal.url };
  }
  verifyAndParseEvent(rawBody: Buffer, signature: string): StripeEvent {
    // Real signature verification requires the sync stripe SDK; kept minimal here.
    // In production use stripe.webhooks.constructEvent(rawBody, signature, secret).
    throw new Error('Use stripe.webhooks.constructEvent in the live handler');
  }
}

export function getGateway(): Gateway {
  return (process.env.STRIPE_DRIVER ?? 'fake') === 'stripe' ? new StripeGateway() : new FakeGateway();
}
