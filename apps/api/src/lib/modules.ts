// Feature modules — the building blocks a plan can include. Admins select which
// modules a plan unlocks; routes use requireModule() to enforce access.

export interface ModuleDef { key: string; name: string; description: string }

export const MODULES: ModuleDef[] = [
  { key: 'vault', name: 'Document Vault', description: 'Store, scan and upload documents.' },
  { key: 'reminders', name: 'Reminders', description: 'Automatic and custom reminders.' },
  { key: 'assistant', name: 'AI Assistant', description: 'Ask questions across your own data.' },
  { key: 'life', name: 'Life records', description: 'Trips, purchases and subscriptions.' },
  { key: 'assets', name: 'Property & Vehicles', description: 'Track assets and renewal dates.' },
  { key: 'family', name: 'Family & Access', description: 'Members, next of kin and emergency access.' },
  { key: 'integrations', name: 'Connected Services', description: 'Email import of trips, receipts and more.' },
];

export const ALL_MODULE_KEYS = MODULES.map((m) => m.key);

// A plan's effective module set. An empty/undefined list means "all modules"
// (permissive default) so legacy plans keep working until an admin curates them.
export function effectiveModules(planModules: unknown): string[] {
  const list = Array.isArray(planModules) ? planModules.filter((x) => typeof x === 'string') as string[] : [];
  return list.length ? list : ALL_MODULE_KEYS.slice();
}

// Net (discounted) price in minor units, given a base amount and discount %.
export function netAmount(amount: number, discountPercent = 0): number {
  const pct = Math.max(0, Math.min(100, Math.round(discountPercent || 0)));
  return Math.round(amount * (1 - pct / 100));
}
