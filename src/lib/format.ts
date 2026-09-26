// Dentiva Pro — date/time + text formatting helpers.

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function currentTimeHM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export type DateFormat = 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';
export type TimeFormat = '12h' | '24h';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string | null | undefined, fmt: DateFormat = 'DD MMM YYYY'): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  switch (fmt) {
    case 'YYYY-MM-DD': return `${y}-${mo}-${d}`;
    case 'MM-DD-YYYY': return `${mo}-${d}-${y}`;
    case 'DD-MM-YYYY': return `${d}-${mo}-${y}`;
    default: return `${d} ${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
  }
}

export function formatTime(hm: string | null | undefined, fmt: TimeFormat = '12h'): string {
  if (!hm) return '—';
  const m = /(\d{1,2}):(\d{2})/.exec(hm);
  if (!m) return hm;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (fmt === '24h') return `${pad2(h)}:${min}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${suffix}`;
}

export function formatDateTime(iso: string | null | undefined, df: DateFormat = 'DD MMM YYYY', tf: TimeFormat = '12h'): string {
  if (!iso) return '—';
  const [d, t] = iso.split('T');
  return `${formatDate(d, df)}${t ? `, ${formatTime(t.slice(0, 5), tf)}` : ''}`;
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function ageFromDob(dob: string | null | undefined): string {
  if (!dob) return '—';
  const b = new Date(`${dob}T12:00:00`);
  if (Number.isNaN(b.getTime())) return '—';
  const n = new Date();
  let years = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) years--;
  return years < 0 ? '—' : `${years} y`;
}

export function truncate(s: string, max = 60): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
