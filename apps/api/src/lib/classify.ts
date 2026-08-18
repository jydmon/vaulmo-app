import { CATALOGUE, type DocumentTypeDef } from './catalogue';

export interface Classification {
  typeKey: string | null;
  confidence: number; // 0..1
  ranked: { key: string; name: string; score: number }[];
}

// Rule-based, explainable classifier over OCR text. Counts distinct keyword hits
// per document type and picks the strongest. Deliberately transparent so accuracy
// can be MONITORED and audited during internal alpha; an ML model can slot in
// behind this same interface later.
export function classify(text: string, country = 'GB'): Classification {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const scored = CATALOGUE.filter((t) => t.countries.includes('GLOBAL') || t.countries.includes(country))
    .map((t: DocumentTypeDef) => {
      let score = 0;
      for (const kw of t.keywords) if (hay.includes(kw.toLowerCase())) score += 1;
      return { key: t.key, name: t.name, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) return { typeKey: null, confidence: 0, ranked: scored.slice(0, 4) };

  // Confidence: grows with hits and with separation from the runner-up.
  const second = scored[1]?.score ?? 0;
  const base = Math.min(0.5 + 0.15 * top.score, 0.95);
  const separation = top.score > second ? 0.05 : -0.15;
  const confidence = Math.max(0, Math.min(0.99, base + separation));
  return { typeKey: top.key, confidence: Number(confidence.toFixed(2)), ranked: scored.slice(0, 4) };
}
