// Dentiva Pro — clinical-side commands (fallback backend).
// Every command enforces permissions + validation + transactions + audit.

import type { Database } from 'sql.js';
import { CommandError } from '../../lib/ipc';
import { row, all, run, scalar, type Ctx, assertText, optText, assertDate, assertInt, assertMoney } from '../ctx';
import { safeFilename } from '../../lib/validation';
import { filePut, fileGet, fileDel } from '../idb';

export type Handler = (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown> | unknown;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(s);
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function getSetting(db: Database, key: string, fallback = ''): string {
  const r = row<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ?', [key]);
  return r?.value ?? fallback;
}

function nextCode(db: Database, prefixKey: string, nextKey: string, padKey: string): string {
  const prefix = getSetting(db, prefixKey, '');
  const next = parseInt(getSetting(db, nextKey, '1'), 10) || 1;
  const pad = parseInt(getSetting(db, padKey, '5'), 10) || 5;
  const code = `${prefix}${String(next).padStart(pad, '0')}`;
  db.run('UPDATE app_settings SET value = ? WHERE key = ?', [String(next + 1), nextKey]);
  return code;
}

function txn(db: Database, fn: () => void): void {
  db.run('BEGIN IMMEDIATE');
  try {
    fn();
    db.run('COMMIT');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch { /* noop */ }
    throw e;
  }
}

function financialView(ctx: Ctx): boolean {
  const s = ctx.optionalSession();
  if (!s) return false;
  return s.permissions.includes('*') || s.permissions.includes('invoices.view') || s.permissions.includes('payments.view');
}

function clinicalView(ctx: Ctx): boolean {
  const s = ctx.optionalSession();
  if (!s) return false;
  return s.permissions.includes('*') || s.permissions.includes('clinical.view');
}

// ---------------------------------------------------------------- patients
function patientsList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.view');
  const { db } = ctx;
  const range = String(a.range ?? 'today');
  const search = String(a.search ?? '').trim();
  const sort = String(a.sort ?? 'newest');
  const dentistId = a.dentistId ? Number(a.dentistId) : null;
  const status = String(a.status ?? '');
  const page = Math.max(1, Number(a.page ?? 1));
  const pageSize = Math.min(200, Math.max(5, Number(a.pageSize ?? 25)));
  const today = ctx.today();

  const fromOf: Record<string, string> = {
    today, last7: addDays(today, -6), last30: addDays(today, -29), last90: addDays(today, -89), last365: addDays(today, -364),
  };
  let from: string | null = null;
  let to: string | null = null;
  if (range === 'custom') {
    from = String(a.from ?? today);
    to = String(a.to ?? today);
  } else if (range !== 'all') {
    from = fromOf[range] ?? today;
    to = today;
  }

  const where: string[] = [];
  const params: unknown[] = [];
  if (from && to) { where.push('p.reg_date BETWEEN ? AND ?'); params.push(from, to); }
  if (dentistId) { where.push('p.dentist_id = ?'); params.push(dentistId); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (search) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.phone LIKE ? OR p.emergency_phone LIKE ? OR p.address LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = scalar<number>(db, `SELECT COUNT(*) FROM patients p ${w}`, params);
  const order =
    sort === 'oldest' ? 'p.reg_date ASC, p.id ASC'
    : sort === 'name' ? 'p.name COLLATE NOCASE ASC'
    : sort === 'code' ? 'p.code ASC'
    : sort === 'balance' ? 'balance DESC'
    : 'p.reg_date DESC, p.id DESC';
  const rows = all(db,
    `SELECT p.*, d.name AS dentist_name,
      COALESCE((SELECT SUM(total_paisa - paid_paisa) FROM invoices i WHERE i.patient_id = p.id AND i.status != 'Cancelled'), 0) AS balance,
      (SELECT MAX(appt_date) FROM appointments ap WHERE ap.patient_id = p.id AND ap.status IN ('Scheduled','Confirmed')) AS next_appt,
      (SELECT MAX(visit_date) FROM visits v WHERE v.patient_id = p.id) AS last_visit
     FROM patients p LEFT JOIN dentists d ON d.id = p.dentist_id
     ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { rows, total, page, pageSize };
}

function addDays(iso: string, d: number): string {
  const dt = new Date(`${iso}T12:00:00`);
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
}

function patientsGet(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.view');
  const id = assertInt(a.id, 'id', { min: 1 });
  const p = row(ctx.db, 'SELECT p.*, d.name AS dentist_name FROM patients p LEFT JOIN dentists d ON d.id = p.dentist_id WHERE p.id = ?', [id]);
  if (!p) throw new CommandError('NOT_FOUND', 'Patient not found.');
  const tags = all<{ tag: string }>(ctx.db, 'SELECT tag FROM patient_tags WHERE patient_id = ?', [id]).map((t) => t.tag);
  const out: Record<string, unknown> = { ...p, tags };
  if (!clinicalView(ctx)) {
    for (const k of ['complaint', 'prev_problems', 'medical_notes', 'dental_notes', 'allergies']) out[k] = '';
  }
  return out;
}

function duplicateWarnings(db: Database, name: string, phone: string, dob: string): string[] {
  const warns: string[] = [];
  if (phone) {
    const c = scalar<number>(db, 'SELECT COUNT(*) FROM patients WHERE phone = ? OR emergency_phone = ?', [phone, phone]);
    if (c > 0) warns.push(`${c} existing patient(s) share this phone number.`);
  }
  if (name) {
    const c = scalar<number>(db, 'SELECT COUNT(*) FROM patients WHERE LOWER(name) = LOWER(?)', [name.trim()]);
    if (c > 0) warns.push(`${c} existing patient(s) have the same name.`);
  }
  if (dob) {
    const c = scalar<number>(db, 'SELECT COUNT(*) FROM patients WHERE dob = ? AND LOWER(name) = LOWER(?)', [dob, name.trim()]);
    if (c > 0) warns.push('An existing patient has the same name and date of birth.');
  }
  return warns;
}

function patientsCreate(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('patients.create');
  const { db } = ctx;
  const name = assertText(a.name, 'Patient name', { max: 160 });
  const phone = optText(a.phone, 32);
  const dob = a.dob ? String(a.dob) : null;
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new CommandError('VALIDATION', 'Date of birth is invalid.');
  let id = 0;
  let code = '';
  const warnings = duplicateWarnings(db, name, phone, dob ?? '');
  txn(db, () => {
    code = a.code ? assertText(a.code, 'Patient code', { max: 32 }) : nextCode(db, 'patient_code_prefix', 'patient_code_next', 'patient_code_pad');
    const exists = row(db, 'SELECT id FROM patients WHERE code = ?', [code]);
    if (exists) throw new CommandError('DUPLICATE', `Patient code ${code} already exists.`);
    const r = run(db,
      `INSERT INTO patients (code, name, dob, age_years, gender, blood_group, address, phone, emergency_phone, emergency_contact,
        complaint, prev_problems, medical_notes, dental_notes, allergies, notes, reg_date, reg_user_id, dentist_id, referral_source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, name, dob, num(a.age_years), str(a.gender, 16), str(a.blood_group, 16), optText(a.address, 500), phone,
        optText(a.emergency_phone, 32), optText(a.emergency_contact, 120), optText(a.complaint, 2000), optText(a.prev_problems, 2000),
        optText(a.medical_notes, 4000), optText(a.dental_notes, 4000), optText(a.allergies, 2000), optText(a.notes, 4000),
        ctx.today(), me.id, numNull(a.dentist_id), optText(a.referral_source, 200), str(a.status || 'active', 24), ctx.now(), ctx.now()]);
    id = r.lastId;
    const tags = Array.isArray(a.tags) ? a.tags : [];
    for (const t of tags.slice(0, 20)) {
      const tag = String(t).trim().slice(0, 48);
      if (tag) db.run('INSERT INTO patient_tags (patient_id, tag) VALUES (?, ?)', [id, tag]);
    }
  });
  ctx.audit('patient.created', 'patient', id, `Patient ${name} (${code}) registered`, null, { name, code });
  ctx.persist();
  return { id, code, warnings };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
