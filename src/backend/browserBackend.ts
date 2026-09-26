// Dentiva Pro — fallback command backend (browser preview + automated tests).
// Implements the SAME command contract and the SAME permission checks as the
// Rust backend, over sql.js (SQLite/WASM) + IndexedDB (attachments/snapshot).

import initSqlJs, { type Database } from 'sql.js';
import schemaSql from '../../db/schema.sql?raw';
import { CommandError } from '../lib/ipc';
import { row, all, run, scalar, permSet, requirePerm, assertText, optText, assertInt, type Ctx, type SessionUser } from './ctx';
import { kvGet, kvSet, fileGet, filePut, fileDel, memFileKeys } from './idb';
import {
  SCHEMA_VERSION, APP_VERSION, TOOTH_CONDITIONS, ACCOUNTING_CATEGORIES,
  DEFAULT_SETTINGS, DEFAULT_PRINTER_PROFILES, PERMISSIONS, DEFAULT_ROLE_GRANTS,
} from './systemSeed';
import { verifyActivationCode, activationReceipt } from './activation';
import { sha256Hex, bytesToBase64, base64ToBytes } from '../lib/hash';
import { clinicalHandlers } from './commands/clinical';
import { financeHandlers } from './commands/finance';

type Handler = (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown> | unknown;

let db: Database | null = null;
let bootPromise: Promise<void> | null = null;
let session: SessionUser | null = null;
let locked = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let installId = '';

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function todayISO(): string {
  return nowLocal().slice(0, 10);
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 400);
}

async function persistNow(): Promise<void> {
  if (!db) return;
  try {
    const bytes = db.export();
    await kvSet('db-snapshot', bytesToBase64(bytes));
  } catch {
    /* storage full etc. — surfaced at backup time; never crash */
  }
}

function wasmFile(): string {
  // Browser/Tauri-webview: served from public/. Node (tests): filesystem path.
  const isNode = typeof process !== 'undefined' && !!(process as unknown as { versions?: { node?: string } }).versions?.node;
  if (isNode) {
    const url = new URL('../../public/sql-wasm.wasm', import.meta.url);
    return url.pathname;
  }
  return 'sql-wasm.wasm';
}

