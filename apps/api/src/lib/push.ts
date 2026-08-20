import { env } from '../env';
import { logger } from '../logger';

// Live push delivery (REM-08) via Expo Push. The Expo push service relays to FCM
// (Android) and APNs (iOS), so the app only needs the device's Expo push token — no
// FCM/APNs handling in our backend. Credentials-ready: works as soon as devices register
// Expo tokens; an optional EXPO_ACCESS_TOKEN raises rate limits. Tokens that aren't Expo
// push tokens (e.g. a raw web token) are ignored, and if none are deliverable we return
// false so the caller records the dev-outbox fallback.
const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[/.test(t);

export async function sendExpoPush(tokens: string[], title: string, body: string): Promise<boolean> {
  const expoTokens = tokens.filter(isExpoToken);
  if (!expoTokens.length) return false;
  const messages = expoTokens.map((to) => ({ to, title, body, sound: 'default' }));
  try {
    const res = await fetch(EXPO_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.error({ channel: 'push', status: res.status }, 'PUSH send failed');
      return false;
    }
    logger.info({ channel: 'push', count: expoTokens.length, title }, 'PUSH sent (Expo)');
    return true;
  } catch (e) {
    logger.error({ channel: 'push', err: (e as Error).message }, 'PUSH send error');
    return false;
  }
}

export const pushIsLive = (): boolean => true; // Expo Push needs no server config; delivery depends on registered tokens.
