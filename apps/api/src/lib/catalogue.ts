// Vaulmo document catalogue — the source of truth for document TYPES.
//
// Each type carries: the country scope, whether it's recommended (drives the
// checklist), its metadata schema (drives extraction + the confirm form), and
// classification keywords + extraction patterns for the AI pipeline (Phase 3).

export type FieldType = 'date' | 'string' | 'number';

export interface CatalogueField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  patterns?: RegExp[]; // capture group 1 = value
}

export interface DocumentTypeDef {
  key: string;
  name: string;
  category: string;
  countries: string[]; // 'GLOBAL' or ISO country codes e.g. 'GB','US'
  recommended: boolean;
  keywords: string[]; // classification signals
  fields: CatalogueField[];
  sort: number;
}

export const CATALOGUE: DocumentTypeDef[] = [
  {
    key: 'passport',
    name: 'Passport',
    category: 'Identity',
    countries: ['GLOBAL'],
    recommended: true,
    sort: 10,
    keywords: ['passport', 'passeport', 'nationality', 'type p', 'given names'],
    fields: [
      { key: 'documentNumber', label: 'Passport number', type: 'string', required: true, patterns: [/passport\s*(?:no\.?|number)[:\s]*([A-Z0-9]{6,9})/i, /\b([0-9]{9})\b/] },
      { key: 'fullName', label: 'Full name', type: 'string', patterns: [/(?:surname|name)[:\s]*([A-Z][A-Za-z'’\- ]{2,40})/] },
      { key: 'nationality', label: 'Nationality', type: 'string', patterns: [/nationality[:\s]*([A-Za-z ]{3,30})/i] },
      { key: 'expiryDate', label: 'Expiry date', type: 'date', required: true, patterns: [/(?:date of expiry|expiry|expires)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
  {
    key: 'driving_licence',
    name: 'Driving Licence',
    category: 'Identity',
    countries: ['GB'],
    recommended: true,
    sort: 20,
    keywords: ['driving licence', 'driver licence', 'dvla', 'driving license', 'entitlement'],
    fields: [
      { key: 'licenceNumber', label: 'Licence number', type: 'string', patterns: [/([A-Z9]{5}[0-9]{6}[A-Z0-9]{2,5})/] },
      { key: 'expiryDate', label: 'Valid to', type: 'date', required: true, patterns: [/(?:4b|valid to|expiry)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
  {
    key: 'drivers_license_us',
    name: "Driver's License",
    category: 'Identity',
    countries: ['US'],
    recommended: true,
    sort: 20,
    keywords: ['driver license', "driver's license", 'dmv', 'class d', 'usa'],
    fields: [
      { key: 'licenceNumber', label: 'License number', type: 'string', patterns: [/(?:dl|lic|license)[#:\s]*([A-Z0-9]{6,12})/i] },
      { key: 'expiryDate', label: 'Expiration', type: 'date', required: true, patterns: [/(?:exp|expires|expiration)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
  {
    key: 'home_insurance',
    name: 'Home Insurance',
    category: 'Insurance',
    countries: ['GLOBAL'],
    recommended: true,
    sort: 30,
    keywords: ['home insurance', 'buildings', 'contents', 'policy', 'insurer', 'homeowners'],
    fields: [
      { key: 'provider', label: 'Provider', type: 'string', patterns: [/(?:insurer|provider|underwritten by)[:\s]*([A-Z][A-Za-z& ]{2,30})/i] },
      { key: 'policyNumber', label: 'Policy number', type: 'string', required: true, patterns: [/policy\s*(?:no\.?|number)[:\s]*([A-Z0-9\-]{5,20})/i] },
      { key: 'renewalDate', label: 'Renewal date', type: 'date', required: true, patterns: [/(?:renewal|renews|expiry)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
  {
    key: 'life_insurance',
    name: 'Life Insurance',
    category: 'Insurance',
    countries: ['GLOBAL'],
    recommended: true,
    sort: 40,
    keywords: ['life insurance', 'life cover', 'beneficiary', 'sum assured', 'life policy'],
    fields: [
      { key: 'provider', label: 'Provider', type: 'string', patterns: [/(?:insurer|provider)[:\s]*([A-Z][A-Za-z& ]{2,30})/i] },
      { key: 'policyNumber', label: 'Policy number', type: 'string', required: true, patterns: [/policy\s*(?:no\.?|number)[:\s]*([A-Z0-9\-]{5,20})/i] },
      { key: 'coverAmount', label: 'Cover amount', type: 'string', patterns: [/(?:sum assured|cover(?:age)?)[:\s]*([£$€]?[0-9,]{3,12})/i] },
    ],
  },
  {
    key: 'vehicle_mot',
    name: 'MOT Certificate',
    category: 'Vehicle',
    countries: ['GB'],
    recommended: false,
    sort: 50,
    keywords: ['mot', 'test certificate', 'vt20', 'vehicle test'],
    fields: [
      { key: 'registration', label: 'Registration', type: 'string', patterns: [/([A-Z]{2}[0-9]{2}\s?[A-Z]{3})/] },
      { key: 'expiryDate', label: 'Expiry date', type: 'date', required: true, patterns: [/(?:expiry|valid until)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
  {
    key: 'health_insurance_us',
    name: 'Health Insurance',
    category: 'Health',
    countries: ['US'],
    recommended: true,
    sort: 45,
    keywords: ['health insurance', 'member id', 'group number', 'copay', 'plan'],
    fields: [
      { key: 'memberId', label: 'Member ID', type: 'string', required: true, patterns: [/member\s*id[:\s]*([A-Z0-9]{6,15})/i] },
      { key: 'provider', label: 'Provider', type: 'string', patterns: [/(?:plan|provider)[:\s]*([A-Z][A-Za-z& ]{2,30})/i] },
    ],
  },
  {
    key: 'will',
    name: 'Last Will & Testament',
    category: 'Legal',
    countries: ['GLOBAL'],
    recommended: true,
    sort: 60,
    keywords: ['last will', 'testament', 'executor', 'estate', 'bequeath'],
    fields: [
      { key: 'executor', label: 'Executor', type: 'string', patterns: [/executor[:\s]*([A-Z][A-Za-z'’\- ]{2,40})/i] },
      { key: 'dateSigned', label: 'Date signed', type: 'date', patterns: [/(?:dated|signed)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
  {
    key: 'birth_certificate',
    name: 'Birth Certificate',
    category: 'Identity',
    countries: ['GLOBAL'],
    recommended: true,
    sort: 70,
    keywords: ['birth certificate', 'registration district', 'date of birth', 'certified copy'],
    fields: [
      { key: 'fullName', label: 'Full name', type: 'string', patterns: [/name[:\s]*([A-Z][A-Za-z'’\- ]{2,40})/] },
      { key: 'dateOfBirth', label: 'Date of birth', type: 'date', patterns: [/(?:date of birth|born)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
  {
    key: 'tenancy_agreement',
    name: 'Tenancy / Mortgage',
    category: 'Property',
    countries: ['GLOBAL'],
    recommended: false,
    sort: 80,
    keywords: ['tenancy agreement', 'mortgage', 'lender', 'landlord', 'term'],
    fields: [
      { key: 'party', label: 'Lender / Landlord', type: 'string', patterns: [/(?:lender|landlord)[:\s]*([A-Z][A-Za-z& ]{2,30})/i] },
      { key: 'endDate', label: 'End / fixed until', type: 'date', patterns: [/(?:end date|fixed until|term ends)\s*(?:date)?\s*:?\s*([0-9A-Za-z\/ .\-]{6,18})/i] },
    ],
  },
];

export const byKey = (key: string): DocumentTypeDef | undefined => CATALOGUE.find((t) => t.key === key);

export function appliesToCountry(t: DocumentTypeDef, country: string): boolean {
  return t.countries.includes('GLOBAL') || t.countries.includes(country);
}

// Catalogue for a country (what the tester can add).
export function catalogueForCountry(country: string): DocumentTypeDef[] {
  return CATALOGUE.filter((t) => appliesToCountry(t, country)).sort((a, b) => a.sort - b.sort);
}

// Recommended set drives the checklist + completion score.
export function recommendedForCountry(country: string): DocumentTypeDef[] {
  return catalogueForCountry(country).filter((t) => t.recommended);
}

// The DB/API-safe schema (no regex objects).
export function publicSchema(t: DocumentTypeDef) {
  return t.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: !!f.required }));
}
