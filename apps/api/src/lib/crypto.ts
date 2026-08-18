import crypto from 'node:crypto';

// AES-256-GCM encryption for tokens/secrets at rest (Phase 9 token encryption).
// The key comes from env ENCRYPTION_KEY (32 bytes, base64 or hex). A dev default is
// provided so the sandbox runs; production MUST set a real key from the secret store.
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? 'ZGV2LW9ubHktMzItYnl0ZS1lbmNyeXB0aW9uLWtleTEy'; // 32 bytes b64 (dev only)
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) return crypto.createHash('sha256').update(raw).digest(); // derive 32 bytes
  return buf;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const [ivB, tagB, dataB] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}

// True if a string looks like our AES-GCM ciphertext (iv.tag.data, all base64).
export function isEncrypted(v: string): boolean {
  return /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(v) && v.split('.').length === 3;
}
// Decrypt if it's ciphertext, otherwise return as-is (tolerates pre-encryption rows).
export function decryptMaybe(v: string | null | undefined): string | null {
  if (!v) return null;
  try { return isEncrypted(v) ? decrypt(v) : v; } catch { return v; }
}