function numNull(v: unknown): number | null { return num(v); }
function str(v: unknown, max: number): string { return optText(v, max); }

function patientsUpdate(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.edit');
  const { db } = ctx;
  const id = assertInt(a.id, 'id', { min: 1 });
  const before = row(db, 'SELECT * FROM patients WHERE id = ?', [id]);
  if (!before) throw new CommandError('NOT_FOUND', 'Patient not found.');
  if (a.code && String(a.code) !== (before as Record<string, unknown>).code) {
    const dup = row(db, 'SELECT id FROM patients WHERE code = ? AND id != ?', [String(a.code), id]);
    if (dup) throw new CommandError('DUPLICATE', 'Patient code already exists.');
  }
  txn(db, () => {
    db.run(
      `UPDATE patients SET code = ?, name = ?, dob = ?, age_years = ?, gender = ?, blood_group = ?, address = ?, phone = ?,
        emergency_phone = ?, emergency_contact = ?, complaint = ?, prev_problems = ?, medical_notes = ?, dental_notes = ?,
        allergies = ?, notes = ?, dentist_id = ?, referral_source = ?, status = ?, updated_at = ? WHERE id = ?`,
      [a.code ? assertText(a.code, 'Patient code', { max: 32 }) : (before as Record<string, unknown>).code,
        assertText(a.name ?? (before as Record<string, unknown>).name, 'Patient name', { max: 160 }),
        a.dob !== undefined ? (a.dob ? String(a.dob) : null) : (before as Record<string, unknown>).dob,
        a.age_years !== undefined ? num(a.age_years) : (before as Record<string, unknown>).age_years,
        str(a.gender ?? (before as Record<string, unknown>).gender, 16), str(a.blood_group ?? (before as Record<string, unknown>).blood_group, 16),
        optText(a.address ?? (before as Record<string, unknown>).address, 500), optText(a.phone ?? (before as Record<string, unknown>).phone, 32),
        optText(a.emergency_phone ?? (before as Record<string, unknown>).emergency_phone, 32),
        optText(a.emergency_contact ?? (before as Record<string, unknown>).emergency_contact, 120),
        optText(a.complaint ?? (before as Record<string, unknown>).complaint, 2000),
        optText(a.prev_problems ?? (before as Record<string, unknown>).prev_problems, 2000),
        optText(a.medical_notes ?? (before as Record<string, unknown>).medical_notes, 4000),
        optText(a.dental_notes ?? (before as Record<string, unknown>).dental_notes, 4000),
        optText(a.allergies ?? (before as Record<string, unknown>).allergies, 2000),
        optText(a.notes ?? (before as Record<string, unknown>).notes, 4000),
        a.dentist_id !== undefined ? numNull(a.dentist_id) : (before as Record<string, unknown>).dentist_id,
        optText(a.referral_source ?? (before as Record<string, unknown>).referral_source, 200),
        str(a.status ?? (before as Record<string, unknown>).status, 24), ctx.now(), id]);
    if (Array.isArray(a.tags)) {
      db.run('DELETE FROM patient_tags WHERE patient_id = ?', [id]);
      for (const t of (a.tags as unknown[]).slice(0, 20)) {
        const tag = String(t).trim().slice(0, 48);
        if (tag) db.run('INSERT INTO patient_tags (patient_id, tag) VALUES (?, ?)', [id, tag]);
      }
    }
  });
  ctx.audit('patient.updated', 'patient', id, `Patient #${id} updated`, before, a);
  ctx.persist();
  return { id };
}

function patientsDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.delete');
  const { db } = ctx;
  const id = assertInt(a.id, 'id', { min: 1 });
  const mode = String(a.mode ?? 'archive');
  const p = row<Record<string, unknown>>(db, 'SELECT * FROM patients WHERE id = ?', [id]);
  if (!p) throw new CommandError('NOT_FOUND', 'Patient not found.');
  if (mode === 'archive') {
    db.run('UPDATE patients SET status = ?, archived = 1, updated_at = ? WHERE id = ?', ['archived', ctx.now(), id]);
    ctx.audit('patient.archived', 'patient', id, `Patient ${p.name} (${p.code}) archived`, null, null);
    ctx.persist();
    return { id, mode };
  }
  // hard delete: refuse when financial records exist (RESTRICT-like guard with clear message)
  const inv = scalar<number>(db, 'SELECT COUNT(*) FROM invoices WHERE patient_id = ?', [id]);
  const pay = scalar<number>(db, 'SELECT COUNT(*) FROM payments WHERE patient_id = ?', [id]);
  if (inv > 0 || pay > 0) {
    throw new CommandError('HAS_FINANCIALS', `Cannot permanently delete: patient has ${inv} invoice(s) and ${pay} payment(s). Archive instead to preserve history.`);
  }
  const atts = all<{ stored_name: string }>(db, 'SELECT stored_name FROM patient_attachments WHERE patient_id = ?', [id]);
  txn(db, () => {
    db.run('DELETE FROM patients WHERE id = ?', [id]);
  });
  for (const t of atts) void fileDel(`p${id}/${t.stored_name}`);
  ctx.audit('patient.deleted', 'patient', id, `Patient ${p.name} (${p.code}) permanently deleted`, p, null);
  ctx.persist();
  return { id, mode };
}

