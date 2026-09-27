// Dentiva Pro — integration tests: full workflows through the command layer.
// Runs against the fallback backend (sql.js), which mirrors the Rust backend.

import { describe, it, expect, beforeAll } from 'vitest';
import { browserInvoke, __resetForTests, __testActivate } from '../../src/backend/browserBackend';
import { CommandError } from '../../src/lib/ipc';

// Tests must be date-independent: the backend stamps queue entries (and other
// day-scoped rows) with the real local day, so every test date derives from it.
const TODAY = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

// NOTE: the genuine product code NEVER appears in source (see SECURITY.md).
// Integration tests activate via the test-only __testActivate() hook; wrong-code
// rejection still goes through the real 'activate' command below.

async function setupFresh() {
  await __resetForTests();
  await __testActivate();
  await browserInvoke('setup_init', {
    clinic: { name: 'Test Dental Care', address: 'Dhaka', phone: '01700000000' },
    dentists: [{ name: 'Dr. Test', designations: ['BDS'], registrationNo: 'REG-1' }],
    admin: { fullName: 'Owner User', username: 'owner', password: 'Owner@12345' },
    preferences: { dateFormat: 'DD MMM YYYY', timeFormat: '12h', paperSize: 'A4', taxPercent: '0' },
    backup: { location: '', scheduleDays: '7' },
    security: { autoLock: '15' },
  });
}

beforeAll(async () => {
  await __resetForTests();
});

describe('activation & setup', () => {
  it('requires activation before setup', async () => {
    await __resetForTests();
    const s = (await browserInvoke('app_status', {})) as { activated: boolean; setupComplete: boolean };
    expect(s.activated).toBe(false);
    await expect(browserInvoke('setup_init', { clinic: {}, dentists: [], admin: {} })).rejects.toMatchObject({ code: 'NOT_ACTIVATED' });
  });

  it('rejects wrong codes through the real activate command', async () => {
    await __resetForTests();
    await expect(browserInvoke('activate', { code: '000000000000007' })).rejects.toMatchObject({ code: 'ACTIVATION_INVALID' });
    await expect(browserInvoke('activate', { code: 'not-a-code' })).rejects.toMatchObject({ code: 'ACTIVATION_INVALID' });
    const s = (await browserInvoke('app_status', {})) as { activated: boolean };
    expect(s.activated).toBe(false);
  });

  it('completes setup exactly once', async () => {
    await setupFresh();
    const s = (await browserInvoke('app_status', {})) as { setupComplete: boolean };
    expect(s.setupComplete).toBe(true);
    await expect(
      browserInvoke('setup_init', { clinic: { name: 'x' }, dentists: [{ name: 'y' }], admin: { fullName: 'z', username: 'u', password: 'Password1!' } }),
    ).rejects.toMatchObject({ code: 'ALREADY_SETUP' });
  });
});

