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

/* ---------------- on-street parking ----------------
 * OpenStreetMap maps kerbside parking two ways — the current schema
 * (parking:left / parking:right / parking:both) and the legacy one
 * (parking:lane:*, parking:condition:*). We read both.
 *
 * IMPORTANT: this is community-mapped data, not a traffic authority feed. It can
 * be wrong or out of date, so every rule we surface is phrased as guidance and the
 * UI tells the user the signs and road markings win. Never present it as certainty.
 */
export type ParkingKind = 'carpark' | 'street';
export interface ParkingSpot {
  name: string; kind: ParkingKind; free: boolean; allowed: boolean;
  rule?: string;            // human sentence, e.g. "Restricted Mo-Sa 08:00-18:30 — free outside those hours"
  freeNow?: boolean | null; // null = we can't tell
  distanceKm: number; lat: number; lng: number;
}

const DAYNAME: Record<string, string> = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };
const DAYIDX: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

// Pull the "(Mo-Sa 08:00-18:30)" part out of an OSM conditional value.
function parseWindow(cond?: string): { text: string; days: number[] | null; start?: string; end?: string } | null {
  if (!cond) return null;
  const m = /\(([^)]+)\)/.exec(cond) || [null, cond];
  const raw = String(m[1] || '').trim();
  if (!raw) return null;
  const time = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(raw);
  const dayRange = /\b(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)\b/.exec(raw);
  const singles = raw.match(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g) || [];
  let days: number[] | null = null;
  if (dayRange) {
    const a = DAYIDX[dayRange[1]], b = DAYIDX[dayRange[2]];
    days = []; for (let i = 0; i < 7; i++) { const d = (a + i) % 7; days.push(d); if (d === b) break; }
  } else if (singles.length) {
    days = singles.map((d) => DAYIDX[d]);
  }
  const readableDays = dayRange ? `${DAYNAME[dayRange[1]]}–${DAYNAME[dayRange[2]]}` : singles.map((d) => DAYNAME[d]).join(', ');
  const text = [readableDays, time ? `${time[1]}–${time[2]}` : ''].filter(Boolean).join(' ') || raw;
  return { text, days, start: time?.[1], end: time?.[2] };
}

