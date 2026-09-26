// Dentiva Pro — shared input validation (mirrored by backend command layer).

export function isValidPhoneBD(phone: string): boolean {
  const s = phone.replace(/[\s-]/g, '');
  if (s === '') return true; // optional fields
  return /^(?:\+?880|0)1[3-9]\d{8}$/.test(s) || /^\+?[0-9]{7,15}$/.test(s);
}

export function isValidEmail(email: string): boolean {
  if (email.trim() === '') return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

export function isFutureDate(s: string): boolean {
  return s > new Date().toISOString().slice(0, 10);
}

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; hints: string[] } {
  const hints: string[] = [];
  let score = 0;
  if (pw.length >= 8) score++;
  else hints.push('At least 8 characters');
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  else hints.push('Upper and lower case letters');
  if (/\d/.test(pw)) score++;
  else hints.push('At least one digit');
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  else hints.push('At least one symbol');
  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score], hints };
}

export function isValidUsername(u: string): boolean {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(u);
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._+\-()\s\u0980-\u09FF]/g, '_').slice(0, 120) || 'file';
}
