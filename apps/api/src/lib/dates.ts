// Tolerant date parsing for extracted text. Returns ISO 'YYYY-MM-DD' or null.
// Assumes day-first for ambiguous numeric dates (Vaulmo is UK-first); US docs
// commonly write the month name, which is unambiguous.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // ISO: 2027-03-22
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  // 22 Mar 2027  /  22 March 2027
  m = s.match(/(\d{1,2})\s*[ .\-]\s*([A-Za-z]{3,9})\.?\s*[ .\-,]?\s*(\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return iso(+m[3], mon, +m[1]);
  }

  // Mar 22, 2027  /  March 22 2027  (US)
  m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return iso(+m[3], mon, +m[2]);
  }

  // Numeric dd/mm/yyyy or mm/dd/yyyy (day-first assumed) — also dd.mm.yyyy, dd-mm-yyyy
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    let [_, a, b, y] = m as unknown as [string, string, string, string];
    let year = +y;
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return iso(year, +b, +a); // day-first
  }
  return null;
}

export function isFutureOrToday(isoDate: string, today = new Date()): boolean {
  return new Date(isoDate + 'T00:00:00Z').getTime() >= new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
}