function patientsMerge(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.merge');
  const { db } = ctx;
  const masterId = assertInt(a.masterId, 'masterId', { min: 1 });
  const dupId = assertInt(a.duplicateId, 'duplicateId', { min: 1 });
  if (masterId === dupId) throw new CommandError('VALIDATION', 'Master and duplicate must differ.');
  const m = row(db, 'SELECT * FROM patients WHERE id = ?', [masterId]);
  const d = row(db, 'SELECT * FROM patients WHERE id = ?', [dupId]);
  if (!m || !d) throw new CommandError('NOT_FOUND', 'Patient not found.');
  txn(db, () => {
    for (const t of ['visits', 'treatment_records', 'prescriptions', 'appointments', 'queue_entries', 'invoices', 'payments',
      'patient_attachments', 'patient_referrals', 'patient_medical_notes', 'patient_tags', 'patient_extra_contacts', 'dental_chart_records']) {
      db.run(`UPDATE ${t} SET patient_id = ? WHERE patient_id = ?`, [masterId, dupId]);
    }
    db.run('DELETE FROM patients WHERE id = ?', [dupId]);
  });
  ctx.audit('patient.merged', 'patient', masterId, `Patient #${dupId} merged into #${masterId}`, { dupId }, { masterId });
  ctx.persist();
  return { masterId };
}

function patientTimeline(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.view');
  const { db } = ctx;
  const id = assertInt(a.id, 'id', { min: 1 });
  const filter = String(a.filter ?? 'all');
  const clin = clinicalView(ctx);
  const fin = financialView(ctx);
  const events: Array<{ ts: string; type: string; group: string; title: string; detail: string; refId: number | null }> = [];
  const p = row<Record<string, unknown>>(db, 'SELECT * FROM patients WHERE id = ?', [id]);
  if (!p) throw new CommandError('NOT_FOUND', 'Patient not found.');
  events.push({ ts: `${p.reg_date}T00:00:00`, type: 'registration', group: 'record', title: 'Registered', detail: `Patient code ${p.code}`, refId: id });
  if (clin || filter === 'all') {
    for (const v of all<Record<string, unknown>>(db, 'SELECT v.*, d.name AS dentist_name FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id WHERE patient_id = ? ORDER BY visit_date DESC, id DESC', [id])) {
      events.push({ ts: `${v.visit_date}T12:00:00`, type: 'visit', group: 'clinical', title: `Visit — ${v.diagnosis || v.complaint || 'Consultation'}`, detail: String(v.dentist_name || ''), refId: v.id as number });
    }
    for (const t of all<Record<string, unknown>>(db, 'SELECT tr.*, c.name AS cname FROM treatment_records tr LEFT JOIN treatment_catalog c ON c.id = tr.treatment_id WHERE tr.patient_id = ? ORDER BY treatment_date DESC', [id])) {
      events.push({ ts: `${t.treatment_date}T12:00:00`, type: 'treatment', group: 'clinical', title: `Treatment — ${t.cname || t.custom_name}`, detail: String(t.tooth_codes || ''), refId: t.id as number });
    }
    for (const r of all<Record<string, unknown>>(db, 'SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY prescription_date DESC', [id])) {
      events.push({ ts: `${r.prescription_date}T12:00:00`, type: 'prescription', group: 'prescriptions', title: 'Prescription issued', detail: '', refId: r.id as number });
    }
    for (const r of all<Record<string, unknown>>(db, 'SELECT * FROM patient_referrals WHERE patient_id = ? ORDER BY referral_date DESC', [id])) {
      events.push({ ts: `${r.referral_date}T12:00:00`, type: 'referral', group: 'clinical', title: `Referral — ${r.referred_to || r.specialty}`, detail: String(r.reason || ''), refId: r.id as number });
    }
  }
  for (const ap of all<Record<string, unknown>>(db, 'SELECT * FROM appointments WHERE patient_id = ? ORDER BY appt_date DESC', [id])) {
    events.push({ ts: `${ap.appt_date}T${ap.appt_time}`, type: 'appointment', group: 'appointments', title: `Appointment — ${ap.status}`, detail: String(ap.reason || ''), refId: ap.id as number });
  }
  if (fin) {
    for (const i of all<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE patient_id = ? ORDER BY invoice_date DESC', [id])) {
      events.push({ ts: `${i.invoice_date}T12:00:00`, type: 'invoice', group: 'financial', title: `Invoice ${i.invoice_no} — ${i.status}`, detail: '', refId: i.id as number });
    }
    for (const py of all<Record<string, unknown>>(db, 'SELECT * FROM payments WHERE patient_id = ? ORDER BY payment_date DESC', [id])) {
      events.push({ ts: `${py.payment_date}T12:00:00`, type: 'payment', group: 'financial', title: `Payment ${py.receipt_no} — ${py.method}`, detail: '', refId: py.id as number });
    }
  }
  for (const at of all<Record<string, unknown>>(db, 'SELECT * FROM patient_attachments WHERE patient_id = ? ORDER BY created_at DESC', [id])) {
    events.push({ ts: String(at.created_at), type: 'attachment', group: 'documents', title: `Attachment — ${at.original_name}`, detail: '', refId: at.id as number });
  }
  const groups: Record<string, string[]> = {
    all: [], clinical: ['clinical', 'prescriptions'], financial: ['financial'], appointments: ['appointments'],
    documents: ['documents'], prescriptions: ['prescriptions'], treatment: ['clinical'],
  };
  const g = groups[filter] ?? [];
  const out = events
    .filter((e) => filter === 'all' || g.includes(e.group) || (filter === 'treatment' && e.type === 'treatment'))
    .sort((x, y) => (x.ts < y.ts ? 1 : -1));
  return out;
}

