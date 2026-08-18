import { byKey, type DocumentTypeDef } from './catalogue';
import { parseDate } from './dates';

export interface ExtractedField {
  key: string;
  label: string;
  type: 'date' | 'string' | 'number';
  value: string | null; // normalised (dates → ISO)
  raw: string | null; // as seen in the text
  confidence: number; // 0..1 (present=higher)
}

export interface ReminderCandidate {
  kind: 'expiry' | 'renewal';
  title: string;
  dueDate: string; // ISO
  fieldKey: string;
}

export interface Extraction {
  fields: ExtractedField[];
  metadata: Record<string, string>; // fieldKey → value
  reminderCandidates: ReminderCandidate[];
}

const DATE_FIELDS_TO_KIND: Record<string, 'expiry' | 'renewal'> = {
  expiryDate: 'expiry',
  renewalDate: 'renewal',
  endDate: 'renewal',
};

// Extract the metadata for a classified document type from OCR text.
export function extract(text: string, typeKey: string): Extraction {
  const def = byKey(typeKey);
  const fields: ExtractedField[] = [];
  const metadata: Record<string, string> = {};
  const reminderCandidates: ReminderCandidate[] = [];
  if (!def) return { fields, metadata, reminderCandidates };

  for (const f of def.fields) {
    let raw: string | null = null;
    for (const p of f.patterns ?? []) {
      const m = text.match(p);
      if (m && m[1]) {
        raw = m[1].trim().replace(/\s+/g, ' ');
        break;
      }
    }
    let value = raw;
    if (raw && f.type === 'date') value = parseDate(raw);

    const confidence = value ? (f.type === 'date' ? 0.9 : 0.8) : 0;
    fields.push({ key: f.key, label: f.label, type: f.type, value, raw, confidence });
    if (value) metadata[f.key] = value;

    // Build a DRAFT reminder candidate from date fields (NOT yet live).
    if (value && f.type === 'date' && DATE_FIELDS_TO_KIND[f.key]) {
      reminderCandidates.push({
        kind: DATE_FIELDS_TO_KIND[f.key],
        title: `${def.name} ${DATE_FIELDS_TO_KIND[f.key] === 'expiry' ? 'expires' : 'renews'}`,
        dueDate: value,
        fieldKey: f.key,
      });
    }
  }
  return { fields, metadata, reminderCandidates };
}

export function requiredFieldsPresent(typeKey: string, metadata: Record<string, string>): boolean {
  const def: DocumentTypeDef | undefined = byKey(typeKey);
  if (!def) return false;
  return def.fields.filter((f) => f.required).every((f) => !!metadata[f.key]);
}