describe('auth & lock', () => {
  it('rejects bad credentials and locks after repeated failures', async () => {
    await setupFresh();
    await expect(browserInvoke('login', { username: 'owner', password: 'wrong' })).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    for (let i = 0; i < 4; i++) {
      await expect(browserInvoke('login', { username: 'owner', password: 'wrong' })).rejects.toThrow();
    }
    await expect(browserInvoke('login', { username: 'owner', password: 'Owner@12345' })).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('logs in, locks, unlocks, and changes password', async () => {
    await setupFresh();
    const ok = (await browserInvoke('login', { username: 'OWNER', password: 'Owner@12345' })) as { session: { username: string } };
    expect(ok.session.username).toBe('owner');
    await browserInvoke('lock_app', {});
    await expect(browserInvoke('patients_list', { range: 'all' })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(browserInvoke('unlock', { password: 'nope' })).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await browserInvoke('unlock', { password: 'Owner@12345' });
    await browserInvoke('change_password', { current: 'Owner@12345', next: 'NewPass@12345' });
    await browserInvoke('logout', {});
    await expect(browserInvoke('login', { username: 'owner', password: 'Owner@12345' })).rejects.toThrow();
    await browserInvoke('login', { username: 'owner', password: 'NewPass@12345' });
  });
});

describe('patient journey', () => {
  it('registers, visits, charts, prescribes, and timelines a patient', async () => {
    await setupFresh();
    await browserInvoke('login', { username: 'owner', password: 'Owner@12345' });

    const p = (await browserInvoke('patients_create', {
      name: 'Karim Uddin', phone: '01711111111', gender: 'Male', age_years: 34,
      complaint: 'Tooth pain', allergies: 'Penicillin', tags: ['vip'],
    })) as { id: number; code: string };
    expect(p.code).toMatch(/^DP-/);

    // duplicate warning path
    const p2 = (await browserInvoke('patients_create', { name: 'Karim Uddin', phone: '01711111111' })) as { warnings: string[] };
    expect(p2.warnings.length).toBeGreaterThan(0);

    const list = (await browserInvoke('patients_list', { range: 'all', search: 'Karim' })) as { total: number };
    expect(list.total).toBeGreaterThanOrEqual(2);

    const dentists = (await browserInvoke('dentists_list', {})) as Array<{ id: number }>;
    await browserInvoke('visits_create', { patientId: p.id, visitDate: TODAY, dentistId: dentists[0].id, complaint: 'Pain', diagnosis: 'Caries' });

    await browserInvoke('chart_set', { patientId: p.id, teeth: ['16', '17'], condition: 'caries', notes: 'Deep' });
    const chart = (await browserInvoke('chart_get', { patientId: p.id })) as { latest: Record<string, { condition_code: string }> };
    expect(chart.latest['16'].condition_code).toBe('caries');

    const rx = (await browserInvoke('prescriptions_save', {
      patientId: p.id, dentistId: dentists[0].id, prescriptionDate: TODAY,
      cc_text: 'Pain', oe_text: 'Caries',
      items: [
        { medicine_name: 'Napa 500mg', form: 'Tablet', morning: '1', night: '1', duration: '7 days' },
        { medicine_name: 'Amoxicillin', form: 'Capsule', dosage: '1+1+1', duration: '5 days' },
      ],
    })) as { id: number };
    const rxGet = (await browserInvoke('prescriptions_get', { id: rx.id })) as { items: unknown[] };
    expect(rxGet.items.length).toBe(2);

    await browserInvoke('treatment_records_create', { patientId: p.id, customName: 'Filling', toothCodes: '16', price_paisa: 300000, treatmentDate: TODAY, dentistId: dentists[0].id });
    await browserInvoke('referrals_save', { patientId: p.id, referredTo: 'City Hospital', specialty: 'Oral Surgery', reason: 'Impaction', referralDate: TODAY });

    const timeline = (await browserInvoke('patient_timeline', { id: p.id, filter: 'all' })) as unknown[];
    expect(timeline.length).toBeGreaterThanOrEqual(5);

    // merge duplicate into master
    await browserInvoke('patients_merge', { masterId: p.id, duplicateId: p2 ? (await browserInvoke('patients_list', { range: 'all', search: 'Karim' }) as { rows: Array<{ id: number }> }).rows.find((r) => r.id !== p.id)!.id : 0 });
    const after = (await browserInvoke('patients_list', { range: 'all', search: 'Karim' })) as { total: number };
    expect(after.total).toBe(1);
  });
});

describe('appointments & queue', () => {
  it('schedules, checks in, and flows the queue', async () => {
    await setupFresh();
    await browserInvoke('login', { username: 'owner', password: 'Owner@12345' });
    const p = (await browserInvoke('patients_create', { name: 'Queue Patient' })) as { id: number };
    const ap = (await browserInvoke('appointments_save', {
      patientId: p.id, apptDate: TODAY, apptTime: '10:00', reason: 'Checkup',
    })) as { id: number };
    const q = (await browserInvoke('queue_add', { patientId: p.id, appointmentId: ap.id })) as { queueNo: number };
    expect(q.queueNo).toBe(1);
    await browserInvoke('queue_action', { id: (await browserInvoke('queue_list', { date: TODAY }) as Array<{ id: number }>)[0].id, action: 'call' });
    await browserInvoke('queue_action', { id: (await browserInvoke('queue_list', { date: TODAY }) as Array<{ id: number }>)[0].id, action: 'start' });
    const done = (await browserInvoke('queue_action', { id: (await browserInvoke('queue_list', { date: TODAY }) as Array<{ id: number }>)[0].id, action: 'complete' })) as { status: string };
    expect(done.status).toBe('completed');
    const appts = (await browserInvoke('appointments_list', { from: TODAY, to: TODAY })) as Array<{ status: string }>;
    expect(appts[0].status).toBe('Completed');
  });
});

describe('billing integrity', () => {
  it('invoices atomically, pays partially then fully, blocks overpay, reverses', async () => {
    await setupFresh();
    await browserInvoke('login', { username: 'owner', password: 'Owner@12345' });
    const p = (await browserInvoke('patients_create', { name: 'Billing Patient' })) as { id: number };
    const t = (await browserInvoke('treatments_save', { code: 'SCL-01', name: 'Scaling', default_price_paisa: 50000 })) as { id: number };

    const inv = (await browserInvoke('invoices_save', {
      patientId: p.id, invoiceDate: TODAY,
      items: [{ treatmentId: t.id, description: 'Scaling', qty: 1, unitPricePaisa: 50000 }],
    })) as { id: number; invoiceNo: string };

    // partial payment
    await browserInvoke('payments_create', { patientId: p.id, amountPaisa: 20000, method: 'bKash', paymentDate: TODAY, invoiceId: inv.id });
    let got = (await browserInvoke('invoices_get', { id: inv.id })) as { status: string; paid_paisa: number };
    expect(got.status).toBe('Partially Paid');
    expect(got.paid_paisa).toBe(20000);

    // overpay blocked
    await expect(
      browserInvoke('payments_create', { patientId: p.id, amountPaisa: 40000, method: 'Cash', paymentDate: TODAY, invoiceId: inv.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // pay remainder
    await browserInvoke('payments_create', { patientId: p.id, amountPaisa: 30000, method: 'Cash', paymentDate: TODAY, invoiceId: inv.id });
    got = (await browserInvoke('invoices_get', { id: inv.id })) as { status: string };
    expect(got.status).toBe('Paid');

    // catalog price change must NOT rewrite history
    await browserInvoke('treatments_save', { id: t.id, code: 'SCL-01', name: 'Scaling', default_price_paisa: 99999 });
    got = (await browserInvoke('invoices_get', { id: inv.id })) as { status: string; total_paisa: number };
    expect(got.total_paisa).toBe(50000);

    // delete-with-payments blocked
    await expect(browserInvoke('invoices_delete', { id: inv.id })).rejects.toMatchObject({ code: 'HAS_PAYMENTS' });

    // reverse a payment -> due returns
    const pays = (await browserInvoke('payments_list', { from: TODAY, to: TODAY })) as { rows: Array<{ id: number }> };
    await browserInvoke('payments_reverse', { id: pays.rows[0].id, reason: 'test reversal' });
    got = (await browserInvoke('invoices_get', { id: inv.id })) as { status: string };
    expect(got.status).toBe('Partially Paid');

    // patient financials consistent
    const fin = (await browserInvoke('patient_financials', { id: p.id })) as { billed: number; paid: number; outstanding: number };
    expect(fin.billed).toBe(50000);
    expect(fin.paid).toBe(20000);
    expect(fin.outstanding).toBe(30000);
  });
});

describe('inventory & accounting', () => {
  it('tracks batches FEFO, blocks oversell, adjusts with audit', async () => {
    await setupFresh();
    await browserInvoke('login', { username: 'owner', password: 'Owner@12345' });
    const item = (await browserInvoke('inventory_save', { sku: 'GLV-01', name: 'Gloves', unit: 'box', reorderLevel: 5 })) as { id: number };
    await browserInvoke('stock_receive', { itemId: item.id, qty: 10, batchNo: 'B1', purchaseDate: '2026-09-01' });
    await browserInvoke('stock_receive', { itemId: item.id, qty: 10, batchNo: 'B2', purchaseDate: '2026-09-02' });
    await browserInvoke('stock_issue', { itemId: item.id, qty: 12, reason: 'clinic use' });
    const got = (await browserInvoke('inventory_get', { id: item.id })) as { stock: number; batches: Array<{ batch_no: string; qty_remaining: number }> };
    expect(got.stock).toBe(8);
    expect(got.batches.find((b) => b.batch_no === 'B1')!.qty_remaining).toBe(0);
    await expect(browserInvoke('stock_issue', { itemId: item.id, qty: 999, reason: 'x' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await browserInvoke('stock_adjust', { itemId: item.id, qtyAfter: 10, reason: 'count correction' });
    const got2 = (await browserInvoke('inventory_get', { id: item.id })) as { stock: number };
    expect(got2.stock).toBe(10);

    await browserInvoke('expenses_save', { amountPaisa: 500000, date: TODAY, note: 'rent' });
    await browserInvoke('incomes_save', { amountPaisa: 100000, date: TODAY, note: 'misc' });
    const sum = (await browserInvoke('accounting_summary', { from: '2026-09-01', to: '2026-09-30' })) as { income: number; expense: number; net: number };
    expect(sum.income).toBe(100000);
    expect(sum.expense).toBe(500000);
    expect(sum.net).toBe(-400000);
  });
});

describe('RBAC enforcement at business layer', () => {
  it('denies financial operations to receptionist even via direct invoke', async () => {
    await setupFresh();
    await browserInvoke('login', { username: 'owner', password: 'Owner@12345' });
    const roles = (await browserInvoke('roles_list', {})) as { roles: Array<{ id: number; name: string }> };
    const recp = roles.roles.find((r) => r.name === 'Receptionist')!;
    await browserInvoke('users_save', { fullName: 'Recp User', username: 'recp', password: 'Recp@12345', roleId: recp.id });
    const p = (await browserInvoke('patients_create', { name: 'RBAC Patient' })) as { id: number };
    await browserInvoke('logout', {});
    await browserInvoke('login', { username: 'recp', password: 'Recp@12345' });

    // allowed
    await browserInvoke('patients_list', { range: 'all' });
    // denied at command layer
    await expect(browserInvoke('invoices_save', { patientId: p.id, items: [{ description: 'x', qty: 1, unitPricePaisa: 100 }] })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(browserInvoke('payments_create', { patientId: p.id, amountPaisa: 100, method: 'Cash' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(browserInvoke('patient_financials', { id: p.id })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(browserInvoke('report_run', { type: 'payments', from: '2026-01-01', to: '2026-12-31' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // search must not leak financial rows
    const res = (await browserInvoke('global_search', { query: 'RBAC' })) as Array<{ kind: string }>;
    expect(res.some((r) => r.kind === 'Invoice' || r.kind === 'Payment')).toBe(false);
  });
});

describe('backup & restore', () => {
  it('backs up, validates, restores with pre-restore safety', async () => {
    await setupFresh();
    await browserInvoke('login', { username: 'owner', password: 'Owner@12345' });
    await browserInvoke('patients_create', { name: 'Backup Patient' });
    const b = (await browserInvoke('backup_run', { kind: 'manual' })) as { filename: string; base64: string };
    expect(b.filename).toMatch(/DentivaPro_Backup_.*\.dentivabak/);
    const meta = (await browserInvoke('restore_validate', { filename: b.filename, base64: b.base64 })) as { checksumOk: boolean };
    expect(meta.checksumOk).toBe(true);
    await browserInvoke('patients_create', { name: 'After Backup Patient' });
    await expect(browserInvoke('restore_run', { filename: b.filename, base64: b.base64, typed: 'nope' })).rejects.toMatchObject({ code: 'CONFIRM' });
    await browserInvoke('restore_run', { filename: b.filename, base64: b.base64, typed: 'RESTORE' });
    const list = (await browserInvoke('patients_list', { range: 'all', search: 'After Backup' })) as { total: number };
    expect(list.total).toBe(0);
    const kept = (await browserInvoke('patients_list', { range: 'all', search: 'Backup Patient' })) as { total: number };
    expect(kept.total).toBe(1);
  });

  it('rejects corrupt backup payloads', async () => {
    await expect(browserInvoke('restore_validate', { filename: 'x', base64: 'bm90LWpzb24=' })).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
  });
});

describe('audit & notifications', () => {
  it('records actions and surfaces notifications', async () => {
    await setupFresh();
    await browserInvoke('login', { username: 'owner', password: 'Owner@12345' });
    await browserInvoke('patients_create', { name: 'Audit Patient' });
    const audit = (await browserInvoke('audit_list', { action: 'patient.created', pageSize: 5 })) as { rows: Array<{ username: string }> };
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0].username).toBe('owner');
    const notifs = (await browserInvoke('notifications_list', {})) as { rows: unknown[] };
    expect(Array.isArray(notifs.rows)).toBe(true);
  });
});

describe('error taxonomy', () => {
  it('uses coded CommandErrors', () => {
    const e = new CommandError('X', 'y');
    expect(e.code).toBe('X');
  });
});