function patientFinancials(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('invoices.view');
  const id = assertInt(a.id, 'id', { min: 1 });
  const { db } = ctx;
  const totals = row<{ billed: number; paid: number }>(db,
    `SELECT COALESCE(SUM(total_paisa),0) AS billed, COALESCE(SUM(paid_paisa),0) AS paid FROM invoices WHERE patient_id = ? AND status != 'Cancelled'`, [id]);
  const invoices = all(db, 'SELECT * FROM invoices WHERE patient_id = ? ORDER BY invoice_date DESC, id DESC', [id]);
  const payments = all(db, 'SELECT * FROM payments WHERE patient_id = ? ORDER BY payment_date DESC, id DESC', [id]);
  return { billed: totals?.billed ?? 0, paid: totals?.paid ?? 0, outstanding: (totals?.billed ?? 0) - (totals?.paid ?? 0), invoices, payments };
}

// ------------------------------------------------------------------- visits
function visitsList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.view');
  const id = assertInt(a.patientId, 'patientId', { min: 1 });
  return all(ctx.db, 'SELECT v.*, d.name AS dentist_name, u.full_name AS created_by_name FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id LEFT JOIN users u ON u.id = v.created_by WHERE v.patient_id = ? ORDER BY v.visit_date DESC, v.id DESC', [id]);
}

