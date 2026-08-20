import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';
import { logger } from '../logger';

// Live email transport (REM-09). Credentials-ready: a real SMTP transport is created
// only when SMTP_HOST is configured; otherwise `isLive` is false and callers fall back
// to the dev outbox (logged, not sent). This lets the same code run in dev/CI unchanged
// and light up the moment SMTP credentials are provided — no code change to go live.
let transporter: Transporter | null = null;

export const emailIsLive = (): boolean => !!env.SMTP_HOST;

function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // true for 465, false for 587/STARTTLS
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// Send a real email. Returns true if sent over SMTP, false if no transport is configured
// (so the caller can record the dev-outbox fallback). Never throws to the caller — a
// delivery failure is logged and reported as not-sent so it can't break a request.
export async function sendMail(to: string, subject: string, body: string): Promise<boolean> {
  const tx = getTransport();
  if (!tx) return false;
  try {
    const isHtml = /<[a-z][\s\S]*>/i.test(body);
    await tx.sendMail({ from: env.EMAIL_FROM, to, subject, ...(isHtml ? { html: body } : { text: body }) });
    logger.info({ channel: 'email', to, subject }, 'EMAIL sent (SMTP)');
    return true;
  } catch (e) {
    logger.error({ channel: 'email', to, err: (e as Error).message }, 'EMAIL send failed');
    return false;
  }
}
