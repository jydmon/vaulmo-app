// Biometric app-lock helper (ACC-06).
//
// Vaulmo authenticates against the server (not zero-knowledge), so biometrics
// here are a *local convenience lock*: they gate whether the app auto-restores
// the already-stored session from the secure keychain. The session tokens live
// in expo-secure-store (hardware-backed keychain / keystore); Face ID or the
// fingerprint sensor decides whether we hand that session back to the UI on
// launch. Nothing about biometrics touches the server or the encryption of
// stored documents.
//
// Every native call is guarded so a web/preview build (where the module is
// unavailable) degrades gracefully to "no biometrics" rather than throwing.
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const ENABLED_KEY = 'biometric_lock_enabled';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'generic' | 'none';

export interface BiometricCapability {
  available: boolean; // hardware present AND at least one credential enrolled
  hasHardware: boolean;
  enrolled: boolean;
  kind: BiometricKind;
  label: string; // user-facing name, e.g. "Face ID", "Fingerprint"
}

const KIND_LABEL: Record<BiometricKind, string> = {
  face: 'Face ID',
  fingerprint: 'Fingerprint',
  iris: 'Iris',
  generic: 'Biometric unlock',
  none: 'Biometric unlock',
};

// What kind of biometric the device supports (best-effort; falls back to generic).
async function detectKind(): Promise<BiometricKind> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
    return types.length ? 'generic' : 'none';
  } catch {
    return 'none';
  }
}

// Inspect the device's biometric capability. Never throws.
export async function getCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, enrolled, kind] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      detectKind(),
    ]);
    const available = !!hasHardware && !!enrolled && kind !== 'none';
    return { available, hasHardware: !!hasHardware, enrolled: !!enrolled, kind, label: KIND_LABEL[kind] };
  } catch {
    return { available: false, hasHardware: false, enrolled: false, kind: 'none', label: KIND_LABEL.none };
  }
}

// Whether the user has switched the biometric lock ON (persisted preference).
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  try {
    if (on) await SecureStore.setItemAsync(ENABLED_KEY, '1');
    else await SecureStore.deleteItemAsync(ENABLED_KEY);
  } catch {
    /* no secure store (web) — preference simply isn't persisted */
  }
}

// True when we should actually gate the app on launch: the user turned the lock
// on AND the device can still satisfy it (hardware present + credential enrolled).
// If the user removed all their fingerprints/Face ID after enabling, this returns
// false so they aren't locked out of their own session.
export async function shouldLock(): Promise<boolean> {
  if (!(await isBiometricEnabled())) return false;
  return (await getCapability()).available;
}

export interface AuthOutcome { success: boolean; error?: string }

// Prompt for the biometric (with a device-passcode fallback). Never throws.
export async function authenticate(reason = 'Unlock Vaulmo'): Promise<AuthOutcome> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
    });
    return res.success ? { success: true } : { success: false, error: (res as any).error ?? 'cancelled' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'error' };
  }
}