function visitsCreate(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('clinical.create_visit');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const visitDate = assertDate(a.visitDate ?? ctx.today(), 'visitDate');
  const r = run(db,
    `INSERT INTO visits (patient_id, visit_date, dentist_id, complaint, history, examination, diagnosis, procedure_notes, advice, follow_up_date, referral_note, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, visitDate, numNull(a.dentistId), optText(a.complaint), optText(a.history), optText(a.examination),
      optText(a.diagnosis), optText(a.procedure_notes), optText(a.advice), a.followUpDate ? String(a.followUpDate) : null,
      optText(a.referral_note), optText(a.notes), me.id, ctx.now(), ctx.now()]);
  ctx.audit('visit.created', 'visit', r.lastId, `Visit recorded for patient #${patientId}`, null, { patientId, visitDate });
  if (a.followUpDate) {
    ctx.notify('info', 'appointment', 'Follow-up scheduled', `Patient #${patientId} follow-up on ${a.followUpDate}.`, 'patient', patientId, `patients/${patientId}`);
  }
  ctx.persist();
  return { id: r.lastId };
}

function visitsUpdate(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.edit_visit');
  const { db } = ctx;
  const id = assertInt(a.id, 'id', { min: 1 });
  const before = row(db, 'SELECT * FROM visits WHERE id = ?', [id]);
  if (!before) throw new CommandError('NOT_FOUND', 'Visit not found.');
  const b = before as Record<string, unknown>;
  db.run(`UPDATE visits SET visit_date = ?, dentist_id = ?, complaint = ?, history = ?, examination = ?, diagnosis = ?, procedure_notes = ?, advice = ?, follow_up_date = ?, referral_note = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [a.visitDate ? assertDate(a.visitDate, 'visitDate') : b.visit_date, a.dentistId !== undefined ? numNull(a.dentistId) : b.dentist_id,
      optText(a.complaint ?? b.complaint), optText(a.history ?? b.history), optText(a.examination ?? b.examination),
      optText(a.diagnosis ?? b.diagnosis), optText(a.procedure_notes ?? b.procedure_notes), optText(a.advice ?? b.advice),
      a.followUpDate !== undefined ? (a.followUpDate ? String(a.followUpDate) : null) : b.follow_up_date,
      optText(a.referral_note ?? b.referral_note), optText(a.notes ?? b.notes), ctx.now(), id]);
  ctx.audit('visit.updated', 'visit', id, `Visit #${id} updated`, before, a);
  ctx.persist();
  return { id };
}

function visitsDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.delete_visit');
  const id = assertInt(a.id, 'id', { min: 1 });
  const before = row(ctx.db, 'SELECT * FROM visits WHERE id = ?', [id]);
  if (!before) throw new CommandError('NOT_FOUND', 'Visit not found.');
  ctx.db.run('DELETE FROM visits WHERE id = ?', [id]);
  ctx.audit('visit.deleted', 'visit', id, `Visit #${id} deleted`, before, null);
  ctx.persist();
  return { id };
}

// -------------------------------------------------------------- dental chart
export const ADULT_TEETH = ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28','48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38'];
export const CHILD_TEETH = ['55','54','53','52','51','61','62','63','64','65','85','84','83','82','81','71','72','73','74','75'];

function chartGet(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.view');
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const recs = all(ctx.db, 'SELECT * FROM dental_chart_records WHERE patient_id = ? ORDER BY recorded_at DESC, id DESC', [patientId]);
  const latest: Record<string, unknown> = {};
  for (const r of recs as Array<Record<string, unknown>>) {
    if (!(r.tooth_code as string in latest)) latest[r.tooth_code as string] = r;
  }
  const types = all(ctx.db, 'SELECT * FROM tooth_condition_types ORDER BY sort');
  return { latest, history: recs, types };
}

function chartSet(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('clinical.chart');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const teeth = Array.isArray(a.teeth) ? (a.teeth as unknown[]).map(String) : [String(a.tooth)];
  const condition = assertText(a.condition, 'condition', { max: 32 });
  const valid = [...ADULT_TEETH, ...CHILD_TEETH];
  for (const t of teeth) {
    if (!valid.includes(t)) throw new CommandError('VALIDATION', `Invalid tooth code: ${t}`);
  }
  const type = row(db, 'SELECT code FROM tooth_condition_types WHERE code = ?', [condition]);
  if (!type) throw new CommandError('VALIDATION', 'Unknown tooth condition.');
  txn(db, () => {
    for (const t of teeth) {
      db.run(`INSERT INTO dental_chart_records (patient_id, tooth_code, condition_code, notes, treatment_id, dentist_id, recorded_by, recorded_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [patientId, t, condition, optText(a.notes, 1000), numNull(a.treatmentId), numNull(a.dentistId), me.id, ctx.now()]);
    }
  });
  ctx.audit('chart.updated', 'patient', patientId, `Dental chart updated (${teeth.join(', ')} → ${condition})`, null, { teeth, condition });
  ctx.persist();
  return { teeth };
}

// -------------------------------------------------------- treatment catalog
function treatmentsList(ctx: Ctx, a: Record<string, unknown>) {
  const q = String(a.search ?? '').trim();
  const activeOnly = a.activeOnly !== false;
  let sql = 'SELECT * FROM treatment_catalog';
  const w: string[] = [];
  const p: unknown[] = [];
  if (activeOnly) w.push('active = 1');
  if (q) { w.push('(name LIKE ? OR code LIKE ? OR category LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (w.length) sql += ` WHERE ${w.join(' AND ')}`;
  sql += ' ORDER BY category, name';
  return all(ctx.db, sql, p);
}

function treatmentsSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('treatments.manage');
  const { db } = ctx;
  const name = assertText(a.name, 'Treatment name', { max: 160 });
  const code = assertText(a.code, 'Treatment code', { max: 32 });
  const price = assertMoney(a.default_price_paisa ?? 0, 'price');
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    const dup = row(db, 'SELECT id FROM treatment_catalog WHERE code = ? AND id != ?', [code, id]);
    if (dup) throw new CommandError('DUPLICATE', 'Treatment code already exists.');
    db.run('UPDATE treatment_catalog SET code = ?, name = ?, category = ?, default_price_paisa = ?, duration_min = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?',
      [code, name, optText(a.category || 'General', 80), price, assertInt(a.duration_min ?? 30, 'duration', { min: 1, max: 1440 }), optText(a.notes, 2000), a.active === false ? 0 : 1, ctx.now(), id]);
    ctx.audit('treatment.updated', 'treatment', id, `Treatment ${name} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const dup = row(db, 'SELECT id FROM treatment_catalog WHERE code = ?', [code]);
  if (dup) throw new CommandError('DUPLICATE', 'Treatment code already exists.');
  const r = run(db, 'INSERT INTO treatment_catalog (code, name, category, default_price_paisa, duration_min, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [code, name, optText(a.category || 'General', 80), price, assertInt(a.duration_min ?? 30, 'duration', { min: 1, max: 1440 }), optText(a.notes, 2000), ctx.now(), ctx.now()]);
  ctx.audit('treatment.created', 'treatment', r.lastId, `Treatment ${name} created`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function treatmentRecordsCreate(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('clinical.create_visit');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const price = assertMoney(a.price_paisa ?? 0, 'price');
  const r = run(db, `INSERT INTO treatment_records (visit_id, patient_id, treatment_id, custom_name, tooth_codes, price_paisa, qty, notes, dentist_id, treatment_date, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [numNull(a.visitId), patientId, numNull(a.treatmentId), optText(a.customName, 160), optText(a.toothCodes, 120), price,
      assertInt(a.qty ?? 1, 'qty', { min: 1, max: 100 }), optText(a.notes, 2000), numNull(a.dentistId), assertDate(a.treatmentDate ?? ctx.today(), 'treatmentDate'), me.id, ctx.now()]);
  ctx.audit('treatment_record.created', 'treatment_record', r.lastId, `Treatment recorded for patient #${patientId}`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

// ------------------------------------------------------- medication catalog
function medicationsList(ctx: Ctx, a: Record<string, unknown>) {
  const q = String(a.search ?? '').trim();
  let sql = 'SELECT * FROM medication_catalog';
  const p: unknown[] = [];
  if (q) { sql += ' WHERE (name LIKE ? OR generic_name LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY name';
  return all(ctx.db, sql, p);
}

function medicationsSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('treatments.manage');
  const { db } = ctx;
  const name = assertText(a.name, 'Medicine name', { max: 160 });
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    db.run('UPDATE medication_catalog SET name = ?, generic_name = ?, strength = ?, form = ?, route = ?, default_dosage = ?, default_duration = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?',
      [name, optText(a.generic_name, 160), optText(a.strength, 64), optText(a.form || 'Tablet', 48), optText(a.route, 64), optText(a.default_dosage, 120), optText(a.default_duration, 120), optText(a.notes, 2000), a.active === false ? 0 : 1, ctx.now(), id]);
    ctx.audit('medication.updated', 'medication', id, `Medicine ${name} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const r = run(db, 'INSERT INTO medication_catalog (name, generic_name, strength, form, route, default_dosage, default_duration, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [name, optText(a.generic_name, 160), optText(a.strength, 64), optText(a.form || 'Tablet', 48), optText(a.route, 64), optText(a.default_dosage, 120), optText(a.default_duration, 120), optText(a.notes, 2000), ctx.now(), ctx.now()]);
  ctx.audit('medication.created', 'medication', r.lastId, `Medicine ${name} created`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

// ------------------------------------------------------------ prescriptions
function prescriptionsList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.view');
  const { db } = ctx;
  const w: string[] = [];
  const p: unknown[] = [];
  if (a.patientId) { w.push('r.patient_id = ?'); p.push(Number(a.patientId)); }
  if (a.from) { w.push('r.prescription_date >= ?'); p.push(String(a.from)); }
  if (a.to) { w.push('r.prescription_date <= ?'); p.push(String(a.to)); }
  if (a.dentistId) { w.push('r.dentist_id = ?'); p.push(Number(a.dentistId)); }
  if (a.search) { w.push('(pt.name LIKE ? OR pt.code LIKE ?)'); p.push(`%${a.search}%`, `%${a.search}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  return all(db, `SELECT r.*, pt.name AS patient_name, pt.code AS patient_code, d.name AS dentist_name,
    (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = r.id) AS item_count
    FROM prescriptions r JOIN patients pt ON pt.id = r.patient_id LEFT JOIN dentists d ON d.id = r.dentist_id
    ${where} ORDER BY r.prescription_date DESC, r.id DESC LIMIT 500`, p);
}

function prescriptionsGet(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.view');
  const id = assertInt(a.id, 'id', { min: 1 });
  const rx = row(ctx.db, `SELECT r.*, pt.name AS patient_name, pt.code AS patient_code, pt.gender, pt.dob, pt.age_years, pt.phone, pt.address,
    d.name AS dentist_name FROM prescriptions r JOIN patients pt ON pt.id = r.patient_id LEFT JOIN dentists d ON d.id = r.dentist_id WHERE r.id = ?`, [id]);
  if (!rx) throw new CommandError('NOT_FOUND', 'Prescription not found.');
  const items = all(ctx.db, 'SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id', [id]);
  const designations = all<{ designation: string }>(ctx.db, 'SELECT designation FROM dentist_designations WHERE dentist_id = (SELECT dentist_id FROM prescriptions WHERE id = ?) ORDER BY sort_order', [id]).map((d) => d.designation);
  return { ...rx, items, dentist_designations: designations };
}

function prescriptionsSave(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need(a.id ? 'prescriptions.edit' : 'prescriptions.create');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const items = Array.isArray(a.items) ? a.items : [];
  if (items.length === 0) throw new CommandError('VALIDATION', 'At least one medication is required.');
  if (items.length > 60) throw new CommandError('VALIDATION', 'Too many medication items (max 60).');
  const date = assertDate(a.prescriptionDate ?? ctx.today(), 'prescriptionDate');
  let id = 0;
  txn(db, () => {
    if (a.id) {
      id = assertInt(a.id, 'id', { min: 1 });
      const ex = row(db, 'SELECT id FROM prescriptions WHERE id = ?', [id]);
      if (!ex) throw new CommandError('NOT_FOUND', 'Prescription not found.');
      db.run('UPDATE prescriptions SET patient_id = ?, visit_id = ?, dentist_id = ?, prescription_date = ?, cc_text = ?, oe_text = ?, re_text = ?, advice = ?, follow_up = ?, notes = ? WHERE id = ?',
        [patientId, numNull(a.visitId), numNull(a.dentistId), date, optText(a.cc_text, 4000), optText(a.oe_text, 4000), optText(a.re_text, 4000), optText(a.advice, 4000), optText(a.followUp, 500), optText(a.notes, 4000), id]);
      db.run('DELETE FROM prescription_items WHERE prescription_id = ?', [id]);
    } else {
      const r = run(db, 'INSERT INTO prescriptions (patient_id, visit_id, dentist_id, prescription_date, cc_text, oe_text, re_text, advice, follow_up, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [patientId, numNull(a.visitId), numNull(a.dentistId), date, optText(a.cc_text, 4000), optText(a.oe_text, 4000), optText(a.re_text, 4000), optText(a.advice, 4000), optText(a.followUp, 500), optText(a.notes, 4000), me.id, ctx.now()]);
      id = r.lastId;
    }
    items.forEach((it0, idx) => {
      const it = it0 as Record<string, unknown>;
      const medName = assertText(it.medicine_name, `Medication #${idx + 1} name`, { max: 200 });
      db.run(`INSERT INTO prescription_items (prescription_id, medication_id, medicine_name, generic_name, strength, form, route, dosage, morning, noon, night, meal_relation, frequency, duration, quantity, instruction, prn, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, numNull(it.medication_id), medName, optText(it.generic_name, 200), optText(it.strength, 64), optText(it.form || 'Tablet', 48),
          optText(it.route, 64), optText(it.dosage, 120), optText(it.morning, 24), optText(it.noon, 24), optText(it.night, 24),
          optText(it.meal_relation, 48), optText(it.frequency, 64), optText(it.duration, 64), optText(it.quantity, 64),
          optText(it.instruction, 500), optText(it.prn, 200), optText(it.notes, 500), idx]);
    });
  });
  ctx.audit(a.id ? 'prescription.updated' : 'prescription.created', 'prescription', id, `Prescription #${id} ${a.id ? 'updated' : 'created'} (${items.length} item(s))`, null, { patientId });
  ctx.persist();
  return { id };
}

function prescriptionsDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('prescriptions.edit');
  const id = assertInt(a.id, 'id', { min: 1 });
  const before = row(ctx.db, 'SELECT * FROM prescriptions WHERE id = ?', [id]);
  if (!before) throw new CommandError('NOT_FOUND', 'Prescription not found.');
  ctx.db.run('DELETE FROM prescriptions WHERE id = ?', [id]);
  ctx.audit('prescription.deleted', 'prescription', id, `Prescription #${id} deleted`, before, null);
  ctx.persist();
  return { id };
}

// ------------------------------------------------------------ appointments
const APPT_STATUSES = ['Scheduled', 'Confirmed', 'Arrived', 'In Queue', 'In Progress', 'Completed', 'No Show', 'Cancelled', 'Rescheduled'];

function appointmentsList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('appointments.view');
  const { db } = ctx;
  const w: string[] = [];
  const p: unknown[] = [];
  if (a.from) { w.push('a.appt_date >= ?'); p.push(String(a.from)); }
  if (a.to) { w.push('a.appt_date <= ?'); p.push(String(a.to)); }
  if (a.dentistId) { w.push('a.dentist_id = ?'); p.push(Number(a.dentistId)); }
  if (a.status) { w.push('a.status = ?'); p.push(String(a.status)); }
  if (a.patientId) { w.push('a.patient_id = ?'); p.push(Number(a.patientId)); }
  if (a.search) { w.push('(pt.name LIKE ? OR pt.code LIKE ? OR pt.phone LIKE ?)'); p.push(`%${a.search}%`, `%${a.search}%`, `%${a.search}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  return all(db, `SELECT a.*, pt.name AS patient_name, pt.code AS patient_code, pt.phone AS patient_phone, d.name AS dentist_name
    FROM appointments a JOIN patients pt ON pt.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
    ${where} ORDER BY a.appt_date ASC, a.appt_time ASC LIMIT 2000`, p);
}

function appointmentsSave(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('appointments.manage');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const date = assertDate(a.apptDate, 'apptDate');
  const time = assertText(a.apptTime, 'apptTime', { max: 8 });
  if (!/^\d{1,2}:\d{2}/.test(time)) throw new CommandError('VALIDATION', 'Appointment time is invalid.');
  const status = String(a.status ?? 'Scheduled');
  if (!APPT_STATUSES.includes(status)) throw new CommandError('VALIDATION', 'Invalid appointment status.');
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    const before = row(db, 'SELECT * FROM appointments WHERE id = ?', [id]);
    if (!before) throw new CommandError('NOT_FOUND', 'Appointment not found.');
    db.run('UPDATE appointments SET patient_id = ?, dentist_id = ?, appt_date = ?, appt_time = ?, duration_min = ?, reason = ?, appt_type = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?',
      [patientId, numNull(a.dentistId), date, time, assertInt(a.durationMin ?? 30, 'duration', { min: 5, max: 480 }), optText(a.reason, 500), optText(a.apptType || 'General', 64), optText(a.notes, 2000), status, ctx.now(), id]);
    ctx.audit('appointment.updated', 'appointment', id, `Appointment #${id} → ${status}`, before, a);
    ctx.persist();
    return { id };
  }
  const r = run(db, 'INSERT INTO appointments (patient_id, dentist_id, appt_date, appt_time, duration_min, reason, appt_type, notes, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [patientId, numNull(a.dentistId), date, time, assertInt(a.durationMin ?? 30, 'duration', { min: 5, max: 480 }), optText(a.reason, 500), optText(a.apptType || 'General', 64), optText(a.notes, 2000), status, me.id, ctx.now(), ctx.now()]);
  ctx.audit('appointment.created', 'appointment', r.lastId, `Appointment #${r.lastId} scheduled (${date} ${time})`, null, a);
  if (date === ctx.today()) {
    ctx.notify('info', 'appointment', 'Appointment today', `Appointment #${r.lastId} scheduled for today at ${time}.`, 'appointment', r.lastId, 'appointments');
  }
  ctx.persist();
  return { id: r.lastId };
}

function appointmentsDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('appointments.manage');
  const id = assertInt(a.id, 'id', { min: 1 });
  const before = row(ctx.db, 'SELECT * FROM appointments WHERE id = ?', [id]);
  if (!before) throw new CommandError('NOT_FOUND', 'Appointment not found.');
  ctx.db.run('DELETE FROM appointments WHERE id = ?', [id]);
  ctx.audit('appointment.deleted', 'appointment', id, `Appointment #${id} deleted`, before, null);
  ctx.persist();
  return { id };
}

// ------------------------------------------------------------------- queue
function queueList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('queue.manage');
  const date = String(a.date ?? ctx.today());
  return all(ctx.db, `SELECT q.*, pt.name AS patient_name, pt.code AS patient_code, d.name AS dentist_name
    FROM queue_entries q JOIN patients pt ON pt.id = q.patient_id LEFT JOIN dentists d ON d.id = q.dentist_id
    WHERE q.queue_date = ? ORDER BY CASE q.status WHEN 'in_progress' THEN 0 WHEN 'called' THEN 1 WHEN 'waiting' THEN 2 WHEN 'hold' THEN 3 ELSE 4 END, q.queue_no ASC`, [date]);
}

function queueAdd(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('queue.manage');
  const { db } = ctx;
  const date = String(a.date ?? ctx.today());
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const existing = row(db, 'SELECT id FROM queue_entries WHERE queue_date = ? AND patient_id = ? AND status IN (\'waiting\',\'called\',\'in_progress\',\'hold\')', [date, patientId]);
  if (existing) throw new CommandError('DUPLICATE', 'Patient is already in the queue for this date.');
  const maxNo = scalar<number>(db, 'SELECT COALESCE(MAX(queue_no), 0) FROM queue_entries WHERE queue_date = ?', [date]);
  const r = run(db, 'INSERT INTO queue_entries (appointment_id, patient_id, dentist_id, queue_no, queue_date, arrival_time, priority, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'waiting\', ?, ?, ?)',
    [numNull(a.appointmentId), patientId, numNull(a.dentistId), maxNo + 1, date, ctx.now(), ['normal', 'urgent', 'vip'].includes(String(a.priority)) ? String(a.priority) : 'normal', optText(a.notes, 500), ctx.now(), ctx.now()]);
  if (a.appointmentId) db.run('UPDATE appointments SET status = \'In Queue\', updated_at = ? WHERE id = ?', [ctx.now(), Number(a.appointmentId)]);
  ctx.audit('queue.added', 'queue', r.lastId, `Patient #${patientId} added to queue (#${maxNo + 1})`, null, { date });
  void me;
  ctx.persist();
  return { id: r.lastId, queueNo: maxNo + 1 };
}

function queueAction(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('queue.manage');
  const { db } = ctx;
  const id = assertInt(a.id, 'id', { min: 1 });
  const action = String(a.action);
  const q = row<Record<string, unknown>>(db, 'SELECT * FROM queue_entries WHERE id = ?', [id]);
  if (!q) throw new CommandError('NOT_FOUND', 'Queue entry not found.');
  const map: Record<string, string> = { call: 'called', start: 'in_progress', hold: 'hold', return: 'waiting', complete: 'completed', cancel: 'cancelled' };
  const next = map[action];
  if (!next) throw new CommandError('VALIDATION', 'Invalid queue action.');
  txn(db, () => {
    db.run('UPDATE queue_entries SET status = ?, called_at = CASE WHEN ? = \'called\' THEN ? ELSE called_at END, started_at = CASE WHEN ? = \'in_progress\' THEN ? ELSE started_at END, completed_at = CASE WHEN ? IN (\'completed\',\'cancelled\') THEN ? ELSE completed_at END, updated_at = ? WHERE id = ?',
      [next, next, ctx.now(), next, ctx.now(), next, ctx.now(), ctx.now(), id]);
    if (q.appointment_id && (next === 'completed' || next === 'cancelled')) {
      db.run('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?', [next === 'completed' ? 'Completed' : 'Cancelled', ctx.now(), q.appointment_id]);
    }
    if (q.appointment_id && next === 'in_progress') {
      db.run('UPDATE appointments SET status = \'In Progress\', updated_at = ? WHERE id = ?', [ctx.now(), q.appointment_id]);
    }
  });
  ctx.audit('queue.updated', 'queue', id, `Queue #${q.queue_no} → ${next}`, { status: q.status }, { status: next });
  ctx.persist();
  return { id, status: next };
}

// --------------------------------------------------------------- referrals
function referralsList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.view');
  return all(ctx.db, 'SELECT * FROM patient_referrals WHERE patient_id = ? ORDER BY referral_date DESC', [assertInt(a.patientId, 'patientId', { min: 1 })]);
}

function referralsSave(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('clinical.referral');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const date = assertDate(a.referralDate ?? ctx.today(), 'referralDate');
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    db.run('UPDATE patient_referrals SET referred_by = ?, referred_to = ?, specialty = ?, reason = ?, referral_date = ?, notes = ?, follow_up = ?, status = ? WHERE id = ?',
      [optText(a.referredBy, 200), optText(a.referredTo, 200), optText(a.specialty, 120), optText(a.reason, 2000), date, optText(a.notes, 2000), optText(a.followUp, 500), optText(a.status || 'open', 32), id]);
    ctx.audit('referral.updated', 'referral', id, `Referral #${id} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const r = run(db, 'INSERT INTO patient_referrals (patient_id, referred_by, referred_to, specialty, reason, referral_date, notes, follow_up, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [patientId, optText(a.referredBy, 200), optText(a.referredTo, 200), optText(a.specialty, 120), optText(a.reason, 2000), date, optText(a.notes, 2000), optText(a.followUp, 500), optText(a.status || 'open', 32), me.id, ctx.now()]);
  ctx.audit('referral.created', 'referral', r.lastId, `Referral #${r.lastId} created for patient #${patientId}`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function referralsDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.referral');
  const id = assertInt(a.id, 'id', { min: 1 });
  ctx.db.run('DELETE FROM patient_referrals WHERE id = ?', [id]);
  ctx.audit('referral.deleted', 'referral', id, `Referral #${id} deleted`, null, null);
  ctx.persist();
  return { id };
}

// ------------------------------------------------------------- attachments
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf',
  'image/tiff', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

async function attachmentUpload(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.attachments');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const original = safeFilename(assertText(a.name, 'name', { max: 160 }));
  const mime = String(a.mime ?? 'application/octet-stream');
  if (!ALLOWED_MIME.includes(mime)) throw new CommandError('VALIDATION', `File type not supported: ${mime}`);
  const b64 = String(a.base64 ?? '');
  if (!b64) throw new CommandError('VALIDATION', 'Empty file.');
  const bytes = b64ToBytes(b64);
  if (bytes.length > 100 * 1024 * 1024) throw new CommandError('VALIDATION', 'File exceeds 100 MB limit.');
  const stored = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${original}`.slice(0, 150);
  await filePut(`p${patientId}/${stored}`, mime, original, bytes);
  const me = ctx.optionalSession();
  const r = run(db, 'INSERT INTO patient_attachments (patient_id, original_name, stored_name, mime, size_bytes, sha256, category, note, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [patientId, original, stored, mime, bytes.length, fnv1a(b64.slice(0, 200000)), optText(a.category || 'document', 48), optText(a.note, 1000), me?.id ?? null, ctx.now()]);
  ctx.audit('attachment.uploaded', 'attachment', r.lastId, `Attachment ${original} uploaded for patient #${patientId}`, null, { size: bytes.length });
  ctx.persist();
  return { id: r.lastId };
}

function attachmentsList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.view');
  return all(ctx.db, 'SELECT t.*, u.full_name AS uploaded_by_name FROM patient_attachments t LEFT JOIN users u ON u.id = t.uploaded_by WHERE t.patient_id = ? ORDER BY t.created_at DESC', [assertInt(a.patientId, 'patientId', { min: 1 })]);
}

async function attachmentGet(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.view');
  const id = assertInt(a.id, 'id', { min: 1 });
  const att = row<Record<string, unknown>>(ctx.db, 'SELECT * FROM patient_attachments WHERE id = ?', [id]);
  if (!att) throw new CommandError('NOT_FOUND', 'Attachment not found.');
  const f = await fileGet(`p${att.patient_id}/${att.stored_name}`);
  if (!f) throw new CommandError('FILE_MISSING', 'Attachment file is missing from storage. It may have been moved or deleted outside the app.');
  return { name: att.original_name, mime: att.mime, base64: bytesToB64(f.data) };
}

async function attachmentDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('patients.attachments');
  const id = assertInt(a.id, 'id', { min: 1 });
  const att = row<Record<string, unknown>>(ctx.db, 'SELECT * FROM patient_attachments WHERE id = ?', [id]);
  if (!att) throw new CommandError('NOT_FOUND', 'Attachment not found.');
  ctx.db.run('DELETE FROM patient_attachments WHERE id = ?', [id]);
  await fileDel(`p${att.patient_id}/${att.stored_name}`);
  ctx.audit('attachment.deleted', 'attachment', id, `Attachment ${att.original_name} deleted`, att, null);
  ctx.persist();
  return { id };
}

// ------------------------------------------------------------ medical notes
function mednotesList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('clinical.view');
  return all(ctx.db, 'SELECT n.*, u.full_name AS created_by_name FROM patient_medical_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.patient_id = ? ORDER BY n.created_at DESC', [assertInt(a.patientId, 'patientId', { min: 1 })]);
}

function mednotesCreate(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('clinical.create_visit');
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const note = assertText(a.note, 'note', { max: 4000 });
  const r = run(ctx.db, 'INSERT INTO patient_medical_notes (patient_id, note, created_by, created_at) VALUES (?, ?, ?, ?)', [patientId, note, me.id, ctx.now()]);
  ctx.audit('mednote.created', 'mednote', r.lastId, `Medical note added for patient #${patientId}`, null, null);
  ctx.persist();
  return { id: r.lastId };
}

export const clinicalHandlers: Record<string, Handler> = {
  patients_list: patientsList,
  patients_get: patientsGet,
  patients_create: patientsCreate,
  patients_update: patientsUpdate,
  patients_delete: patientsDelete,
  patients_merge: patientsMerge,
  patient_timeline: patientTimeline,
  patient_financials: patientFinancials,
  visits_list: visitsList,
  visits_create: visitsCreate,
  visits_update: visitsUpdate,
  visits_delete: visitsDelete,
  chart_get: chartGet,
  chart_set: chartSet,
  treatments_list: treatmentsList,
  treatments_save: treatmentsSave,
  treatment_records_create: treatmentRecordsCreate,
  medications_list: medicationsList,
  medications_save: medicationsSave,
  prescriptions_list: prescriptionsList,
  prescriptions_get: prescriptionsGet,
  prescriptions_save: prescriptionsSave,
  prescriptions_delete: prescriptionsDelete,
  appointments_list: appointmentsList,
  appointments_save: appointmentsSave,
  appointments_delete: appointmentsDelete,
  queue_list: queueList,
  queue_add: queueAdd,
  queue_action: queueAction,
  referrals_list: referralsList,
  referrals_save: referralsSave,
  referrals_delete: referralsDelete,
  attachments_list: attachmentsList,
  attachment_upload: attachmentUpload,
  attachment_get: attachmentGet,
  attachment_delete: attachmentDelete,
  mednotes_list: mednotesList,
  mednotes_create: mednotesCreate,
};