function windowActive(w: { days: number[] | null; start?: string; end?: string }, now = new Date()): boolean | null {
  if (!w.start || !w.end) return null;
  if (w.days && w.days.length && !w.days.includes(now.getDay())) return false;
  const toMin = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  const cur = now.getHours() * 60 + now.getMinutes(), a = toMin(w.start), b = toMin(w.end);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

const NO_VALUES = ['no', 'none', 'no_parking', 'no_stopping', 'prohibited'];

// Read one kerbside (left / right / both) into a rule we can show.
function readSide(t: Record<string, string>, side: string): { allowed: boolean; free: boolean; rule: string; freeNow: boolean | null } | null {
  const value = t[`parking:${side}`] ?? t[`parking:lane:${side}`];
  if (!value) return null;
  const restriction = t[`parking:${side}:restriction`] ?? t[`parking:condition:${side}`];
  const conditional = t[`parking:${side}:restriction:conditional`] ?? t[`parking:condition:${side}:conditional`] ?? t[`parking:condition:${side}:time_interval`];
  const feeTag = t[`parking:${side}:fee`];
  const maxstay = t[`parking:${side}:maxstay`] ?? t[`parking:condition:${side}:maxstay`];

  // Hard no — double yellows, red routes, "no" lanes. No conditional means always.
  const hardNo = NO_VALUES.includes(String(value).toLowerCase())
    || (NO_VALUES.includes(String(restriction || '').toLowerCase()) && !conditional);
  if (hardNo) {
    const why = String(restriction || value).toLowerCase() === 'no_stopping' ? 'No stopping (red route)' : 'No parking (yellow lines)';
    return { allowed: false, free: false, rule: why, freeNow: false };
  }

  const win = parseWindow(conditional);
  const active = win ? windowActive(win) : null;
  const restrictedKind = String(restriction || '').toLowerCase();
  const free = feeTag === 'no' || restrictedKind === 'free' || (!feeTag && !restrictedKind && !conditional);

  let rule: string;
  if (win) {
    const label = restrictedKind === 'residents' ? 'Residents only'
      : restrictedKind === 'disc' ? 'Disc zone'
      : NO_VALUES.includes(restrictedKind) ? 'No parking'
      : feeTag === 'yes' || restrictedKind === 'ticket' ? 'Pay & display'
      : 'Restricted';
    rule = `${label} ${win.text} — free outside those hours`;
  } else if (feeTag === 'yes' || restrictedKind === 'ticket') {
    rule = 'Pay & display';
  } else if (restrictedKind === 'residents') {
    rule = 'Residents permit only';
  } else if (free) {
    rule = 'Free on-street parking';
  } else {
    rule = 'On-street parking';
  }
  if (maxstay) rule += ` · max stay ${String(maxstay).replace(/\s*hour[s]?/i, 'h')}`;

  const freeNow = win ? (active === null ? null : !active) : (free ? true : null);
  return { allowed: true, free, rule, freeNow };
}

// Best-effort in-app list of nearby car parks (free ones flagged) from OpenStreetMap.
// Returns [] on any failure so the UI can just show the "open maps" button.
export async function nearbyParking(lat: number, lng: number): Promise<ParkingSpot[]> {
  try {
    const radius = 1500;
    const q = `[out:json][timeout:12];(node["amenity"="parking"](around:${radius},${lat},${lng});way["amenity"="parking"](around:${radius},${lat},${lng});way["parking:both"](around:${radius},${lat},${lng});way["parking:left"](around:${radius},${lat},${lng});way["parking:right"](around:${radius},${lat},${lng});way["parking:lane:both"](around:${radius},${lat},${lng});way["parking:lane:left"](around:${radius},${lat},${lng});way["parking:lane:right"](around:${radius},${lat},${lng}););out center 120;`;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: q, signal: ctrl.signal as any });
    clearTimeout(to);
    if (!res.ok) return [];
    const j: any = await res.json();
    const out: ParkingSpot[] = [];
    for (const e of j.elements || []) {
      const la = e.lat ?? e.center?.lat, ln = e.lon ?? e.center?.lon;
      if (la == null) continue;
      const t: Record<string, string> = e.tags || {};
      const distanceKm = Math.round(distKm(lat, lng, la, ln) * 10) / 10;

      if (t.amenity === 'parking') {
        const free = t.fee === 'no' || t.fee === 'free' || t.parking === 'free';
        out.push({
          name: t.name || (t.parking ? `${String(t.parking).replace(/_/g, ' ')} parking` : 'Car park'),
          kind: 'carpark', free, allowed: true, freeNow: free ? true : null,
          rule: free ? 'Free car park' : 'Car park — check tariff', lat: la, lng: ln, distanceKm,
        });
        continue;
      }

      // A street: read each kerbside and keep the most permissive one.
      const sides = (['both', 'left', 'right'] as const).map((sd) => readSide(t, sd)).filter(Boolean) as NonNullable<ReturnType<typeof readSide>>[];
      if (!sides.length) continue;
      const best = sides.find((x) => x.allowed && x.freeNow === true) ?? sides.find((x) => x.allowed) ?? sides[0];
      out.push({
        name: t.name || t.ref || 'Unnamed street',
        kind: 'street', free: best.free, allowed: best.allowed, rule: best.rule,
        freeNow: best.freeNow, lat: la, lng: ln, distanceKm,
      });
    }
    // Nearest first, but never lead with a street you legally cannot park on.
    return out
      .sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.distanceKm - b.distanceKm)
      .slice(0, 25);
  } catch { return []; }
}

// Current location helper for the parking search (best-effort).
export async function currentLatLng(): Promise<{ lat?: number; lng?: number }> {
  try { const p = (await Location.getLastKnownPositionAsync()) || (await Location.getCurrentPositionAsync({})); return { lat: p?.coords.latitude, lng: p?.coords.longitude }; } catch { return {}; }
}