async function boot(): Promise<void> {
  if (db) return;
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    installId = (await kvGet('install-id') as string) || '';
    if (!installId) {
      installId = `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      await kvSet('install-id', installId);
    }
    const SQL = await initSqlJs({ locateFile: (f) => (f.endsWith('.wasm') ? wasmFile() : f) });
    const snap = (await kvGet('db-snapshot') as string) || '';
    if (snap) {
      try {
        db = new SQL.Database(base64ToBytes(snap));
      } catch {
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
    db.run('PRAGMA foreign_keys = ON;');
    const hasMeta = row(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
    if (!hasMeta) {
      db.exec(schemaSql);
      db.run('PRAGMA foreign_keys = ON;');
      seedFresh();
      await persistNow();
    } else {
      // Ensure FK enforcement + integrity sanity on every boot.
      try {
        const chk = row<Record<string, unknown>>(db, 'PRAGMA integrity_check');
        if (chk && Object.values(chk)[0] !== 'ok') {
          await kvSet('integrity-warning', nowLocal());
        }
      } catch {
        /* ignore */
      }
    }
    void installId;
  })();
  return bootPromise;
}

function seedFresh(): void {
  const d = db!;
  const now = nowLocal();
  const today = todayISO();
  d.run('BEGIN IMMEDIATE');
  try {
    d.run('INSERT INTO meta (key, value) VALUES (\'schema_version\', ?), (\'app_version\', ?), (\'activated\', \'0\'), (\'setup_complete\', \'0\')', [String(SCHEMA_VERSION), APP_VERSION]);
    d.run('INSERT INTO clinic (id, name, created_at, updated_at) VALUES (1, \'Dental Care\', ?, ?)', [now, now]);
    d.run('INSERT INTO app_lock_state (id, locked) VALUES (1, 0)');
    for (const p of PERMISSIONS) {
      d.run('INSERT INTO permissions (code, name, module) VALUES (?, ?, ?)', [p.code, p.name, p.module]);
    }
    const roleIds: Record<string, number> = {};
    for (const name of ['Owner', 'Administrator', 'Dentist', 'Receptionist', 'Assistant', 'Accountant', 'Inventory Manager']) {
      d.run('INSERT INTO roles (name, description, system_role, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [name, `Built-in ${name} role`, now, now]);
      const r = row<{ id: number }>(d, 'SELECT last_insert_rowid() AS id');
      roleIds[name] = r!.id;
      const grants = name === 'Owner' ? PERMISSIONS.map((p) => p.code) : (DEFAULT_ROLE_GRANTS[name] ?? []);
      for (const g of grants) {
        d.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)', [roleIds[name], g]);
      }
    }
    for (const t of TOOTH_CONDITIONS) {
      d.run('INSERT INTO tooth_condition_types (code, name, color, sort) VALUES (?, ?, ?, ?)', [t.code, t.name, t.color, t.sort]);
    }
    for (const c of ACCOUNTING_CATEGORIES) {
      d.run('INSERT INTO accounting_categories (kind, name, description, active) VALUES (?, ?, ?, 1)', [c.kind, c.name, c.description]);
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      d.run('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', [k, v, now]);
    }
    for (const p of DEFAULT_PRINTER_PROFILES) {
      d.run('INSERT INTO printer_profiles (name, document_type, paper_size, margins_mm, orientation, font_scale, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [p.name, p.document_type, p.paper_size, p.margins_mm, p.orientation, p.font_scale, p.is_default, now, now]);
    }
    d.run('INSERT INTO print_templates (document_type, name, config_json, is_default, updated_at) VALUES (\'prescription\', \'Default clinical\', ?, 1, ?)', ['{}', now]);
    d.run('INSERT INTO print_templates (document_type, name, config_json, is_default, updated_at) VALUES (\'invoice\', \'Default invoice\', ?, 1, ?)', ['{}', now]);
    void today;
    d.run('COMMIT');
  } catch (e) {
    try { d.run('ROLLBACK'); } catch { /* noop */ }
    throw e;
  }
}

/** Testing hook: mark the app activated WITHOUT the product code.
 *  Test-only: not reachable through any IPC command. Lets integration tests
 *  exercise post-activation flows without embedding the secret in source.
 *  Genuine-code acceptance is covered by the env-gated release test
 *  (tests/integration/activation-acceptance.test.ts) plus the manual release gate. */
export async function __testActivate(): Promise<void> {
  metaSet('activated', '1');
  metaSet('activation_receipt', activationReceipt(installId));
  metaSet('activated_at', nowLocal());
  await kvSet('activation-receipt', activationReceipt(installId));
}

/** Testing hook: wipe in-memory + stored state and reboot fresh. */
export async function __resetForTests(): Promise<void> {
  const { kvDel } = await import('./idb');
  await kvDel('db-snapshot');
  for (const k of memFileKeys()) await fileDel(k);
  db?.close();
  db = null;
  bootPromise = null;
  session = null;
  locked = false;
  await boot();
}

// ------------------------------------------------------------ password hash
async function hashPassword(pw: string): Promise<string> {
  // Browser/WebCrypto PBKDF2 (production Tauri uses Argon2id in Rust).
  if (globalThis.crypto?.subtle) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 210000, hash: 'SHA-256' }, key, 256);
    return `pbkdf2$210000$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
  }
  // Node fallback (tests): still strong, uses WebCrypto if present, else SHA-256 chain.
  const { pbkdf2Sync, randomBytes } = await import('node:crypto');
  const salt = randomBytes(16);
  const dk = pbkdf2Sync(pw, salt, 210000, 32, 'sha256');
  return `pbkdf2$210000$${Buffer.from(salt).toString('base64')}$${Buffer.from(dk).toString('base64')}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const m = /^pbkdf2\$(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!m) return false;
  const [, iterStr, saltB64, hashB64] = m;
  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;
  try {
    if (globalThis.crypto?.subtle) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: base64ToBytes(saltB64) as unknown as BufferSource, iterations, hash: 'SHA-256' }, key, 256);
      return bytesToBase64(new Uint8Array(bits)) === hashB64;
    }
    const { pbkdf2Sync } = await import('node:crypto');
    const dk = pbkdf2Sync(pw, Buffer.from(saltB64, 'base64'), iterations, 32, 'sha256');
    return Buffer.from(dk).toString('base64') === hashB64;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------- ctx
function makeCtx(): Ctx {
  const d = db!;
  return {
    db: d,
    persist: schedulePersist,
    getSession: () => session,
    setSession: (u) => { session = u; },
    isLocked: () => locked,
    setLocked: (v) => { locked = v; },
    need: (code) => {
      if (locked) throw new CommandError('LOCKED', 'Application is locked. Please unlock to continue.');
      if (!session) throw new CommandError('UNAUTHENTICATED', 'Please log in to continue.');
      requirePerm(session.permissions, code);
      return session;
    },
    optionalSession: () => (locked ? null : session),
    audit: (action, entityType, entityId, summary, before, after) => {
      try {
        d.run('INSERT INTO audit_logs (timestamp, user_id, username, action, entity_type, entity_id, summary, before_json, after_json, app_context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [nowLocal(), session?.id ?? null, session?.username ?? '', action, entityType, entityId,
            summary.slice(0, 2000), before === undefined ? null : JSON.stringify(before).slice(0, 8000),
            after === undefined ? null : JSON.stringify(after).slice(0, 8000), 'browser-fallback']);
        schedulePersist();
      } catch {
        /* audit must never break the operation */
      }
    },
    notify: (severity, category, title, message, entityType, entityId, route) => {
      try {
        d.run('INSERT INTO notifications (severity, category, title, message, entity_type, entity_id, action_route, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
          [severity, category, title.slice(0, 200), message.slice(0, 2000), entityType ?? null, entityId ?? null, route ?? null, nowLocal()]);
        schedulePersist();
      } catch {
        /* noop */
      }
    },
    now: nowLocal,
    today: todayISO,
  };
}

function metaGet(key: string): string {
  const r = row<{ value: string }>(db!, 'SELECT value FROM meta WHERE key = ?', [key]);
  return r?.value ?? '';
}
function metaSet(key: string, value: string): void {
  db!.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

// ---------------------------------------------------------------- handlers
async function appStatus(ctx: Ctx) {
  const activated = metaGet('activated') === '1';
  const setupComplete = metaGet('setup_complete') === '1';
  const settingsMins = parseInt(row<{ value: string }>(ctx.db, "SELECT value FROM app_settings WHERE key = 'auto_lock_minutes'")?.value ?? '15', 10);
  return {
    backend: 'browser',
    version: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    activated,
    setupComplete,
    locked,
    installId,
    session: locked ? null : session,
    autoLockMinutes: Number.isFinite(settingsMins) ? settingsMins : 15,
    integrityWarning: ((await kvGet('integrity-warning')) as string) || '',
  };
}

async function activate(ctx: Ctx, a: Record<string, unknown>) {
  const code = String(a.code ?? '').trim();
  if (!verifyActivationCode(code)) {
    ctx.audit('activation.failed', 'activation', null, 'Failed activation attempt', null, null);
    throw new CommandError('ACTIVATION_INVALID', 'Invalid activation code. Please check the code and try again.');
  }
  metaSet('activated', '1');
  metaSet('activation_receipt', activationReceipt(installId));
  metaSet('activated_at', ctx.now());
  await kvSet('activation-receipt', activationReceipt(installId));
  ctx.audit('activation.completed', 'activation', null, 'Application activated', null, null);
  ctx.persist();
  return { ok: true };
}

async function setupInit(ctx: Ctx, a: Record<string, unknown>) {
  if (metaGet('activated') !== '1') throw new CommandError('NOT_ACTIVATED', 'Activation is required before setup.');
  if (metaGet('setup_complete') === '1') throw new CommandError('ALREADY_SETUP', 'Setup has already been completed.');
  const clinic = a.clinic as Record<string, unknown>;
  const dentists = (a.dentists as Array<Record<string, unknown>>) ?? [];
  const admin = a.admin as Record<string, unknown>;
  const prefs = (a.preferences as Record<string, unknown>) ?? {};
  const backup = (a.backup as Record<string, unknown>) ?? {};
  const security = (a.security as Record<string, unknown>) ?? {};
  const clinicName = assertText(clinic?.name, 'Clinic name', { max: 200 });
  if (dentists.length === 0) throw new CommandError('VALIDATION', 'At least one dentist is required.');
  const fullName = assertText(admin?.fullName, 'Full name', { max: 120 });
  const username = assertText(admin?.username, 'Username', { max: 32 });
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new CommandError('VALIDATION', 'Username must be 3–32 chars (letters, digits, . _ -).');
  const password = String(admin?.password ?? '');
  if (password.length < 8) throw new CommandError('VALIDATION', 'Password must be at least 8 characters.');
  const hash = await hashPassword(password);
  const { db: d } = ctx;
  d.run('BEGIN IMMEDIATE');
  try {
    d.run('UPDATE clinic SET name = ?, address = ?, phone = ?, email = ?, website = ?, opening_hours = ?, closing_hours = ?, weekly_off = ?, message = ?, footer_text = ?, updated_at = ? WHERE id = 1',
      [clinicName, optText(clinic.address, 500), optText(clinic.phone, 120), optText(clinic.email, 120), optText(clinic.website, 120),
        optText(clinic.openingHours, 60), optText(clinic.closingHours, 60), optText(clinic.weeklyOff, 120),
        optText(clinic.message, 1000), optText(clinic.footerText, 1000), ctx.now()]);
    dentists.forEach((dt, i) => {
      const nm = assertText(dt.name, `Dentist #${i + 1} name`, { max: 160 });
      const r = run(d, 'INSERT INTO dentists (name, phone, email, registration_no, active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
        [nm, optText(dt.phone, 64), optText(dt.email, 120), optText(dt.registrationNo, 120), i, ctx.now(), ctx.now()]);
      const des = Array.isArray(dt.designations) ? dt.designations : [];
      des.slice(0, 10).forEach((g, j) => {
        const s = String(g).trim();
        if (s) d.run('INSERT INTO dentist_designations (dentist_id, designation, sort_order) VALUES (?, ?, ?)', [r.lastId, s.slice(0, 200), j]);
      });
    });
    const ownerRole = row<{ id: number }>(d, "SELECT id FROM roles WHERE name = 'Owner'");
    d.run('INSERT INTO users (full_name, username, password_hash, role_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [fullName, username, hash, ownerRole!.id, ctx.now(), ctx.now()]);
    const prefMap: Record<string, string> = {
      date_format: String(prefs.dateFormat ?? 'DD MMM YYYY'),
      time_format: String(prefs.timeFormat ?? '12h'),
      default_paper_size: String(prefs.paperSize ?? 'A4'),
      auto_lock_minutes: String(security.autoLock ?? '15'),
      backup_location: String(backup.location ?? ''),
      auto_backup_days: String(backup.scheduleDays ?? '7'),
      invoice_tax_percent: String(prefs.taxPercent ?? '0'),
    };
    for (const [k, v] of Object.entries(prefMap)) {
      d.run('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?', [v.slice(0, 200), ctx.now(), k]);
    }
    d.run("INSERT INTO meta (key, value) VALUES ('setup_complete', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
    d.run('COMMIT');
  } catch (e) {
    try { d.run('ROLLBACK'); } catch { /* noop */ }
    throw e;
  }
  ctx.audit('setup.completed', 'setup', null, `Initial setup completed for ${clinicName}`, null, null);
  ctx.persist();
  return { ok: true };
}

