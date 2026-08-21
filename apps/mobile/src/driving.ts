// Driving-charge alerts (UK ULEZ/CAZ/congestion/toll + Western LEZs).
// Uses background location updates + an inside-zone check (rather than native geofencing,
// which caps at ~20 regions) so it scales to the whole catalogue and works across borders.
// Everything is cached to disk so the background task runs without a network round-trip.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';
import { Platform, Linking } from 'react-native';
import { api } from './api';

const TASK = 'vaulmo-driving-zones';
const DIR = FileSystem.documentDirectory + 'driving/';
const ZONES_F = DIR + 'zones.json';
const PROFILE_F = DIR + 'profile.json';
const INSIDE_F = DIR + 'inside.json';

// Show alerts even when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function ensureDir() { try { await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); } catch { /* exists */ } }
async function readJson<T>(f: string, fallback: T): Promise<T> { try { return JSON.parse(await FileSystem.readAsStringAsync(f)); } catch { return fallback; } }
async function writeJson(f: string, v: any) { try { await ensureDir(); await FileSystem.writeAsStringAsync(f, JSON.stringify(v)); } catch { /* ignore */ } }

function distKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, tr = (d: number) => (d * Math.PI) / 180;
  const dLat = tr(bLat - aLat), dLng = tr(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(aLat)) * Math.cos(tr(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function money(amount: number, currency: string) {
  const sym: any = { GBP: '£', EUR: '€', SEK: 'kr', NOK: 'kr', DKK: 'kr' };
  const v = (amount / 100).toFixed(amount % 100 === 0 ? 0 : 2);
  return ['SEK', 'NOK', 'DKK'].includes(currency) ? `${v} ${sym[currency]}` : `${sym[currency] || ''}${v}`;
}
export function chargeFor(zone: any, compliant: boolean) { return zone.compliantFree && compliant ? 0 : zone.amount; }

// Is a no-parking window active right now? (schedule.start–end on the listed days; days
// null/empty = every day; windows may wrap past midnight.)
export function inNoParkWindow(schedule: any, now = new Date()): boolean {
  if (!schedule || !schedule.start || !schedule.end) return true; // no schedule = always restricted
  const days = schedule.days;
  if (Array.isArray(days) && days.length && !days.includes(now.getDay())) return false;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const cur = now.getHours() * 60 + now.getMinutes(), start = toMin(schedule.start), end = toMin(schedule.end);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

// Build the alert (title/body/amount) for a zone the driver just entered.
export function alertFor(zone: any, compliant: boolean, now = new Date()): { body: string; amount: number } {
  if (zone.type === 'noparking') {
    if (inNoParkWindow(zone.schedule, now)) {
      const fine = zone.amount ? ` (fines around ${money(zone.amount, zone.currency)})` : '';
      const until = zone.schedule?.end ? ` It’s free from ${zone.schedule.end}.` : '';
      return { body: `No parking here right now — move your car or you may get a ticket${fine}.${until}`, amount: zone.amount };
    }
    const from = zone.schedule?.start ? ` until ${zone.schedule.start}` : '';
    return { body: `You can park here now — it’s free${from}.`, amount: 0 };
  }
  const c = chargeFor(zone, compliant), per = zone.unit === 'day' ? 'per day' : 'per trip';
  if (zone.type === 'toll') return { body: `Toll ahead — about ${money(zone.amount, zone.currency)} ${per}.`, amount: zone.amount };
  if (c === 0) return { body: `Your vehicle meets the standards here — no charge expected.`, amount: 0 };
  if (zone.compliantFree) return { body: `Your vehicle may not meet the standards here — around ${money(c, zone.currency)} ${per} (or a fine).`, amount: c };
  return { body: `Charge applies — about ${money(c, zone.currency)} ${per}.`, amount: c };
}

// Background task: detect newly-entered zones from the latest fix and notify once each.
TaskManager.defineTask(TASK, async ({ data, error }: any) => {
  if (error) return;
  const loc = data?.locations?.[data.locations.length - 1];
  if (!loc) return;
  const { latitude, longitude } = loc.coords;
  const zones = await readJson<any[]>(ZONES_F, []);
  const profile = await readJson<any>(PROFILE_F, { compliant: false, vehicleLabel: '' });
  const wasInside = await readJson<string[]>(INSIDE_F, []);
  const nowInside = zones.filter((z) => distKm(latitude, longitude, z.lat, z.lng) <= z.radiusM / 1000).map((z) => z.key);
  for (const key of nowInside.filter((k) => !wasInside.includes(k))) {
    const z = zones.find((x) => x.key === key); if (!z) continue;
    const a = alertFor(z, !!profile.compliant);
    try {
      await Notifications.scheduleNotificationAsync({ content: { title: z.name, body: a.body + (z.type !== 'noparking' && profile.vehicleLabel ? ` — ${profile.vehicleLabel}` : ''), sound: true }, trigger: null });
    } catch { /* ignore */ }
    try { await api.logDrivingAlert({ zoneKey: z.key, zoneName: z.name, vehicleLabel: profile.vehicleLabel || undefined, amount: a.amount, currency: z.currency }); } catch { /* offline — best effort */ }
  }
  await writeJson(INSIDE_F, nowInside);
});

export async function isDrivingEnabled(): Promise<boolean> {
  try { return await Location.hasStartedLocationUpdatesAsync(TASK); } catch { return false; }
}

// Refresh the cached zones (nearest to the user) + vehicle-compliance profile.
export async function refreshDrivingData(): Promise<{ zones: number; vehicles: number; profile: any }> {
  let lat: number | undefined, lng: number | undefined;
  try { const p = (await Location.getLastKnownPositionAsync()) || (await Location.getCurrentPositionAsync({})); lat = p?.coords.latitude; lng = p?.coords.longitude; } catch { /* no fix yet */ }
  let zones: any[] = [], vehicles: any[] = [];
  try { const zr = await api.drivingZones(lat, lng, 150); zones = (zr.zones || []).map((z: any) => ({ key: z.key, name: z.name, lat: z.lat, lng: z.lng, radiusM: z.radiusM, amount: z.amount, currency: z.currency, unit: z.unit, compliantFree: z.compliantFree, type: z.type, schedule: z.schedule ?? null })); await writeJson(ZONES_F, zones); } catch { /* keep old cache */ }
  try { const vr = await api.drivingVehicles(); vehicles = vr.vehicles || []; } catch { /* ignore */ }
  // Multi-vehicle: use the first vehicle for the label; treat as non-compliant unless it's marked compliant (so we err toward warning).
  const primary = vehicles[0];
  const profile = { compliant: primary ? primary.compliant === true : false, vehicleLabel: primary ? (primary.registration ? `${primary.name} (${primary.registration})` : primary.name) : '' };
  await writeJson(PROFILE_F, profile);
  return { zones: zones.length, vehicles: vehicles.length, profile };
}

export async function enableDrivingAlerts(): Promise<{ ok: boolean; reason?: string }> {
  if (Platform.OS === 'web') return { ok: false, reason: 'Driving alerts are only available on the mobile app.' };
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { ok: false, reason: 'Location access is needed to alert you about charge zones.' };
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return { ok: false, reason: 'Please set location to “Always” so we can alert you while driving even when the app is closed.' };
  try { const np = await Notifications.getPermissionsAsync(); if (np.status !== 'granted') await Notifications.requestPermissionsAsync(); } catch { /* ignore */ }
  await refreshDrivingData();
  await writeJson(INSIDE_F, []);
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 400,
    deferredUpdatesInterval: 60000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'Vaulmo driving alerts',
      notificationBody: 'Watching for ULEZ, congestion and toll zones',
      notificationColor: '#2563EB',
    },
  });
  return { ok: true };
}

