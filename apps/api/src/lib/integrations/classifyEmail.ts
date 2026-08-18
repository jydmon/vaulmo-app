import { parseDate } from '../dates';
import type { RawEmail } from './provider';

// Email classification + extraction (Phase 10). Rule-based and explainable so accuracy
// can be monitored; a model can replace the classifier behind this interface.
export type DetectedType = 'travel' | 'ticket' | 'purchase' | 'warranty' | 'subscription' | 'other';

export interface Detection {
  type: DetectedType;
  extracted: Record<string, unknown>;
}

function money(text: string): string | null {
  const m = text.match(/[£$€]\s?[0-9][0-9,]*(?:\.[0-9]{2})?/);
  return m ? m[0].replace(/\s/g, '') : null;
}
function firstDate(text: string): string | null {
  const m = text.match(/\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/);
  return m ? parseDate(m[0]) : null;
}

export function classifyEmail(email: RawEmail): Detection {
  const t = `${email.subject}\n${email.body}`;
  const l = t.toLowerCase();

  if (/(flight|boarding|departs?|airline|\bba\d|booking reference)/.test(l) && /(flight|depart|airport|lhr|jfk|to )/.test(l)) {
    const flight = t.match(/\b([A-Z]{2}\d{2,4})\b/)?.[1];
    const route = t.match(/\(([A-Z]{3})\).*?\(([A-Z]{3})\)/);
    return { type: 'travel', extracted: { kind: 'flight', flightNo: flight, from: route?.[1], to: route?.[2], date: firstDate(t), reference: t.match(/reference[:\s]*([A-Z0-9]{5,8})/i)?.[1] } };
  }
  if (/(hotel|reservation|check-?in|check-?out)/.test(l)) {
    return { type: 'travel', extracted: { kind: 'hotel', name: email.subject.replace(/.*—\s*/, ''), checkIn: firstDate(email.body), reference: t.match(/reservation[:\s#]*([A-Z0-9]{4,8})/i)?.[1] } };
  }
  if (/(e-?ticket|event|venue|seat)/.test(l)) {
    return { type: 'ticket', extracted: { event: t.match(/event[:\s]*([^\n]{2,40})/i)?.[1]?.trim(), venue: t.match(/venue[:\s]*([^\n]{2,40})/i)?.[1]?.trim(), date: firstDate(t), seat: t.match(/seat[:\s]*([A-Z0-9]{1,5})/i)?.[1] } };
  }
  // Purchase/receipt is checked BEFORE a bare warranty, because a receipt that mentions
  // a warranty is still a purchase (it just also carries a warranty date).
  if (/(order|receipt|purchase|invoice|total)/.test(l)) {
    return { type: 'purchase', extracted: { merchant: email.from.split('@')[1]?.split('.')[0], item: t.match(/(?:order|receipt)[^\n]*?[—-]\s*([^\n]{2,40})/i)?.[1]?.trim() ?? email.subject.replace(/.*[—-]\s*/, ''), amount: money(t), date: firstDate(t), order: t.match(/#?([A-Z]?\d{3,7})/)?.[1], warrantyExpiry: /warranty/i.test(l) ? firstDate((t.match(/expires?[^\n]*/i) ?? [''])[0]) : null } };
  }
  if (/(warranty|guarantee)/.test(l)) {
    return { type: 'warranty', extracted: { product: t.match(/(?:for|:)\s*([A-Z][\w" ]{3,40})/)?.[1]?.trim(), expiry: firstDate((t.match(/expires?[^\n]*/i) ?? [''])[0]) ?? firstDate(t), merchant: email.from.split('@')[1]?.split('.')[0] } };
  }
  if (/(membership|subscription|monthly payment|next billing)/.test(l)) {
    return { type: 'subscription', extracted: { name: email.from.split('@')[1]?.split('.')[0], amount: money(t), cycle: /month/i.test(l) ? 'monthly' : 'annual', renewalDate: firstDate((t.match(/next billing[^\n]*/i) ?? [''])[0]) ?? firstDate(t) } };
  }
  return { type: 'other', extracted: {} };
}