async function login(ctx: Ctx, a: Record<string, unknown>) {
  const username = assertText(a.username, 'Username', { max: 32 });
  const password = String(a.password ?? '');
  const u = row<Record<string, unknown>>(ctx.db, 'SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE LOWER(u.username) = LOWER(?)', [username]);
  if (!u || !u.active) {
    ctx.audit('auth.failed', 'user', null, `Failed login for "${username}" (unknown/disabled)`, null, null);
    throw new CommandError('AUTH_FAILED', 'Invalid username or password.');
  }
  if (u.locked_until && String(u.locked_until) > ctx.now()) {
    throw new CommandError('ACCOUNT_LOCKED', 'Account is temporarily locked due to failed attempts. Please try again later.');
  }
  const ok = await verifyPassword(password, String(u.password_hash));
  if (!ok) {
    const fails = (u.failed_attempts as number) + 1;
    const lockUntil = fails >= 5 ? addMinutes(ctx.now(), 5) : null;
    ctx.db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [fails, lockUntil, u.id]);
    ctx.audit('auth.failed', 'user', u.id as number, `Failed login for "${username}" (${fails} attempt(s))`, null, null);
    ctx.persist();
    throw new CommandError('AUTH_FAILED', fails >= 5 ? 'Invalid username or password. Account locked for 5 minutes.' : 'Invalid username or password.');
  }
  ctx.db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [ctx.now(), u.id]);
  const perms = permSet(ctx.db, u.id as number);
  session = { id: u.id as number, fullName: String(u.full_name), username: String(u.username), roleId: u.role_id as number, roleName: String(u.role_name), permissions: perms };
  locked = false;
  ctx.db.run('UPDATE app_lock_state SET locked = 0, locked_by = NULL WHERE id = 1');
  ctx.audit('auth.login', 'user', u.id as number, `User "${username}" logged in`, null, null);
  await refreshSystemNotifications(ctx);
  ctx.persist();
  return { session };
}

function addMinutes(local: string, mins: number): string {
  const d = new Date(local.replace(' ', 'T'));
  d.setMinutes(d.getMinutes() + mins);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function logout(ctx: Ctx) {
  if (session) ctx.audit('auth.logout', 'user', session.id, `User "${session.username}" logged out`, null, null);
  session = null;
  locked = false;
  ctx.persist();
  return { ok: true };
}

function lockApp(ctx: Ctx) {
  locked = true;
  ctx.db.run('UPDATE app_lock_state SET locked = 1, locked_at = ?, locked_by = ? WHERE id = 1', [ctx.now(), session?.id ?? null]);
  ctx.persist();
  return { ok: true };
}

async function unlock(ctx: Ctx, a: Record<string, unknown>) {
  if (!session) throw new CommandError('UNAUTHENTICATED', 'Please log in.');
  const u = row<Record<string, unknown>>(ctx.db, 'SELECT * FROM users WHERE id = ?', [session.id]);
  if (!u || !u.active) throw new CommandError('AUTH_FAILED', 'Account is disabled.');
  const ok = await verifyPassword(String(a.password ?? ''), String(u.password_hash));
  if (!ok) {
    ctx.audit('auth.unlock_failed', 'user', session.id, 'Failed unlock attempt', null, null);
    throw new CommandError('AUTH_FAILED', 'Incorrect password.');
  }
  locked = false;
  ctx.db.run('UPDATE app_lock_state SET locked = 0 WHERE id = 1');
  ctx.persist();
  return { ok: true };
}

async function changePassword(ctx: Ctx, a: Record<string, unknown>) {
  if (!session) throw new CommandError('UNAUTHENTICATED', 'Please log in.');
  const u = row<Record<string, unknown>>(ctx.db, 'SELECT * FROM users WHERE id = ?', [session.id]);
  if (!u) throw new CommandError('NOT_FOUND', 'User not found.');
  const ok = await verifyPassword(String(a.current ?? ''), String(u.password_hash));
  if (!ok) throw new CommandError('AUTH_FAILED', 'Current password is incorrect.');
  const next = String(a.next ?? '');
  if (next.length < 8) throw new CommandError('VALIDATION', 'New password must be at least 8 characters.');
  ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), session.id]);
  ctx.audit('auth.password_changed', 'user', session.id, 'Password changed', null, null);
  ctx.persist();
  return { ok: true };
}

