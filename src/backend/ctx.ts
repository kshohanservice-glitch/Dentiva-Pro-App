// Dentiva Pro — fallback-backend shared context & helpers.

import type { Database } from 'sql.js';
import { CommandError } from '../lib/ipc';
import { ALL_PERMISSION_CODES } from '../lib/permissions';

export interface SessionUser {
  id: number;
  fullName: string;
  username: string;
  roleId: number;
  roleName: string;
  permissions: string[];
}

export interface Ctx {
  db: Database;
  persist: () => void;
  getSession: () => SessionUser | null;
  setSession: (u: SessionUser | null) => void;
  isLocked: () => boolean;
  setLocked: (v: boolean) => void;
  need: (code: string) => SessionUser;
  optionalSession: () => SessionUser | null;
  audit: (action: string, entityType: string, entityId: number | null, summary: string, before?: unknown, after?: unknown) => void;
  notify: (severity: string, category: string, title: string, message: string, entityType?: string | null, entityId?: number | null, route?: string | null) => void;
  now: () => string;
  today: () => string;
}

export function row<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T | null {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject() as T;
    return null;
  } finally {
    stmt.free();
  }
}

export function all<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  const out: T[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}

export function run(db: Database, sql: string, params: unknown[] = []): { changes: number; lastId: number } {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const r = row<{ id: number }>(db, 'SELECT last_insert_rowid() AS id');
  return { changes, lastId: r?.id ?? 0 };
}

export function scalar<T = unknown>(db: Database, sql: string, params: unknown[] = []): T {
  const r = row<Record<string, unknown>>(db, sql, params);
  if (!r) return null as T;
  const k = Object.keys(r)[0];
  return r[k] as T;
}

export function permSet(db: Database, userId: number): string[] {
  const u = row<{ role_id: number }>(db, 'SELECT role_id FROM users WHERE id = ?', [userId]);
  if (!u) return [];
  const role = row<{ name: string }>(db, 'SELECT name FROM roles WHERE id = ?', [u.role_id]);
  if (role?.name === 'Owner') return [...ALL_PERMISSION_CODES];
  return all<{ permission_code: string }>(db, 'SELECT permission_code FROM role_permissions WHERE role_id = ?', [u.role_id]).map(
    (r) => r.permission_code,
  );
}

export function requirePerm(perms: string[], code: string): void {
  if (perms.includes(code) || perms.includes('*')) return;
  throw new CommandError('PERMISSION_DENIED', 'You do not have permission to perform this action.');
}

export function assertInt(n: unknown, field: string, opts?: { min?: number; max?: number }): number {
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new CommandError('VALIDATION', `${field} must be a whole number.`);
  if (opts?.min !== undefined && n < opts.min) throw new CommandError('VALIDATION', `${field} is out of range.`);
  if (opts?.max !== undefined && n > opts.max) throw new CommandError('VALIDATION', `${field} is out of range.`);
  return n;
}

export function assertMoney(n: unknown, field: string): number {
  const v = assertInt(n, field, { min: 0, max: Number.MAX_SAFE_INTEGER });
  return v;
}

export function assertText(s: unknown, field: string, opts?: { max?: number; allowEmpty?: boolean }): string {
  if (typeof s !== 'string') throw new CommandError('VALIDATION', `${field} must be text.`);
  const t = s.trim();
  if (!opts?.allowEmpty && t === '') throw new CommandError('VALIDATION', `${field} is required.`);
  if (opts?.max && t.length > opts.max) throw new CommandError('VALIDATION', `${field} is too long (max ${opts.max} characters).`);
  return t;
}

export function optText(s: unknown, max = 4000): string {
  if (s === null || s === undefined) return '';
  return assertText(s, 'field', { allowEmpty: true, max });
}

export function assertDate(s: unknown, field: string): string {
  const t = assertText(s, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new CommandError('VALIDATION', `${field} must be a valid date.`);
  return t;
}
