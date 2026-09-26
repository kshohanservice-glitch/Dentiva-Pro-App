// Dentiva Pro — decimal-safe money (integer paisa end-to-end).

export const PAISA_PER_BDT = 100;

/** Parse a user-entered BDT amount string into integer paisa. Returns null if invalid. */
export function parseBdtToPaisa(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[৳,\s]/g, '').replace(/BDT/gi, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paisa = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10) * (s.startsWith('-') ? -1 : 1);
  return Number.isSafeInteger(paisa) ? paisa : null;
}

/** Format integer paisa as "৳ 1,250.00". */
export function formatBdt(paisa: number | null | undefined, opts?: { symbol?: boolean }): string {
  const v = paisa ?? 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sym = opts?.symbol === false ? '' : '৳ ';
  return `${sign}${sym}${grouped}.${frac}`;
}

/** Format paisa for compact display, e.g. "৳1.25k". */
export function formatBdtCompact(paisa: number | null | undefined): string {
  const v = paisa ?? 0;
  const bdt = v / 100;
  const abs = Math.abs(bdt);
  if (abs >= 100000) return `৳${(bdt / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `৳${(bdt / 1000).toFixed(1)}k`;
  return formatBdt(v);
}

export function addPaisa(...vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0);
}

/** Percentage discount in paisa, rounded half-up. pct in 0..100. */
export function percentOfPaisa(totalPaisa: number, pct: number): number {
  return Math.round((totalPaisa * pct) / 100);
}