// --------------------------------------------------------------- settings
function settingsGet(ctx: Ctx, a: Record<string, unknown>) {
  const keys = Array.isArray(a.keys) ? (a.keys as string[]) : null;
  const rows = keys?.length
    ? keys.map((k) => ({ key: k, value: row<{ value: string }>(ctx.db, 'SELECT value FROM app_settings WHERE key = ?', [k])?.value ?? '' }))
    : all<{ key: string; value: string }>(ctx.db, 'SELECT key, value FROM app_settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function settingsSet(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('settings.manage');
  const values = (a.values as Record<string, string>) ?? {};
  const before: Record<string, string> = {};
  for (const [k, v] of Object.entries(values).slice(0, 60)) {
    if (!/^[a-z0-9_]{1,64}$/.test(k)) continue;
    before[k] = row<{ value: string }>(ctx.db, 'SELECT value FROM app_settings WHERE key = ?', [k])?.value ?? '';
    ctx.db.run('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [k, String(v).slice(0, 4000), ctx.now()]);
  }
  ctx.audit('settings.updated', 'settings', null, `Settings updated (${Object.keys(values).length} key(s))`, before, values);
  ctx.persist();
  return { ok: true };
}

// -------------------------------------------------------------- dashboard
function dashboardStats(ctx: Ctx) {
  const s = ctx.optionalSession();
  if (!s) throw new CommandError('UNAUTHENTICATED', 'Please log in.');
  const { db: d } = ctx;
  const today = ctx.today();
  const can = (c: string) => s.permissions.includes(c) || s.permissions.includes('*');
  const out: Record<string, unknown> = { date: today };
  if (can('patients.view')) {
    out.todayPatients = scalar(d, 'SELECT COUNT(DISTINCT v.patient_id) FROM visits v WHERE v.visit_date = ?', [today]);
    out.newPatients = scalar(d, 'SELECT COUNT(*) FROM patients WHERE reg_date = ?', [today]);
    out.totalPatients = scalar(d, 'SELECT COUNT(*) FROM patients WHERE archived = 0');
    out.recentPatients = all(d, 'SELECT id, code, name, phone, reg_date FROM patients ORDER BY id DESC LIMIT 8');
  }
  if (can('appointments.view')) {
    out.todayAppointments = scalar(d, 'SELECT COUNT(*) FROM appointments WHERE appt_date = ? AND status NOT IN (\'Cancelled\',\'No Show\')', [today]);
    out.upcomingAppointments = all(d, 'SELECT a.*, p.name AS patient_name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.appt_date >= ? AND a.status IN (\'Scheduled\',\'Confirmed\') ORDER BY a.appt_date, a.appt_time LIMIT 8', [today]);
    out.missedAppointments = scalar(d, 'SELECT COUNT(*) FROM appointments WHERE appt_date < ? AND status IN (\'Scheduled\',\'Confirmed\')', [today]);
  }
  if (can('queue.manage')) {
    out.queueWaiting = scalar(d, "SELECT COUNT(*) FROM queue_entries WHERE queue_date = ? AND status IN ('waiting','called','hold')", [today]);
    out.queueNow = all(d, 'SELECT q.*, p.name AS patient_name FROM queue_entries q JOIN patients p ON p.id = q.patient_id WHERE q.queue_date = ? AND q.status IN (\'waiting\',\'called\',\'in_progress\') ORDER BY q.queue_no LIMIT 6', [today]);
  }
  if (can('clinical.view')) {
    out.completedVisits = scalar(d, 'SELECT COUNT(*) FROM visits WHERE visit_date = ?', [today]);
    out.treatmentSummary = all(d, 'SELECT COALESCE(c.name, tr.custom_name) AS name, COUNT(*) AS n FROM treatment_records tr LEFT JOIN treatment_catalog c ON c.id = tr.treatment_id WHERE tr.treatment_date >= date(?, \'-30 days\') GROUP BY name ORDER BY n DESC LIMIT 5', [today]);
  }
  if (can('payments.view')) {
    out.todayRevenue = scalar(d, 'SELECT COALESCE(SUM(amount_paisa),0) FROM payments WHERE payment_date = ? AND reversed = 0', [today]);
    out.recentPayments = all(d, 'SELECT p.receipt_no, p.amount_paisa, p.method, p.payment_date, pt.name AS patient_name FROM payments p JOIN patients pt ON pt.id = p.patient_id WHERE p.reversed = 0 ORDER BY p.id DESC LIMIT 8');
    out.revenueTrend = all(d, 'SELECT payment_date AS d, SUM(amount_paisa) AS total FROM payments WHERE payment_date >= date(?, \'-13 days\') AND reversed = 0 GROUP BY payment_date ORDER BY payment_date', [today]);
  }
  if (can('invoices.view')) {
    out.outstanding = scalar(d, "SELECT COALESCE(SUM(total_paisa - paid_paisa),0) FROM invoices WHERE status IN ('Due','Partially Paid')");
  }
  if (can('inventory.view')) {
    const items = all<Record<string, unknown>>(d, 'SELECT i.name, i.reorder_level, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id),0) AS stock FROM inventory_items i WHERE i.active = 1');
    out.lowStock = items.filter((r) => (r.stock as number) <= (r.reorder_level as number)).length;
    out.lowStockItems = items.filter((r) => (r.stock as number) <= (r.reorder_level as number)).slice(0, 6);
    const soon = new Date(); soon.setDate(soon.getDate() + 90);
    out.expiring = scalar(d, 'SELECT COUNT(DISTINCT item_id) FROM inventory_batches WHERE qty_remaining > 0 AND expiry_date IS NOT NULL AND expiry_date <= ?', [soon.toISOString().slice(0, 10)]);
  }
  if (can('appointments.view')) {
    out.appointmentTrend = all(d, 'SELECT appt_date AS d, COUNT(*) AS n FROM appointments WHERE appt_date >= date(?, \'-13 days\') GROUP BY appt_date ORDER BY appt_date', [today]);
  }
  out.unreadNotifications = scalar(d, 'SELECT COUNT(*) FROM notifications WHERE is_read = 0');
  return out;
}

// ----------------------------------------------------------------- search
function globalSearch(ctx: Ctx, a: Record<string, unknown>) {
  const s = ctx.optionalSession();
  if (!s) throw new CommandError('UNAUTHENTICATED', 'Please log in.');
  const q = String(a.query ?? '').trim();
  if (q.length < 2) return [];
  const { db: d } = ctx;
  const can = (c: string) => s.permissions.includes(c) || s.permissions.includes('*');
  const like = `%${q}%`;
  const results: Array<{ kind: string; id: number; title: string; subtitle: string; route: string }> = [];
  if (can('patients.view')) {
    for (const p of all<Record<string, unknown>>(d, 'SELECT id, code, name, phone FROM patients WHERE name LIKE ? OR code LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 8', [like, like, like])) {
      results.push({ kind: 'Patient', id: p.id as number, title: `${p.name} (${p.code})`, subtitle: String(p.phone || ''), route: `patients/${p.id}` });
    }
  }
  if (can('appointments.view')) {
    for (const r of all<Record<string, unknown>>(d, 'SELECT a.id, a.appt_date, a.status, p.name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE p.name LIKE ? ORDER BY a.appt_date DESC LIMIT 5', [like])) {
      results.push({ kind: 'Appointment', id: r.id as number, title: `${r.name} — ${r.appt_date}`, subtitle: String(r.status), route: 'appointments' });
    }
  }
  if (can('clinical.view')) {
    for (const r of all<Record<string, unknown>>(d, 'SELECT v.id, v.visit_date, p.name FROM visits v JOIN patients p ON p.id = v.patient_id WHERE p.name LIKE ? OR v.diagnosis LIKE ? ORDER BY v.id DESC LIMIT 5', [like, like])) {
      results.push({ kind: 'Visit', id: r.id as number, title: `${r.name} — visit ${r.visit_date}`, subtitle: '', route: 'patients' });
    }
  }
  const finAllowed = can('invoices.view') || can('payments.view') || can('reports.financial');
  if (can('invoices.view')) {
    for (const r of all<Record<string, unknown>>(d, 'SELECT i.id, i.invoice_no, p.name FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.invoice_no LIKE ? OR p.name LIKE ? ORDER BY i.id DESC LIMIT 5', [like, like])) {
      results.push({ kind: 'Invoice', id: r.id as number, title: `Invoice ${r.invoice_no}`, subtitle: finAllowed ? String(r.name) : '', route: 'invoices' });
    }
  }
  if (can('payments.view')) {
    for (const r of all<Record<string, unknown>>(d, 'SELECT p.id, p.receipt_no, pt.name FROM payments p JOIN patients pt ON pt.id = p.patient_id WHERE p.receipt_no LIKE ? ORDER BY p.id DESC LIMIT 5', [like])) {
      results.push({ kind: 'Payment', id: r.id as number, title: `Receipt ${r.receipt_no}`, subtitle: '', route: 'payments' });
    }
  }
  if (can('inventory.view')) {
    for (const r of all<Record<string, unknown>>(d, 'SELECT id, sku, name FROM inventory_items WHERE name LIKE ? OR sku LIKE ? LIMIT 5', [like, like])) {
      results.push({ kind: 'Inventory', id: r.id as number, title: String(r.name), subtitle: String(r.sku), route: 'inventory' });
    }
  }
  if (can('staff.view')) {
    for (const r of all<Record<string, unknown>>(d, 'SELECT id, name, role_title FROM staff WHERE name LIKE ? LIMIT 5', [like])) {
      results.push({ kind: 'Staff', id: r.id as number, title: String(r.name), subtitle: String(r.role_title || ''), route: 'staff' });
    }
  }
  return results.slice(0, 30);
}

// ---------------------------------------------------------- notifications
async function refreshSystemNotifications(ctx: Ctx): Promise<void> {
  const { db: d } = ctx;
  const today = ctx.today();
  // Regenerate system notifications idempotently.
  d.run("DELETE FROM notifications WHERE category IN ('appointment','inventory','backup') AND is_read = 0");
  const appts = scalar<number>(d, "SELECT COUNT(*) FROM appointments WHERE appt_date = ? AND status IN ('Scheduled','Confirmed')", [today]);
  if (appts > 0) ctx.notify('info', 'appointment', `${appts} appointment(s) today`, 'Review today\u2019s schedule and confirm arrivals.', 'appointment', null, 'appointments');
  const missed = scalar<number>(d, "SELECT COUNT(*) FROM appointments WHERE appt_date = date(?, '-1 day') AND status IN ('Scheduled','Confirmed')", [today]);
  if (missed > 0) ctx.notify('warning', 'appointment', `${missed} missed appointment(s)`, 'Yesterday\u2019s unconfirmed appointments need follow-up.', 'appointment', null, 'appointments');
  const items = all<Record<string, unknown>>(d, 'SELECT i.id, i.name, i.reorder_level, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id),0) AS stock FROM inventory_items i WHERE i.active = 1');
  const low = items.filter((r) => (r.stock as number) <= (r.reorder_level as number));
  if (low.length > 0) ctx.notify('warning', 'inventory', `${low.length} item(s) low on stock`, low.slice(0, 5).map((r) => r.name).join(', '), 'inventory_item', null, 'inventory');
  const soon = new Date(); soon.setDate(soon.getDate() + 30);
  const exp = all(d, 'SELECT DISTINCT i.name FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?', [soon.toISOString().slice(0, 10)]);
  if (exp.length > 0) ctx.notify('warning', 'inventory', `${exp.length} item(s) expiring soon`, 'Check expiry dates and rotate stock.', 'inventory_item', null, 'inventory');
  const days = parseInt(row<{ value: string }>(d, "SELECT value FROM app_settings WHERE key = 'auto_backup_days'")?.value ?? '7', 10) || 0;
  const last = row<{ value: string }>(d, "SELECT value FROM app_settings WHERE key = 'last_auto_backup'")?.value ?? '';
  if (days > 0) {
    const lastDate = last ? last.slice(0, 10) : '2000-01-01';
    const diff = Math.floor((Date.parse(today) - Date.parse(lastDate)) / 86400000);
    if (diff >= days) ctx.notify('warning', 'backup', 'Backup is due', `No backup for ${diff} day(s). Run a backup now.`, null, null, 'backup');
  }
}

function notificationsList(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.optionalSession()) throw new CommandError('UNAUTHENTICATED', 'Please log in.');
  const unreadOnly = !!a.unreadOnly;
  const rows = unreadOnly
    ? all(ctx.db, 'SELECT * FROM notifications WHERE is_read = 0 ORDER BY id DESC LIMIT 200')
    : all(ctx.db, 'SELECT * FROM notifications ORDER BY id DESC LIMIT 200');
  const unread = scalar<number>(ctx.db, 'SELECT COUNT(*) FROM notifications WHERE is_read = 0');
  return { rows, unread };
}

function notificationsMark(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.optionalSession()) throw new CommandError('UNAUTHENTICATED', 'Please log in.');
  if (a.all) ctx.db.run('UPDATE notifications SET is_read = 1');
  else ctx.db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [assertInt(a.id, 'id', { min: 1 })]);
  ctx.persist();
  return { ok: true };
}

