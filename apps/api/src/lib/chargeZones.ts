// Seed data for UK & Western driving-charge zones. Coordinates are approximate zone
// centres and the radii are rough circular geofences (real boundaries are irregular);
// charges are indicative and change over time — this table is server-driven so an admin
// can correct any value without shipping a new app build.
//
// Only zones that can charge (or fine) a PRIVATE CAR are included, so we don't alert
// drivers about class-C/B Clean Air Zones where cars are exempt (Bath, Sheffield,
// Bradford, Portsmouth, Tyneside, etc.).
//
// type:           ulez | caz | lez | congestion | toll
// compliantFree:  true  = an emission-compliant car pays nothing (ULEZ/CAZ/LEZ)
//                 false = every car pays (congestion charges & tolls)
// amount:         minor units (pence / cents / öre) of the charge, or — for access-only
//                 LEZs abroad — the indicative fine a non-compliant car risks.

export interface ChargeZoneSeed {
  key: string; name: string; country: string; type: string;
  lat: number; lng: number; radiusM: number;
  amount: number; currency: string; unit: string; compliantFree: boolean;
  hours?: string; infoUrl?: string;
}

export const CHARGE_ZONES: ChargeZoneSeed[] = [
  // ---- United Kingdom ----
  { key: 'uk_london_ulez', name: 'London ULEZ', country: 'GB', type: 'ulez', lat: 51.5074, lng: -0.1278, radiusM: 19000, amount: 1250, currency: 'GBP', unit: 'day', compliantFree: true, hours: '24/7', infoUrl: 'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone' },
  { key: 'uk_london_cc', name: 'London Congestion Charge', country: 'GB', type: 'congestion', lat: 51.5127, lng: -0.1265, radiusM: 3200, amount: 1500, currency: 'GBP', unit: 'day', compliantFree: false, hours: 'Mon–Fri 7am–6pm, weekends 12–6pm', infoUrl: 'https://tfl.gov.uk/modes/driving/congestion-charge' },
  { key: 'uk_birmingham_caz', name: 'Birmingham Clean Air Zone', country: 'GB', type: 'caz', lat: 52.4796, lng: -1.9026, radiusM: 2500, amount: 800, currency: 'GBP', unit: 'day', compliantFree: true, hours: '24/7', infoUrl: 'https://www.breathe.org.uk' },
  { key: 'uk_bristol_caz', name: 'Bristol Clean Air Zone', country: 'GB', type: 'caz', lat: 51.4545, lng: -2.5879, radiusM: 2200, amount: 900, currency: 'GBP', unit: 'day', compliantFree: true, hours: '24/7', infoUrl: 'https://www.cleanairforbristol.org' },
  { key: 'uk_dartford', name: 'Dartford Crossing (Dart Charge)', country: 'GB', type: 'toll', lat: 51.4640, lng: 0.2597, radiusM: 2500, amount: 250, currency: 'GBP', unit: 'trip', compliantFree: false, hours: 'Charged 6am–10pm', infoUrl: 'https://www.gov.uk/pay-dartford-crossing-charge' },
  { key: 'uk_m6toll', name: 'M6 Toll', country: 'GB', type: 'toll', lat: 52.6100, lng: -1.8500, radiusM: 9000, amount: 860, currency: 'GBP', unit: 'trip', compliantFree: false, hours: 'Varies by time of day', infoUrl: 'https://www.m6toll.co.uk' },
  { key: 'uk_tyne_tunnel', name: 'Tyne Tunnel', country: 'GB', type: 'toll', lat: 55.0060, lng: -1.4700, radiusM: 2000, amount: 210, currency: 'GBP', unit: 'trip', compliantFree: false, infoUrl: 'https://www.tt2.co.uk' },
  { key: 'uk_mersey_tunnels', name: 'Mersey Tunnels', country: 'GB', type: 'toll', lat: 53.4084, lng: -3.0100, radiusM: 3000, amount: 210, currency: 'GBP', unit: 'trip', compliantFree: false, infoUrl: 'https://www.merseyflow.co.uk' },

  // ---- Rest of Western Europe (indicative) ----
  { key: 'ie_dublin_m50', name: 'M50 eFlow Toll (Dublin)', country: 'IE', type: 'toll', lat: 53.3900, lng: -6.3800, radiusM: 12000, amount: 320, currency: 'EUR', unit: 'trip', compliantFree: false, infoUrl: 'https://www.eflow.ie' },
  { key: 'it_milan_areac', name: 'Milan Area C', country: 'IT', type: 'congestion', lat: 45.4642, lng: 9.1900, radiusM: 1800, amount: 750, currency: 'EUR', unit: 'day', compliantFree: false, hours: 'Mon–Fri 7:30am–7:30pm', infoUrl: 'https://www.comune.milano.it/aree-tematiche/mobilita/area-c' },
  { key: 'it_milan_areab', name: 'Milan Area B (LEZ)', country: 'IT', type: 'lez', lat: 45.4642, lng: 9.1900, radiusM: 8000, amount: 8900, currency: 'EUR', unit: 'day', compliantFree: true, hours: 'Mon–Fri daytime', infoUrl: 'https://www.comune.milano.it' },
  { key: 'fr_paris_zfe', name: 'Paris ZFE (Crit’Air)', country: 'FR', type: 'lez', lat: 48.8566, lng: 2.3522, radiusM: 12000, amount: 6800, currency: 'EUR', unit: 'day', compliantFree: true, hours: 'Mon–Fri 8am–8pm', infoUrl: 'https://www.certificat-air.gouv.fr' },
  { key: 'fr_lyon_zfe', name: 'Lyon ZFE', country: 'FR', type: 'lez', lat: 45.7640, lng: 4.8357, radiusM: 7000, amount: 6800, currency: 'EUR', unit: 'day', compliantFree: true, infoUrl: 'https://www.grandlyon.com' },
  { key: 'de_berlin_umwelt', name: 'Berlin Umweltzone', country: 'DE', type: 'lez', lat: 52.5200, lng: 13.4050, radiusM: 8000, amount: 8000, currency: 'EUR', unit: 'day', compliantFree: true, hours: '24/7 — green badge required', infoUrl: 'https://www.berlin.de/umweltzone' },
  { key: 'de_munich_umwelt', name: 'Munich Umweltzone', country: 'DE', type: 'lez', lat: 48.1351, lng: 11.5820, radiusM: 6000, amount: 8000, currency: 'EUR', unit: 'day', compliantFree: true, infoUrl: 'https://www.muenchen.de' },
  { key: 'es_madrid_zbe', name: 'Madrid ZBE (Madrid 360)', country: 'ES', type: 'lez', lat: 40.4168, lng: -3.7038, radiusM: 6000, amount: 9000, currency: 'EUR', unit: 'day', compliantFree: true, infoUrl: 'https://www.madrid360.es' },
  { key: 'es_barcelona_zbe', name: 'Barcelona ZBE', country: 'ES', type: 'lez', lat: 41.3874, lng: 2.1686, radiusM: 9000, amount: 10000, currency: 'EUR', unit: 'day', compliantFree: true, infoUrl: 'https://www.zbe.barcelona' },
  { key: 'be_brussels_lez', name: 'Brussels LEZ', country: 'BE', type: 'lez', lat: 50.8503, lng: 4.3517, radiusM: 8000, amount: 15000, currency: 'EUR', unit: 'day', compliantFree: true, infoUrl: 'https://lez.brussels' },
  { key: 'be_antwerp_lez', name: 'Antwerp LEZ', country: 'BE', type: 'lez', lat: 51.2194, lng: 4.4025, radiusM: 4000, amount: 15000, currency: 'EUR', unit: 'day', compliantFree: true, infoUrl: 'https://www.slimnaarantwerpen.be' },
  { key: 'nl_amsterdam_milieu', name: 'Amsterdam Milieuzone', country: 'NL', type: 'lez', lat: 52.3676, lng: 4.9041, radiusM: 5000, amount: 10000, currency: 'EUR', unit: 'day', compliantFree: true, infoUrl: 'https://www.amsterdam.nl' },
  { key: 'se_stockholm_tax', name: 'Stockholm Congestion Tax', country: 'SE', type: 'congestion', lat: 59.3293, lng: 18.0686, radiusM: 6000, amount: 3500, currency: 'SEK', unit: 'trip', compliantFree: false, hours: 'Mon–Fri daytime', infoUrl: 'https://www.transportstyrelsen.se' },
  { key: 'se_gothenburg_tax', name: 'Gothenburg Congestion Tax', country: 'SE', type: 'congestion', lat: 57.7089, lng: 11.9746, radiusM: 5000, amount: 2200, currency: 'SEK', unit: 'trip', compliantFree: false, hours: 'Mon–Fri daytime', infoUrl: 'https://www.transportstyrelsen.se' },
  { key: 'no_oslo_ring', name: 'Oslo Toll Ring (Bomring)', country: 'NO', type: 'toll', lat: 59.9139, lng: 10.7522, radiusM: 8000, amount: 2700, currency: 'NOK', unit: 'trip', compliantFree: false, infoUrl: 'https://www.fjellinjen.no' },
  { key: 'no_bergen_ring', name: 'Bergen Toll Ring', country: 'NO', type: 'toll', lat: 60.3913, lng: 5.3221, radiusM: 6000, amount: 2900, currency: 'NOK', unit: 'trip', compliantFree: false, infoUrl: 'https://www.ferde.no' },
  { key: 'dk_copenhagen_lez', name: 'Copenhagen LEZ', country: 'DK', type: 'lez', lat: 55.6761, lng: 12.5683, radiusM: 6000, amount: 150000, currency: 'DKK', unit: 'day', compliantFree: true, infoUrl: 'https://www.miljoezoner.dk' },
];