export async function disableDrivingAlerts() {
  try { if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); } catch { /* ignore */ }
}

// ---- Find parking ----
// Open the phone's maps app on a "parking near me" search (comprehensive, reliable).
export async function openParkingSearch(lat?: number, lng?: number) {
  const q = encodeURIComponent('parking');
  const ll = lat != null && lng != null ? `${lat},${lng}` : '';
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?q=${q}${ll ? `&sll=${ll}` : ''}`
    : `geo:${ll || '0,0'}?q=${q}`;
  try { await Linking.openURL(url); }
  catch { try { await Linking.openURL(`https://www.google.com/maps/search/parking${ll ? `/@${ll},15z` : ''}`); } catch { /* ignore */ } }
}

// Best-effort in-app list of nearby car parks (free ones flagged) from OpenStreetMap.
// Returns [] on any failure so the UI can just show the "open maps" button.
export async function nearbyParking(lat: number, lng: number): Promise<{ name: string; free: boolean; distanceKm: number; lat: number; lng: number }[]> {
  try {
    const radius = 1500;
    const q = `[out:json][timeout:8];(node["amenity"="parking"](around:${radius},${lat},${lng});way["amenity"="parking"](around:${radius},${lat},${lng}););out center 40;`;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: q, signal: ctrl.signal as any });
    clearTimeout(to);
    if (!res.ok) return [];
    const j: any = await res.json();
    return (j.elements || []).map((e: any) => {
      const la = e.lat ?? e.center?.lat, ln = e.lon ?? e.center?.lon; if (la == null) return null;
      const t = e.tags || {};
      const free = t.fee === 'no' || t.fee === 'free' || t.parking === 'free';
      const name = t.name || (t.parking ? `${String(t.parking).replace(/_/g, ' ')} parking` : 'Car park');
      return { name, free, lat: la, lng: ln, distanceKm: Math.round(distKm(lat, lng, la, ln) * 10) / 10 };
    }).filter(Boolean).sort((a: any, b: any) => a.distanceKm - b.distanceKm).slice(0, 15);
  } catch { return []; }
}

// Current location helper for the parking search (best-effort).
export async function currentLatLng(): Promise<{ lat?: number; lng?: number }> {
  try { const p = (await Location.getLastKnownPositionAsync()) || (await Location.getCurrentPositionAsync({})); return { lat: p?.coords.latitude, lng: p?.coords.longitude }; } catch { return {}; }
}