function notificationsClear(ctx: Ctx) {
  if (!ctx.optionalSession()) throw new CommandError('UNAUTHENTICATED', 'Please log in.');
  ctx.db.run('DELETE FROM notifications WHERE is_read = 1');
  ctx.persist();
  return { ok: true };
}

// ------------------------------------------------------------------ audit
function auditList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('audit.view');
  const { db: d } = ctx;
  const w: string[] = [];
  const p: unknown[] = [];
  if (a.from) { w.push('timestamp >= ?'); p.push(String(a.from)); }
  if (a.to) { w.push('timestamp <= ?'); p.push(`${a.to}T23:59:59`); }
  if (a.userId) { w.push('user_id = ?'); p.push(Number(a.userId)); }
  if (a.action) { w.push('action LIKE ?'); p.push(`%${a.action}%`); }
  if (a.search) { w.push('(summary LIKE ? OR username LIKE ?)'); p.push(`%${a.search}%`, `%${a.search}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const page = Math.max(1, Number(a.page ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(a.pageSize ?? 50)));
  const total = scalar<number>(d, `SELECT COUNT(*) FROM audit_logs ${where}`, p);
  const rows = all(d, `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  return { rows, total, page, pageSize };
}

// ---------------------------------------------------------------- backup
function backupFilename(kind: string): string {
  const clean = nowLocal().replace('T', '_').replace(/:/g, '-');
  return `DentivaPro_Backup_${clean}_${kind}.dentivabak`;
}

async function backupRun(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('backup.run');
  const kind = String(a.kind ?? 'manual');
  if (!db) throw new CommandError('DB', 'Database is not open.');
  const integrity = row<Record<string, unknown>>(db, 'PRAGMA integrity_check');
  if (Object.values(integrity ?? {})[0] !== 'ok') throw new CommandError('DB_CORRUPT', 'Database integrity check failed. Backup aborted to avoid archiving a corrupt database.');
  const bytes = db.export();
  const dbB64 = bytesToBase64(bytes);
  const atts = all<Record<string, unknown>>(db, 'SELECT patient_id, stored_name, mime, original_name FROM patient_attachments');
  const files: Array<{ key: string; mime: string; name: string; base64: string }> = [];
  const missing: string[] = [];
  for (const t of atts) {
    const key = `p${t.patient_id}/${t.stored_name}`;
    const f = await fileGet(key);
    if (!f) { missing.push(String(t.original_name)); continue; }
    files.push({ key, mime: f.mime, name: f.name, base64: bytesToBase64(f.data) });
  }
  const clinic = row<Record<string, unknown>>(db, 'SELECT name FROM clinic WHERE id = 1');
  const container = {
    magic: 'DENTIVABAK', format: 1, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION,
    createdAt: ctx.now(), kind, installId, clinicName: clinic?.name ?? '',
    checksum: sha256Hex(dbB64), dbBase64: dbB64, files,
  };
  const json = JSON.stringify(container);
  const filename = backupFilename(kind);
  const size = json.length;
  const r = run(db, 'INSERT INTO backup_records (filename, path, created_at, size_bytes, schema_version, app_version, kind, status, note, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [filename, String(a.location ?? 'downloads'), ctx.now(), size, SCHEMA_VERSION, APP_VERSION, kind, 'ok',
      missing.length ? `Missing ${missing.length} attachment file(s): ${missing.slice(0, 5).join(', ')}` : '', container.checksum]);
  ctx.db.run("UPDATE app_settings SET value = ? WHERE key = 'last_auto_backup'", [ctx.now()]);
  ctx.audit('backup.created', 'backup', r.lastId, `Backup ${filename} created (${files.length} attachment(s))`, null, null);
  ctx.notify('success', 'backup', 'Backup completed', `${filename} (${(size / 1024).toFixed(0)} KB).`, 'backup', r.lastId, 'backup');
  ctx.persist();
  return { id: r.lastId, filename, base64: bytesToBase64(new TextEncoder().encode(json)), sizeBytes: size, missing };
}

function backupList(ctx: Ctx) {
  ctx.need('backup.run');
  return all(ctx.db, 'SELECT * FROM backup_records ORDER BY id DESC LIMIT 200');
}

function restoreValidate(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('backup.restore');
  const parsed = parseContainer(String(a.base64 ?? ''));
  return { filename: String(a.filename ?? ''), createdAt: parsed.createdAt, appVersion: parsed.appVersion, schemaVersion: parsed.schemaVersion, kind: parsed.kind, clinicName: parsed.clinicName, attachments: parsed.files.length, checksumOk: parsed.checksumOk };
}

function parseContainer(b64: string): { createdAt: string; appVersion: string; schemaVersion: number; kind: string; clinicName: string; files: Array<{ key: string; mime: string; name: string; base64: string }>; dbBase64: string; checksumOk: boolean } {
  let json: string;
  try {
    json = new TextDecoder().decode(base64ToBytes(b64));
  } catch {
    throw new CommandError('INVALID_BACKUP', 'The selected file is not a valid Dentiva Pro backup.');
  }
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new CommandError('INVALID_BACKUP', 'The selected file is not a valid Dentiva Pro backup.');
  }
  if (c.magic !== 'DENTIVABAK' || typeof c.dbBase64 !== 'string') {
    throw new CommandError('INVALID_BACKUP', 'The selected file is not a valid Dentiva Pro backup.');
  }
  if (Number(c.schemaVersion) > SCHEMA_VERSION) {
    throw new CommandError('INCOMPATIBLE', `Backup schema v${c.schemaVersion} is newer than this app (v${SCHEMA_VERSION}). Please update Dentiva Pro first.`);
  }
  const checksumOk = sha256Hex(String(c.dbBase64)) === String(c.checksum ?? '');
  return {
    createdAt: String(c.createdAt ?? ''), appVersion: String(c.appVersion ?? ''), schemaVersion: Number(c.schemaVersion ?? 0),
    kind: String(c.kind ?? 'manual'), clinicName: String(c.clinicName ?? ''),
    files: Array.isArray(c.files) ? (c.files as Array<{ key: string; mime: string; name: string; base64: string }>) : [],
    dbBase64: String(c.dbBase64), checksumOk,
  };
}

async function restoreRun(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('backup.restore');
  const typed = String(a.typed ?? '');
  if (typed !== 'RESTORE') throw new CommandError('CONFIRM', 'Type RESTORE to confirm.');
  const parsed = parseContainer(String(a.base64 ?? ''));
  if (!parsed.checksumOk) throw new CommandError('CHECKSUM', 'Backup checksum mismatch. The file may be corrupted. Restore aborted.');
  // Mandatory pre-restore backup.
  const pre = await backupRun(ctx, { kind: 'pre-restore' });
  // Validate the incoming DB opens and passes integrity check before swapping.
  const SQL = await initSqlJs({ locateFile: (f) => (f.endsWith('.wasm') ? wasmFile() : f) });
  let incoming: Database;
  try {
    incoming = new SQL.Database(base64ToBytes(parsed.dbBase64));
  } catch {
    throw new CommandError('INVALID_BACKUP', 'Backup database payload is unreadable. Current data is untouched.');
  }
  try {
    const chk = row<Record<string, unknown>>(incoming, 'PRAGMA integrity_check');
    if (Object.values(chk ?? {})[0] !== 'ok') throw new CommandError('INVALID_BACKUP', 'Backup failed integrity check. Current data is untouched.');
    const hasPatients = row(incoming, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'patients'");
    if (!hasPatients) throw new CommandError('INVALID_BACKUP', 'Backup is missing core tables. Current data is untouched.');
  } catch (e) {
    incoming.close();
    throw e;
  }
  // Swap: close current, adopt incoming, restore attachments.
  db?.close();
  db = incoming;
  db.run('PRAGMA foreign_keys = ON;');
  for (const k of memFileKeys()) await fileDel(k);
  for (const f of parsed.files) {
    try {
      await filePut(f.key, f.mime, f.name, base64ToBytes(f.base64));
    } catch {
      /* per-file failure must not abort the restore */
    }
  }
  // NOTE: the pre-restore backup row lives in the previous database, so it cannot
  // be FK-linked from the restored one; its filename is preserved in the note.
  // performed_by is NULLed when the current user does not exist in the backup.
  const preInfo = pre as { id: number; filename: string };
  const userStillExists = session?.id ? row(db, 'SELECT id FROM users WHERE id = ?', [session.id]) : null;
  const r = run(db, 'INSERT INTO restore_records (source_filename, restored_at, status, note, pre_restore_backup_id, performed_by) VALUES (?, ?, \'ok\', ?, NULL, ?)',
    [String(a.filename ?? 'backup'), ctx.now(), `Restored ${parsed.files.length} attachment(s); pre-restore safety backup: ${preInfo.filename}`, userStillExists ? session!.id : null]);
  // Audit + notify on the RESTORED database.
  const fresh = makeCtx();
  fresh.audit('restore.completed', 'restore', r.lastId, `Database restored from ${a.filename ?? 'backup'}`, null, null);
  fresh.notify('success', 'backup', 'Restore completed', `Data restored from ${a.filename ?? 'backup'}. A pre-restore safety backup was kept.`, 'restore', r.lastId, 'backup');
  await persistNow();
  return { ok: true, preRestoreId: (pre as { id: number }).id };
}

// ---------------------------------------------------------------- reports
function reportRun(ctx: Ctx, a: Record<string, unknown>) {
  const type = String(a.type);
  const from = String(a.from ?? '2000-01-01');
  const to = String(a.to ?? '2100-01-01');
  const { db: d } = ctx;
  const needFin = () => ctx.need('reports.financial');
  switch (type) {
    case 'registrations': {
      ctx.need('reports.view');
      const rows = all(d, 'SELECT reg_date AS d, COUNT(*) AS n FROM patients WHERE reg_date BETWEEN ? AND ? GROUP BY reg_date ORDER BY reg_date', [from, to]);
      return { columns: ['Date', 'Registrations'], rows, total: rows.reduce((s, r) => s + (r.n as number), 0) };
    }
    case 'visits': {
      ctx.need('reports.view');
      const rows = all(d, 'SELECT v.visit_date, p.code, p.name, COALESCE(dt.name,\'\') AS dentist, v.diagnosis FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN dentists dt ON dt.id = v.dentist_id WHERE v.visit_date BETWEEN ? AND ? ORDER BY v.visit_date DESC LIMIT 2000', [from, to]);
      return { columns: ['Date', 'Code', 'Patient', 'Dentist', 'Diagnosis'], rows, total: rows.length };
    }
    case 'appointments': {
      ctx.need('reports.view');
      const rows = all(d, 'SELECT a.appt_date, a.appt_time, p.code, p.name, COALESCE(dt.name,\'\') AS dentist, a.status FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists dt ON dt.id = a.dentist_id WHERE a.appt_date BETWEEN ? AND ? ORDER BY a.appt_date, a.appt_time LIMIT 2000', [from, to]);
      return { columns: ['Date', 'Time', 'Code', 'Patient', 'Dentist', 'Status'], rows, total: rows.length };
    }
    case 'treatments': {
      ctx.need('reports.view');
      const rows = all(d, 'SELECT COALESCE(c.name, tr.custom_name) AS name, COUNT(*) AS n, SUM(tr.price_paisa * tr.qty) AS amount FROM treatment_records tr LEFT JOIN treatment_catalog c ON c.id = tr.treatment_id WHERE tr.treatment_date BETWEEN ? AND ? GROUP BY name ORDER BY n DESC', [from, to]);
      return { columns: ['Treatment', 'Count', 'Amount (paisa)'], rows, total: rows.length };
    }
    case 'prescriptions': {
      ctx.need('reports.view');
      const rows = all(d, 'SELECT r.prescription_date, p.code, p.name, (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = r.id) AS items FROM prescriptions r JOIN patients p ON p.id = r.patient_id WHERE r.prescription_date BETWEEN ? AND ? ORDER BY r.prescription_date DESC LIMIT 2000', [from, to]);
      return { columns: ['Date', 'Code', 'Patient', 'Items'], rows, total: rows.length };
    }
    case 'invoices': {
      needFin();
      const rows = all(d, 'SELECT i.invoice_no, i.invoice_date, p.code, p.name, i.total_paisa, i.paid_paisa, (i.total_paisa - i.paid_paisa) AS due, i.status FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date DESC LIMIT 2000', [from, to]);
      const billed = rows.reduce((s, r) => s + ((r.total_paisa as number) || 0), 0);
      return { columns: ['Invoice', 'Date', 'Code', 'Patient', 'Total', 'Paid', 'Due', 'Status'], rows, total: billed };
    }
    case 'payments': {
      needFin();
      const rows = all(d, 'SELECT py.receipt_no, py.payment_date, p.code, p.name, py.amount_paisa, py.method FROM payments py JOIN patients p ON p.id = py.patient_id WHERE py.payment_date BETWEEN ? AND ? AND py.reversed = 0 ORDER BY py.payment_date DESC LIMIT 2000', [from, to]);
      const sum = rows.reduce((s, r) => s + ((r.amount_paisa as number) || 0), 0);
      return { columns: ['Receipt', 'Date', 'Code', 'Patient', 'Amount', 'Method'], rows, total: sum };
    }
    case 'outstanding': {
      needFin();
      const rows = all(d, 'SELECT i.invoice_no, i.invoice_date, p.code, p.name, p.phone, (i.total_paisa - i.paid_paisa) AS due FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.status IN (\'Due\',\'Partially Paid\') ORDER BY i.invoice_date LIMIT 2000', []);
      const sum = rows.reduce((s, r) => s + ((r.due as number) || 0), 0);
      return { columns: ['Invoice', 'Date', 'Code', 'Patient', 'Phone', 'Due'], rows, total: sum };
    }
    case 'inventory': {
      ctx.need('inventory.view');
      const rows = all(d, 'SELECT i.sku, i.name, i.category, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id),0) AS stock, i.reorder_level, i.unit FROM inventory_items i ORDER BY i.name', []);
      return { columns: ['SKU', 'Item', 'Category', 'Stock', 'Reorder', 'Unit'], rows, total: rows.length };
    }
    case 'expiry': {
      ctx.need('inventory.view');
      const rows = all(d, 'SELECT i.sku, i.name, b.batch_no, b.expiry_date, b.qty_remaining FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL ORDER BY b.expiry_date LIMIT 2000', []);
      return { columns: ['SKU', 'Item', 'Batch', 'Expiry', 'Qty'], rows, total: rows.length };
    }
    case 'expenses': {
      needFin();
      const rows = all(d, 'SELECT e.expense_date, COALESCE(c.name,\'—\') AS category, e.amount_paisa, e.method, e.note FROM expenses e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date DESC', [from, to]);
      return { columns: ['Date', 'Category', 'Amount', 'Method', 'Note'], rows, total: rows.reduce((s, r) => s + ((r.amount_paisa as number) || 0), 0) };
    }
    case 'income': {
      needFin();
      const rows = all(d, 'SELECT e.income_date, COALESCE(c.name,\'—\') AS category, e.amount_paisa, e.method, e.note FROM income_records e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.income_date BETWEEN ? AND ? ORDER BY e.income_date DESC', [from, to]);
      return { columns: ['Date', 'Category', 'Amount', 'Method', 'Note'], rows, total: rows.reduce((s, r) => s + ((r.amount_paisa as number) || 0), 0) };
    }
    case 'profit': {
      needFin();
      const inc = scalar<number>(d, 'SELECT COALESCE(SUM(amount_paisa),0) FROM income_records WHERE income_date BETWEEN ? AND ?', [from, to]);
      const exp = scalar<number>(d, 'SELECT COALESCE(SUM(amount_paisa),0) FROM expenses WHERE expense_date BETWEEN ? AND ?', [from, to]);
      const pay = scalar<number>(d, 'SELECT COALESCE(SUM(amount_paisa),0) FROM payments WHERE payment_date BETWEEN ? AND ? AND reversed = 0', [from, to]);
      return { columns: ['Metric', 'Amount (paisa)'], rows: [{ Metric: 'Clinical collections', 'Amount (paisa)': pay }, { Metric: 'Other income', 'Amount (paisa)': inc }, { Metric: 'Expenses', 'Amount (paisa)': exp }, { Metric: 'Net', 'Amount (paisa)': pay + inc - exp }], total: pay + inc - exp };
    }
    case 'dentist_activity': {
      ctx.need('reports.view');
      const rows = all(d, 'SELECT COALESCE(dt.name,\'—\') AS dentist, (SELECT COUNT(*) FROM visits v WHERE v.dentist_id = dt.id AND v.visit_date BETWEEN ? AND ?) AS visits, (SELECT COUNT(*) FROM appointments a WHERE a.dentist_id = dt.id AND a.appt_date BETWEEN ? AND ?) AS appointments FROM dentists dt ORDER BY dentist', [from, to, from, to]);
      return { columns: ['Dentist', 'Visits', 'Appointments'], rows, total: rows.length };
    }
    case 'audit': {
      ctx.need('audit.view');
      const rows = all(d, 'SELECT timestamp, username, action, entity_type, summary FROM audit_logs WHERE timestamp BETWEEN ? AND ? ORDER BY id DESC LIMIT 2000', [`${from}T00:00:00`, `${to}T23:59:59`]);
      return { columns: ['Time', 'User', 'Action', 'Entity', 'Summary'], rows, total: rows.length };
    }
    default:
      throw new CommandError('VALIDATION', 'Unknown report type.');
  }
}

// ---------------------------------------------------------------- export
function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const keys = rows.length ? Object.keys(rows[0]) : columns;
  const head = columns.length ? columns : keys;
  const lines = [head.map(esc).join(',')];
  for (const r of rows) lines.push(keys.map((k) => esc(r[k])).join(','));
  return '﻿' + lines.join('\n');
}

async function dataExport(ctx: Ctx, a: Record<string, unknown>) {
  const module = String(a.module);
  const format = String(a.format ?? 'csv');
  let columns: string[] = [];
  let rows: Array<Record<string, unknown>> = [];
  const from = String(a.from ?? '2000-01-01');
  const to = String(a.to ?? '2100-01-01');
  if (module === 'patients') {
    ctx.need('patients.export');
    rows = all(ctx.db, 'SELECT code, name, gender, dob, phone, address, reg_date, status FROM patients WHERE reg_date BETWEEN ? AND ? ORDER BY id', [from, to]);
    columns = ['Code', 'Name', 'Gender', 'DOB', 'Phone', 'Address', 'Registered', 'Status'];
  } else if (module === 'invoices' || module === 'payments' || module === 'accounting') {
    ctx.need('reports.financial');
    const rep = reportRun(ctx, { type: module === 'accounting' ? 'expenses' : module, from, to }) as { columns: string[]; rows: Array<Record<string, unknown>> };
    columns = rep.columns; rows = rep.rows;
  } else if (module === 'inventory') {
    ctx.need('inventory.view');
    const rep = reportRun(ctx, { type: 'inventory', from, to }) as { columns: string[]; rows: Array<Record<string, unknown>> };
    columns = rep.columns; rows = rep.rows;
  } else if (module === 'appointments') {
    ctx.need('appointments.view');
    const rep = reportRun(ctx, { type: 'appointments', from, to }) as { columns: string[]; rows: Array<Record<string, unknown>> };
    columns = rep.columns; rows = rep.rows;
  } else if (module === 'audit') {
    ctx.need('audit.view');
    const rep = reportRun(ctx, { type: 'audit', from, to }) as { columns: string[]; rows: Array<Record<string, unknown>> };
    columns = rep.columns; rows = rep.rows;
  } else {
    throw new CommandError('VALIDATION', 'Unknown export module.');
  }
  const filename = `DentivaPro_${module}_${from}_to_${to}.${format === 'json' ? 'json' : 'csv'}`;
  const content = format === 'json' ? JSON.stringify({ module, from, to, exportedAt: ctx.now(), rows }, null, 2) : toCsv(columns, rows);
  ctx.audit('data.exported', 'export', null, `${module} exported (${rows.length} row(s), ${format})`, null, null);
  return { filename, base64: bytesToBase64(new TextEncoder().encode(content)), count: rows.length };
}

// ----------------------------------------------------------------- reset
async function dataReset(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('data.danger');
  if (String(a.typed ?? '') !== 'DELETE ALL DATA') throw new CommandError('CONFIRM', 'Type DELETE ALL DATA to confirm.');
  await backupRun(ctx, { kind: 'pre-reset' });
  const SQL = await initSqlJs({ locateFile: (f) => (f.endsWith('.wasm') ? wasmFile() : f) });
  db?.close();
  db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.exec(schemaSql);
  seedFresh();
  // Preserve activation across factory reset (one-time code stays valid).
  metaSet('activated', '1');
  metaSet('activation_receipt', activationReceipt(installId));
  for (const k of memFileKeys()) await fileDel(k);
  session = null;
  locked = false;
  await persistNow();
  return { ok: true };
}

function logoSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('settings.manage');
  const b64 = String(a.base64 ?? '');
  const mime = String(a.mime ?? '');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(mime)) {
    throw new CommandError('VALIDATION', 'Logo must be PNG, JPEG, WebP, or SVG.');
  }
  const bytes = base64ToBytes(b64);
  if (bytes.length > 5 * 1024 * 1024) throw new CommandError('VALIDATION', 'Logo exceeds 5 MB.');
  const key = `clinic/logo`;
  return filePut(key, mime, 'logo', bytes).then(() => {
    ctx.db.run('UPDATE clinic SET logo_path = ? WHERE id = 1', [`idb:${key}:${mime}`]);
    ctx.persist();
    return { ok: true, logoPath: `idb:${key}:${mime}` };
  });
}

async function logoGet(ctx: Ctx) {
  const c = row<Record<string, unknown>>(ctx.db, 'SELECT logo_path FROM clinic WHERE id = 1');
  const lp = String(c?.logo_path ?? '');
  if (!lp.startsWith('idb:')) return { base64: '', mime: '' };
  const [, key, mime] = lp.split(':');
  const f = await fileGet(key);
  if (!f) return { base64: '', mime: '' };
  return { base64: bytesToBase64(f.data), mime: mime || f.mime };
}

// ---------------------------------------------------------------- router
const coreHandlers: Record<string, Handler> = {
  app_status: appStatus,
  activate,
  setup_init: setupInit,
  login,
  logout,
  lock_app: lockApp,
  unlock: unlock,
  change_password: changePassword,
  settings_get: settingsGet,
  settings_set: settingsSet,
  dashboard_stats: dashboardStats,
  global_search: globalSearch,
  notifications_list: notificationsList,
  notifications_mark: notificationsMark,
  notifications_clear: notificationsClear,
  notifications_refresh: async (ctx) => { await refreshSystemNotifications(ctx); ctx.persist(); return { ok: true }; },
  audit_list: auditList,
  backup_run: backupRun,
  backup_list: backupList,
  restore_validate: restoreValidate,
  restore_run: restoreRun,
  report_run: reportRun,
  data_export: dataExport,
  data_reset: dataReset,
  logo_save: logoSave,
  logo_get: logoGet,
};

const handlers: Record<string, Handler> = { ...coreHandlers, ...clinicalHandlers, ...financeHandlers };

export async function browserInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  await boot();
  const h = handlers[cmd];
  if (!h) throw new CommandError('UNKNOWN_COMMAND', `Unknown command: ${cmd}`);
  if (!db) throw new CommandError('DB', 'Database is not available.');
  const ctx = makeCtx();
  // Gate everything (except status/activation/setup) on activation + setup.
  if (!['app_status', 'activate', 'setup_init'].includes(cmd)) {
    if (metaGet('activated') !== '1') throw new CommandError('NOT_ACTIVATED', 'Application is not activated.');
  }
  if (!['app_status', 'activate', 'setup_init', 'login'].includes(cmd)) {
    if (metaGet('setup_complete') !== '1') throw new CommandError('NOT_SETUP', 'Initial setup is not complete.');
  }
  try {
    const out = await h(ctx, args);
    return out as T;
  } catch (e) {
    if (e instanceof CommandError) throw e;
    throw new CommandError('COMMAND_FAILED', e instanceof Error ? e.message : 'Command failed.');
  }
}

export async function flushBackend(): Promise<void> {
  await persistNow();
}
