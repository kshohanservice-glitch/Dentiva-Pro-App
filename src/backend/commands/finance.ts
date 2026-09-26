// Dentiva Pro — billing/inventory/accounting/admin commands (fallback backend).

import type { Database } from 'sql.js';
import { CommandError } from '../../lib/ipc';
import { row, all, run, scalar, type Ctx, assertText, optText, assertDate, assertInt, assertMoney } from '../ctx';
import type { Handler } from './clinical';

function getSetting(db: Database, key: string, fallback = ''): string {
  const r = row<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ?', [key]);
  return r?.value ?? fallback;
}

function nextSeq(db: Database, prefixKey: string, nextKey: string): string {
  const prefix = getSetting(db, prefixKey, '');
  const next = parseInt(getSetting(db, nextKey, '1'), 10) || 1;
  db.run('UPDATE app_settings SET value = ? WHERE key = ?', [String(next + 1), nextKey]);
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}${ymd}-${String(next).padStart(4, '0')}`;
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

function invoiceStatus(total: number, paid: number, prevStatus?: string): string {
  if (prevStatus === 'Cancelled') return 'Cancelled';
  if (paid <= 0) return 'Due';
  if (paid >= total) return 'Paid';
  return 'Partially Paid';
}

// ---------------------------------------------------------------- invoices
function invoicesList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('invoices.view');
  const { db } = ctx;
  const w: string[] = [];
  const p: unknown[] = [];
  if (a.patientId) { w.push('i.patient_id = ?'); p.push(Number(a.patientId)); }
  if (a.from) { w.push('i.invoice_date >= ?'); p.push(String(a.from)); }
  if (a.to) { w.push('i.invoice_date <= ?'); p.push(String(a.to)); }
  if (a.status) { w.push('i.status = ?'); p.push(String(a.status)); }
  if (a.search) { w.push('(i.invoice_no LIKE ? OR pt.name LIKE ? OR pt.code LIKE ?)'); p.push(`%${a.search}%`, `%${a.search}%`, `%${a.search}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const page = Math.max(1, Number(a.page ?? 1));
  const pageSize = Math.min(200, Math.max(5, Number(a.pageSize ?? 25)));
  const total = scalar<number>(db, `SELECT COUNT(*) FROM invoices i JOIN patients pt ON pt.id = i.patient_id ${where}`, p);
  const rows = all(db, `SELECT i.*, pt.name AS patient_name, pt.code AS patient_code, d.name AS dentist_name
    FROM invoices i JOIN patients pt ON pt.id = i.patient_id LEFT JOIN dentists d ON d.id = i.dentist_id
    ${where} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  return { rows, total, page, pageSize };
}

function invoicesGet(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('invoices.view');
  const id = assertInt(a.id, 'id', { min: 1 });
  const inv = row(ctx.db, `SELECT i.*, pt.name AS patient_name, pt.code AS patient_code, pt.phone AS patient_phone, pt.address AS patient_address,
    d.name AS dentist_name FROM invoices i JOIN patients pt ON pt.id = i.patient_id LEFT JOIN dentists d ON d.id = i.dentist_id WHERE i.id = ?`, [id]);
  if (!inv) throw new CommandError('NOT_FOUND', 'Invoice not found.');
  const items = all(ctx.db, 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id', [id]);
  const payments = all(ctx.db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC', [id]);
  const allocs = all(ctx.db, 'SELECT pa.*, p.receipt_no FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ?', [id]);
  return { ...inv, items, payments, allocations: allocs };
}

function invoicesSave(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need(a.id ? 'invoices.edit' : 'invoices.create');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const items = Array.isArray(a.items) ? a.items : [];
  if (items.length === 0) throw new CommandError('VALIDATION', 'At least one invoice item is required.');
  const date = assertDate(a.invoiceDate ?? ctx.today(), 'invoiceDate');
  const discount = assertMoney(a.discountPaisa ?? 0, 'discount');
  const tax = assertMoney(a.taxPaisa ?? 0, 'tax');
  let subtotal = 0;
  const lines = items.map((it0, idx) => {
    const it = it0 as Record<string, unknown>;
    const desc = assertText(it.description, `Item #${idx + 1} description`, { max: 300 });
    const qty = assertInt(it.qty ?? 1, 'qty', { min: 1, max: 1000 });
    const unit = assertMoney(it.unitPricePaisa ?? 0, 'unit price');
    const line = qty * unit;
    subtotal += line;
    return { treatmentId: it.treatmentId ? Number(it.treatmentId) : null, description: desc, toothCodes: optText(it.toothCodes, 120), qty, unit, line };
  });
  if (discount > subtotal + tax) throw new CommandError('VALIDATION', 'Discount cannot exceed the invoice total.');
  const total = subtotal - discount + tax;
  let id = 0;
  let invoiceNo = '';
  txn(db, () => {
    if (a.id) {
      id = assertInt(a.id, 'id', { min: 1 });
      const ex = row<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', [id]);
      if (!ex) throw new CommandError('NOT_FOUND', 'Invoice not found.');
      if ((ex.paid_paisa as number) > 0 && !a.allowEditPaid) {
        throw new CommandError('HAS_PAYMENTS', 'This invoice has payments recorded. Editing amounts is blocked to protect history.');
      }
      if (total < (ex.paid_paisa as number)) throw new CommandError('VALIDATION', 'New total cannot be less than the amount already paid.');
      invoiceNo = String(ex.invoice_no);
      db.run('UPDATE invoices SET patient_id = ?, visit_id = ?, dentist_id = ?, invoice_date = ?, subtotal_paisa = ?, discount_paisa = ?, tax_paisa = ?, total_paisa = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?',
        [patientId, a.visitId ? Number(a.visitId) : null, a.dentistId ? Number(a.dentistId) : null, date, subtotal, discount, tax, total,
          invoiceStatus(total, ex.paid_paisa as number, String(ex.status)), optText(a.notes, 2000), ctx.now(), id]);
      db.run('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
    } else {
      invoiceNo = nextSeq(db, 'invoice_prefix', 'invoice_next');
      const r = run(db, 'INSERT INTO invoices (invoice_no, patient_id, visit_id, dentist_id, invoice_date, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, paid_paisa, status, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
        [invoiceNo, patientId, a.visitId ? Number(a.visitId) : null, a.dentistId ? Number(a.dentistId) : null, date, subtotal, discount, tax, total,
          total === 0 ? 'Paid' : 'Due', optText(a.notes, 2000), me.id, ctx.now(), ctx.now()]);
      id = r.lastId;
    }
    lines.forEach((l, idx) => {
      db.run('INSERT INTO invoice_items (invoice_id, treatment_id, description, tooth_codes, qty, unit_price_paisa, line_total_paisa, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, l.treatmentId, l.description, l.toothCodes, l.qty, l.unit, l.line, idx]);
    });
  });
  ctx.audit(a.id ? 'invoice.updated' : 'invoice.created', 'invoice', id, `Invoice ${invoiceNo} ${a.id ? 'updated' : 'created'} (total ${total} paisa)`, null, { patientId, total });
  ctx.persist();
  return { id, invoiceNo };
}

function invoicesDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('invoices.delete');
  const { db } = ctx;
  const id = assertInt(a.id, 'id', { min: 1 });
  const before = row<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', [id]);
  if (!before) throw new CommandError('NOT_FOUND', 'Invoice not found.');
  if ((before.paid_paisa as number) > 0) throw new CommandError('HAS_PAYMENTS', 'Cannot delete an invoice with recorded payments. Reverse the payments first.');
  txn(db, () => {
    db.run('UPDATE appointments SET status = \'Cancelled\' WHERE id = -1'); // no-op keeps txn shape simple
    db.run('DELETE FROM invoices WHERE id = ?', [id]);
  });
  ctx.audit('invoice.deleted', 'invoice', id, `Invoice ${before.invoice_no} deleted`, before, null);
  ctx.persist();
  return { id };
}

// ---------------------------------------------------------------- payments
const PAY_METHODS = ['Cash', 'Bank', 'Card', 'bKash', 'Nagad', 'Rocket', 'Upay', 'Others'];

function paymentsList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('payments.view');
  const { db } = ctx;
  const w: string[] = [];
  const p: unknown[] = [];
  if (a.from) { w.push('p.payment_date >= ?'); p.push(String(a.from)); }
  if (a.to) { w.push('p.payment_date <= ?'); p.push(String(a.to)); }
  if (a.method) { w.push('p.method = ?'); p.push(String(a.method)); }
  if (a.patientId) { w.push('p.patient_id = ?'); p.push(Number(a.patientId)); }
  if (a.search) { w.push('(p.receipt_no LIKE ? OR pt.name LIKE ? OR pt.code LIKE ?)'); p.push(`%${a.search}%`, `%${a.search}%`, `%${a.search}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const page = Math.max(1, Number(a.page ?? 1));
  const pageSize = Math.min(200, Math.max(5, Number(a.pageSize ?? 25)));
  const total = scalar<number>(db, `SELECT COUNT(*) FROM payments p JOIN patients pt ON pt.id = p.patient_id ${where}`, p);
  const rows = all(db, `SELECT p.*, pt.name AS patient_name, pt.code AS patient_code, i.invoice_no, u.full_name AS created_by_name
    FROM payments p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.created_by
    ${where} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  const summary = all<{ method: string; total: number }>(db, `SELECT p.method AS method, SUM(CASE WHEN p.reversed = 1 THEN 0 ELSE p.amount_paisa END) AS total FROM payments p JOIN patients pt ON pt.id = p.patient_id ${where} GROUP BY p.method`, p);
  return { rows, total, page, pageSize, summary };
}

function paymentsCreate(ctx: Ctx, a: Record<string, unknown>) {
  const me = ctx.need('payments.record');
  const { db } = ctx;
  const patientId = assertInt(a.patientId, 'patientId', { min: 1 });
  const amount = assertMoney(a.amountPaisa, 'amount');
  if (amount <= 0) throw new CommandError('VALIDATION', 'Payment amount must be greater than zero.');
  const method = String(a.method ?? 'Cash');
  if (!PAY_METHODS.includes(method)) throw new CommandError('VALIDATION', 'Invalid payment method.');
  const date = assertDate(a.paymentDate ?? ctx.today(), 'paymentDate');
  const allocReq = Array.isArray(a.allocations) ? (a.allocations as Array<{ invoiceId: number; amountPaisa: number }>) : [];
  let receiptNo = '';
  let paymentId = 0;
  txn(db, () => {
    receiptNo = nextSeq(db, 'receipt_prefix', 'receipt_next');
    const firstInvoice = allocReq.length === 1 ? allocReq[0].invoiceId : (a.invoiceId ? Number(a.invoiceId) : null);
    const r = run(db, 'INSERT INTO payments (receipt_no, invoice_id, patient_id, amount_paisa, method, reference, payment_date, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [receiptNo, firstInvoice, patientId, amount, method, optText(a.reference, 120), date, optText(a.notes, 2000), me.id, ctx.now()]);
    paymentId = r.lastId;
    let allocated = 0;
    if (allocReq.length > 0) {
      for (const al of allocReq) {
        const invId = assertInt(al.invoiceId, 'invoiceId', { min: 1 });
        const amt = assertMoney(al.amountPaisa, 'allocation');
        const inv = row<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', [invId]);
        if (!inv) throw new CommandError('NOT_FOUND', `Invoice #${invId} not found.`);
        if (inv.patient_id !== patientId) throw new CommandError('VALIDATION', 'Allocation invoice belongs to a different patient.');
        const due = (inv.total_paisa as number) - (inv.paid_paisa as number);
        if (amt > due) throw new CommandError('VALIDATION', `Allocation of ${amt} exceeds due ${due} on ${inv.invoice_no}.`);
        db.run('INSERT INTO payment_allocations (payment_id, invoice_id, amount_paisa) VALUES (?, ?, ?)', [paymentId, invId, amt]);
        const newPaid = (inv.paid_paisa as number) + amt;
        db.run('UPDATE invoices SET paid_paisa = ?, status = ?, updated_at = ? WHERE id = ?', [newPaid, invoiceStatus(inv.total_paisa as number, newPaid, String(inv.status)), ctx.now(), invId]);
        allocated += amt;
      }
      if (allocated !== amount) throw new CommandError('VALIDATION', 'Allocation total must equal the payment amount.');
    } else if (firstInvoice) {
      const inv = row<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', [firstInvoice]);
      if (!inv) throw new CommandError('NOT_FOUND', 'Invoice not found.');
      const due = (inv.total_paisa as number) - (inv.paid_paisa as number);
      if (amount > due) throw new CommandError('VALIDATION', `Payment exceeds invoice due (${due} paisa).`);
      db.run('INSERT INTO payment_allocations (payment_id, invoice_id, amount_paisa) VALUES (?, ?, ?)', [paymentId, firstInvoice, amount]);
      const newPaid = (inv.paid_paisa as number) + amount;
      db.run('UPDATE invoices SET paid_paisa = ?, status = ?, updated_at = ? WHERE id = ?', [newPaid, invoiceStatus(inv.total_paisa as number, newPaid, String(inv.status)), ctx.now(), firstInvoice]);
    }
  });
  ctx.audit('payment.recorded', 'payment', paymentId, `Payment ${receiptNo} recorded (${amount} paisa, ${method})`, null, { patientId, amount });
  ctx.persist();
  return { id: paymentId, receiptNo };
}

function paymentsReverse(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('payments.reverse');
  const { db } = ctx;
  const id = assertInt(a.id, 'id', { min: 1 });
  const reason = assertText(a.reason, 'reason', { max: 500 });
  const pay = row<Record<string, unknown>>(db, 'SELECT * FROM payments WHERE id = ?', [id]);
  if (!pay) throw new CommandError('NOT_FOUND', 'Payment not found.');
  if (pay.reversed) throw new CommandError('VALIDATION', 'Payment is already reversed.');
  const me = ctx.optionalSession();
  txn(db, () => {
    const allocs = all<Record<string, unknown>>(db, 'SELECT * FROM payment_allocations WHERE payment_id = ?', [id]);
    for (const al of allocs) {
      const inv = row<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', [al.invoice_id]);
      if (inv) {
        const newPaid = Math.max(0, (inv.paid_paisa as number) - (al.amount_paisa as number));
        db.run('UPDATE invoices SET paid_paisa = ?, status = ?, updated_at = ? WHERE id = ?', [newPaid, invoiceStatus(inv.total_paisa as number, newPaid, String(inv.status)), ctx.now(), al.invoice_id]);
      }
    }
    db.run('UPDATE payments SET reversed = 1, reversed_by = ?, reversed_at = ?, notes = ? WHERE id = ?',
      [me?.id ?? null, ctx.now(), `${String(pay.notes || '')}\n[REVERSED: ${reason}]`.trim(), id]);
  });
  ctx.audit('payment.reversed', 'payment', id, `Payment ${pay.receipt_no} reversed: ${reason}`, pay, { reason });
  ctx.persist();
  return { id };
}

// --------------------------------------------------------------- inventory
function stockBalance(db: Database, itemId: number): number {
  return scalar<number>(db, 'SELECT COALESCE(SUM(qty_remaining), 0) FROM inventory_batches WHERE item_id = ?', [itemId]);
}

function inventoryList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('inventory.view');
  const { db } = ctx;
  const q = String(a.search ?? '').trim();
  const w: string[] = [];
  const p: unknown[] = [];
  if (q) { w.push('(i.name LIKE ? OR i.sku LIKE ? OR i.category LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (a.category) { w.push('i.category = ?'); p.push(String(a.category)); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const rows = all<Record<string, unknown>>(db, `SELECT i.*, s.name AS supplier_name,
    COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id), 0) AS stock,
    (SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.qty_remaining > 0 AND b.expiry_date IS NOT NULL) AS nearest_expiry
    FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id ${where} ORDER BY i.name`, p);
  let out = rows;
  if (a.lowStockOnly) out = out.filter((r) => (r.stock as number) <= (r.reorder_level as number));
  if (a.expiringOnly) {
    const soon = new Date();
    soon.setDate(soon.getDate() + 90);
    const cutoff = soon.toISOString().slice(0, 10);
    out = out.filter((r) => r.nearest_expiry && String(r.nearest_expiry) <= cutoff);
  }
  return out;
}

function inventoryGet(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('inventory.view');
  const id = assertInt(a.id, 'id', { min: 1 });
  const item = row(ctx.db, 'SELECT i.*, s.name AS supplier_name FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ?', [id]);
  if (!item) throw new CommandError('NOT_FOUND', 'Item not found.');
  const batches = all(ctx.db, 'SELECT b.*, s.name AS supplier_name FROM inventory_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id WHERE b.item_id = ? ORDER BY b.expiry_date IS NULL, b.expiry_date, b.id', [id]);
  const txns = all(ctx.db, 'SELECT t.*, u.full_name AS performed_by_name FROM inventory_transactions t LEFT JOIN users u ON u.id = t.performed_by WHERE t.item_id = ? ORDER BY t.id DESC LIMIT 200', [id]);
  return { ...item, stock: stockBalance(ctx.db, id), batches, transactions: txns };
}

function inventorySave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('inventory.manage');
  const { db } = ctx;
  const name = assertText(a.name, 'Item name', { max: 160 });
  const sku = assertText(a.sku, 'SKU', { max: 48 });
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    const dup = row(db, 'SELECT id FROM inventory_items WHERE sku = ? AND id != ?', [sku, id]);
    if (dup) throw new CommandError('DUPLICATE', 'SKU already exists.');
    db.run('UPDATE inventory_items SET sku = ?, name = ?, category = ?, supplier_id = ?, unit = ?, purchase_price_paisa = ?, internal_value_paisa = ?, reorder_level = ?, expiry_managed = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?',
      [sku, name, optText(a.category || 'General', 80), a.supplierId ? Number(a.supplierId) : null, optText(a.unit || 'pcs', 24),
        assertMoney(a.purchasePricePaisa ?? 0, 'purchase price'), assertMoney(a.internalValuePaisa ?? 0, 'internal value'),
        assertInt(a.reorderLevel ?? 0, 'reorder level', { min: 0, max: 1000000 }), a.expiryManaged ? 1 : 0, optText(a.notes, 2000), a.active === false ? 0 : 1, ctx.now(), id]);
    ctx.audit('inventory.updated', 'inventory_item', id, `Inventory item ${sku} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const dup = row(db, 'SELECT id FROM inventory_items WHERE sku = ?', [sku]);
  if (dup) throw new CommandError('DUPLICATE', 'SKU already exists.');
  const r = run(db, 'INSERT INTO inventory_items (sku, name, category, supplier_id, unit, purchase_price_paisa, internal_value_paisa, reorder_level, expiry_managed, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [sku, name, optText(a.category || 'General', 80), a.supplierId ? Number(a.supplierId) : null, optText(a.unit || 'pcs', 24),
      assertMoney(a.purchasePricePaisa ?? 0, 'purchase price'), assertMoney(a.internalValuePaisa ?? 0, 'internal value'),
      assertInt(a.reorderLevel ?? 0, 'reorder level', { min: 0, max: 1000000 }), a.expiryManaged ? 1 : 0, optText(a.notes, 2000), ctx.now(), ctx.now()]);
  ctx.audit('inventory.created', 'inventory_item', r.lastId, `Inventory item ${sku} created`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function stockMove(ctx: Ctx, kind: 'receive' | 'issue' | 'adjust', a: Record<string, unknown>) {
  const me = ctx.need('inventory.manage');
  const { db } = ctx;
  const itemId = assertInt(a.itemId, 'itemId', { min: 1 });
  const item = row<Record<string, unknown>>(db, 'SELECT * FROM inventory_items WHERE id = ?', [itemId]);
  if (!item) throw new CommandError('NOT_FOUND', 'Item not found.');
  const reason = kind === 'receive' ? optText(a.reason ?? a.note, 500) : assertText(a.reason, 'reason', { max: 500 });
  let batchId: number | null = null;
  txn(db, () => {
    if (kind === 'receive') {
      const qty = assertInt(a.qty, 'qty', { min: 1, max: 1000000 });
      const r = run(db, 'INSERT INTO inventory_batches (item_id, batch_no, expiry_date, qty_received, qty_remaining, purchase_price_paisa, supplier_id, purchase_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [itemId, optText(a.batchNo, 64), a.expiryDate ? assertDate(a.expiryDate, 'expiryDate') : null, qty, qty,
          assertMoney(a.purchasePricePaisa ?? 0, 'purchase price'), a.supplierId ? Number(a.supplierId) : null,
          a.purchaseDate ? assertDate(a.purchaseDate, 'purchaseDate') : ctx.today(), optText(a.note, 500), ctx.now()]);
      batchId = r.lastId;
      const bal = stockBalance(db, itemId);
      db.run('INSERT INTO inventory_transactions (item_id, batch_id, kind, qty_delta, balance_after, reason, ref_type, performed_by, created_at) VALUES (?, ?, \'receive\', ?, ?, ?, \'\', ?, ?)',
        [itemId, batchId, qty, bal, reason, me.id, ctx.now()]);
    } else if (kind === 'issue') {
      const qty = assertInt(a.qty, 'qty', { min: 1, max: 1000000 });
      // FEFO: consume earliest-expiry batches first
      const batches = all<Record<string, unknown>>(db, 'SELECT * FROM inventory_batches WHERE item_id = ? AND qty_remaining > 0 ORDER BY expiry_date IS NULL, expiry_date, id', [itemId]);
      let remaining = qty;
      const touched: number[] = [];
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, b.qty_remaining as number);
        db.run('UPDATE inventory_batches SET qty_remaining = qty_remaining - ? WHERE id = ?', [take, b.id]);
        touched.push(b.id as number);
        remaining -= take;
      }
      if (remaining > 0) throw new CommandError('INSUFFICIENT_STOCK', `Insufficient stock: ${qty - remaining} available, ${qty} requested.`);
      batchId = touched[0] ?? null;
      const bal = stockBalance(db, itemId);
      db.run('INSERT INTO inventory_transactions (item_id, batch_id, kind, qty_delta, balance_after, reason, ref_type, performed_by, created_at) VALUES (?, ?, \'issue\', ?, ?, ?, \'\', ?, ?)',
        [itemId, batchId, -qty, bal, reason, me.id, ctx.now()]);
      if (bal <= (item.reorder_level as number)) {
        ctx.notify('warning', 'inventory', 'Low stock', `${item.name} is at ${bal} ${item.unit} (reorder level ${item.reorder_level}).`, 'inventory_item', itemId, 'inventory');
      }
    } else {
      const after = assertInt(a.qtyAfter, 'qtyAfter', { min: 0, max: 1000000 });
      const before = stockBalance(db, itemId);
      const delta = after - before;
      if (delta !== 0) {
        // Adjust via a virtual adjustment batch record for traceability
        let adj = row<Record<string, unknown>>(db, 'SELECT * FROM inventory_batches WHERE item_id = ? AND batch_no = \'ADJUST\'', [itemId]);
        if (!adj) {
          const r = run(db, 'INSERT INTO inventory_batches (item_id, batch_no, qty_received, qty_remaining, created_at) VALUES (?, \'ADJUST\', 0, 0, ?)', [itemId, ctx.now()]);
          adj = { id: r.lastId };
        }
        db.run('UPDATE inventory_batches SET qty_remaining = qty_remaining + ? WHERE id = ?', [delta, adj.id]);
        batchId = adj.id as number;
        db.run('INSERT INTO stock_adjustments (item_id, batch_id, qty_before, qty_after, reason, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [itemId, batchId, before, after, reason, me.id, ctx.now()]);
        db.run('INSERT INTO inventory_transactions (item_id, batch_id, kind, qty_delta, balance_after, reason, performed_by, created_at) VALUES (?, ?, \'adjust\', ?, ?, ?, ?, ?)',
          [itemId, batchId, delta, after, reason, me.id, ctx.now()]);
      }
    }
  });
  ctx.audit(`inventory.${kind}`, 'inventory_item', itemId, `Stock ${kind} for ${item.name}: ${reason}`, null, a);
  ctx.persist();
  return { itemId, batchId, stock: stockBalance(db, itemId) };
}

function suppliersList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('inventory.view');
  const q = String(a.search ?? '').trim();
  if (q) return all(ctx.db, 'SELECT * FROM suppliers WHERE name LIKE ? OR phone LIKE ? ORDER BY name', [`%${q}%`, `%${q}%`]);
  return all(ctx.db, 'SELECT * FROM suppliers ORDER BY name');
}

function suppliersSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('inventory.manage');
  const name = assertText(a.name, 'Supplier name', { max: 160 });
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    ctx.db.run('UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, active = ? WHERE id = ?',
      [name, optText(a.phone, 48), optText(a.email, 120), optText(a.address, 500), optText(a.notes, 2000), a.active === false ? 0 : 1, id]);
    ctx.audit('supplier.updated', 'supplier', id, `Supplier ${name} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const r = run(ctx.db, 'INSERT INTO suppliers (name, phone, email, address, notes, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    [name, optText(a.phone, 48), optText(a.email, 120), optText(a.address, 500), optText(a.notes, 2000), ctx.now()]);
  ctx.audit('supplier.created', 'supplier', r.lastId, `Supplier ${name} created`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function inventoryAlerts(ctx: Ctx) {
  ctx.need('inventory.view');
  const { db } = ctx;
  const items = all<Record<string, unknown>>(db, `SELECT i.*, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id), 0) AS stock,
    (SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.qty_remaining > 0 AND b.expiry_date IS NOT NULL) AS nearest_expiry
    FROM inventory_items i WHERE i.active = 1`);
  const soon = new Date(); soon.setDate(soon.getDate() + 90);
  const cutoff = soon.toISOString().slice(0, 10);
  const today = ctx.today();
  const low = items.filter((r) => (r.stock as number) <= (r.reorder_level as number));
  const out = items.filter((r) => (r.stock as number) <= 0);
  const expiring = items.filter((r) => r.nearest_expiry && String(r.nearest_expiry) >= today && String(r.nearest_expiry) <= cutoff);
  const expired = items.filter((r) => r.nearest_expiry && String(r.nearest_expiry) < today);
  return { low, out, expiring, expired, counts: { low: low.length, out: out.length, expiring: expiring.length, expired: expired.length } };
}

// -------------------------------------------------------------- accounting
function categoriesList(ctx: Ctx, a: Record<string, unknown>) {
  const kind = String(a.kind ?? '');
  if (kind) return all(ctx.db, 'SELECT * FROM accounting_categories WHERE kind = ? ORDER BY name', [kind]);
  return all(ctx.db, 'SELECT * FROM accounting_categories ORDER BY kind, name');
}

function categoriesSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('accounting.manage');
  const kind = String(a.kind);
  if (!['income', 'expense'].includes(kind)) throw new CommandError('VALIDATION', 'Category kind must be income or expense.');
  const name = assertText(a.name, 'Category name', { max: 120 });
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    ctx.db.run('UPDATE accounting_categories SET kind = ?, name = ?, description = ?, active = ? WHERE id = ?', [kind, name, optText(a.description, 300), a.active === false ? 0 : 1, id]);
    ctx.audit('category.updated', 'category', id, `Category ${name} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const r = run(ctx.db, 'INSERT INTO accounting_categories (kind, name, description, active) VALUES (?, ?, ?, 1)', [kind, name, optText(a.description, 300)]);
  ctx.audit('category.created', 'category', r.lastId, `Category ${name} created`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function moneyEntries(ctx: Ctx, table: 'expenses' | 'income_records', a: Record<string, unknown>, listOnly: boolean) {
  if (listOnly) {
    ctx.need('accounting.view');
    const w: string[] = [];
    const p: unknown[] = [];
    const dateCol = table === 'expenses' ? 'expense_date' : 'income_date';
    if (a.from) { w.push(`e.${dateCol} >= ?`); p.push(String(a.from)); }
    if (a.to) { w.push(`e.${dateCol} <= ?`); p.push(String(a.to)); }
    if (a.categoryId) { w.push('e.category_id = ?'); p.push(Number(a.categoryId)); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    return all(ctx.db, `SELECT e.*, c.name AS category_name, u.full_name AS created_by_name FROM ${table} e LEFT JOIN accounting_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by ${where} ORDER BY e.${dateCol} DESC, e.id DESC LIMIT 2000`, p);
  }
  const me = ctx.need('accounting.manage');
  const dateCol = table === 'expenses' ? 'expense_date' : 'income_date';
  if (a.delete) {
    const id = assertInt(a.id, 'id', { min: 1 });
    const before = row(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, [id]);
    ctx.db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    ctx.audit(`${table}.deleted`, table, id, `${table} #${id} deleted`, before, null);
    ctx.persist();
    return { id };
  }
  const amount = assertMoney(a.amountPaisa, 'amount');
  if (amount <= 0) throw new CommandError('VALIDATION', 'Amount must be greater than zero.');
  const date = assertDate(a.date ?? ctx.today(), 'date');
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    ctx.db.run(`UPDATE ${table} SET category_id = ?, amount_paisa = ?, ${dateCol} = ?, method = ?, reference = ?, note = ? WHERE id = ?`,
      [a.categoryId ? Number(a.categoryId) : null, amount, date, optText(a.method || 'Cash', 32), optText(a.reference, 120), optText(a.note, 2000), id]);
    ctx.audit(`${table}.updated`, table, id, `${table} #${id} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const r = run(ctx.db, `INSERT INTO ${table} (category_id, amount_paisa, ${dateCol}, method, reference, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.categoryId ? Number(a.categoryId) : null, amount, date, optText(a.method || 'Cash', 32), optText(a.reference, 120), optText(a.note, 2000), me.id, ctx.now()]);
  ctx.audit(`${table}.created`, table, r.lastId, `${table} #${r.lastId} recorded (${amount} paisa)`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function accountingSummary(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('accounting.view');
  const { db } = ctx;
  const from = String(a.from ?? '2000-01-01');
  const to = String(a.to ?? '2100-01-01');
  const income = scalar<number>(db, 'SELECT COALESCE(SUM(amount_paisa),0) FROM income_records WHERE income_date BETWEEN ? AND ?', [from, to]);
  const expense = scalar<number>(db, 'SELECT COALESCE(SUM(amount_paisa),0) FROM expenses WHERE expense_date BETWEEN ? AND ?', [from, to]);
  const byCategory = all(db, `SELECT c.name, c.kind, SUM(e.amount_paisa) AS total FROM expenses e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.expense_date BETWEEN ? AND ? GROUP BY c.name
    UNION ALL SELECT c.name, c.kind, SUM(e.amount_paisa) FROM income_records e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.income_date BETWEEN ? AND ? GROUP BY c.name`, [from, to, from, to]);
  const byMethod = all(db, `SELECT method, 'expense' AS kind, SUM(amount_paisa) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY method
    UNION ALL SELECT method, 'income', SUM(amount_paisa) FROM income_records WHERE income_date BETWEEN ? AND ? GROUP BY method`, [from, to, from, to]);
  const receivables = scalar<number>(db, 'SELECT COALESCE(SUM(total_paisa - paid_paisa),0) FROM invoices WHERE status IN (\'Due\',\'Partially Paid\')');
  return { income, expense, net: income - expense, byCategory, byMethod, receivables };
}

// ------------------------------------------------------------------- staff
function staffList(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('staff.view');
  const q = String(a.search ?? '').trim();
  const canManage = (ctx.optionalSession()?.permissions ?? []).some((p) => p === '*' || p === 'staff.manage');
  const rows = q
    ? all<Record<string, unknown>>(ctx.db, 'SELECT * FROM staff WHERE name LIKE ? OR phone LIKE ? OR role_title LIKE ? ORDER BY name', [`%${q}%`, `%${q}%`, `%${q}%`])
    : all<Record<string, unknown>>(ctx.db, 'SELECT * FROM staff ORDER BY name');
  if (!canManage) {
    // hide sensitive fields from view-only users
    return rows.map((r) => ({ ...r, salary_paisa: null, nid_no: '', address: '' }));
  }
  return rows;
}

function staffSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('staff.manage');
  const name = assertText(a.name, 'Staff name', { max: 160 });
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    ctx.db.run('UPDATE staff SET name = ?, dob = ?, gender = ?, address = ?, phone = ?, emergency_contact = ?, emergency_phone = ?, blood_group = ?, nid_no = ?, role_title = ?, department = ?, joining_date = ?, salary_paisa = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?',
      [name, a.dob ? String(a.dob) : null, optText(a.gender, 16), optText(a.address, 500), optText(a.phone, 48), optText(a.emergency_contact, 120),
        optText(a.emergency_phone, 48), optText(a.blood_group, 16), optText(a.nid_no, 64), optText(a.role_title, 120), optText(a.department, 120),
        a.joiningDate ? String(a.joiningDate) : null, assertMoney(a.salaryPaisa ?? 0, 'salary'), optText(a.notes, 4000), a.active === false ? 0 : 1, ctx.now(), id]);
    ctx.audit('staff.updated', 'staff', id, `Staff ${name} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const r = run(ctx.db, 'INSERT INTO staff (name, dob, gender, address, phone, emergency_contact, emergency_phone, blood_group, nid_no, role_title, department, joining_date, salary_paisa, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [name, a.dob ? String(a.dob) : null, optText(a.gender, 16), optText(a.address, 500), optText(a.phone, 48), optText(a.emergency_contact, 120),
      optText(a.emergency_phone, 48), optText(a.blood_group, 16), optText(a.nid_no, 64), optText(a.role_title, 120), optText(a.department, 120),
      a.joiningDate ? String(a.joiningDate) : null, assertMoney(a.salaryPaisa ?? 0, 'salary'), optText(a.notes, 4000), ctx.now(), ctx.now()]);
  ctx.audit('staff.created', 'staff', r.lastId, `Staff ${name} created`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function staffDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('staff.manage');
  const id = assertInt(a.id, 'id', { min: 1 });
  ctx.db.run('DELETE FROM staff WHERE id = ?', [id]);
  ctx.audit('staff.deleted', 'staff', id, `Staff #${id} deleted`, null, null);
  ctx.persist();
  return { id };
}

// ------------------------------------------------------------ users & roles
async function hashPasswordFallback(pw: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, key, 256);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `pbkdf2$210000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

function usersList(ctx: Ctx) {
  ctx.need('users.manage');
  return all(ctx.db, 'SELECT u.id, u.full_name, u.username, u.role_id, r.name AS role_name, u.active, u.last_login_at, u.created_at FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.username');
}

async function usersSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('users.manage');
  const { db } = ctx;
  const username = assertText(a.username, 'username', { max: 32 });
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new CommandError('VALIDATION', 'Username must be 3–32 chars (letters, digits, . _ -).');
  const roleId = assertInt(a.roleId, 'roleId', { min: 1 });
  const role = row(db, 'SELECT id FROM roles WHERE id = ?', [roleId]);
  if (!role) throw new CommandError('VALIDATION', 'Role not found.');
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    const dup = row(db, 'SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [username, id]);
    if (dup) throw new CommandError('DUPLICATE', 'Username already exists.');
    db.run('UPDATE users SET full_name = ?, username = ?, role_id = ?, active = ?, updated_at = ? WHERE id = ?',
      [assertText(a.fullName, 'full name', { max: 120 }), username, roleId, a.active === false ? 0 : 1, ctx.now(), id]);
    if (a.password) {
      const pw = String(a.password);
      if (pw.length < 8) throw new CommandError('VALIDATION', 'Password must be at least 8 characters.');
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPasswordFallback(pw), id]);
    }
    ctx.audit('user.updated', 'user', id, `User ${username} updated`, null, { roleId });
    ctx.persist();
    return { id };
  }
  const dup = row(db, 'SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
  if (dup) throw new CommandError('DUPLICATE', 'Username already exists.');
  const pw = String(a.password ?? '');
  if (pw.length < 8) throw new CommandError('VALIDATION', 'Password must be at least 8 characters.');
  const r = run(db, 'INSERT INTO users (full_name, username, password_hash, role_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [assertText(a.fullName, 'full name', { max: 120 }), username, await hashPasswordFallback(pw), roleId, ctx.now(), ctx.now()]);
  ctx.audit('user.created', 'user', r.lastId, `User ${username} created`, null, { roleId });
  ctx.persist();
  return { id: r.lastId };
}

function usersDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('users.manage');
  const id = assertInt(a.id, 'id', { min: 1 });
  const me = ctx.optionalSession();
  if (me && me.id === id) throw new CommandError('VALIDATION', 'You cannot delete your own account.');
  const target = row<Record<string, unknown>>(ctx.db, 'SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
  if (!target) throw new CommandError('NOT_FOUND', 'User not found.');
  if (target.role_name === 'Owner') {
    const owners = scalar<number>(ctx.db, 'SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = \'Owner\' AND u.active = 1');
    if (owners <= 1) throw new CommandError('VALIDATION', 'Cannot delete the last active Owner account.');
  }
  ctx.db.run('DELETE FROM users WHERE id = ?', [id]);
  ctx.audit('user.deleted', 'user', id, `User ${target.username} deleted`, target, null);
  ctx.persist();
  return { id };
}

function rolesList(ctx: Ctx) {
  ctx.need('roles.manage');
  const roles = all<Record<string, unknown>>(ctx.db, 'SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.name');
  const grants = all<{ role_id: number; permission_code: string }>(ctx.db, 'SELECT role_id, permission_code FROM role_permissions');
  const byRole: Record<number, string[]> = {};
  for (const g of grants) {
    byRole[g.role_id] = byRole[g.role_id] ?? [];
    byRole[g.role_id].push(g.permission_code);
  }
  const perms = all(ctx.db, 'SELECT * FROM permissions ORDER BY module, name');
  return { roles: roles.map((r) => ({ ...r, permissions: r.name === 'Owner' ? ['*'] : (byRole[r.id as number] ?? []) })), permissions: perms };
}

function rolesSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('roles.manage');
  const { db } = ctx;
  const name = assertText(a.name, 'Role name', { max: 64 });
  const perms = Array.isArray(a.permissions) ? (a.permissions as string[]) : [];
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    const before = row<Record<string, unknown>>(db, 'SELECT * FROM roles WHERE id = ?', [id]);
    if (!before) throw new CommandError('NOT_FOUND', 'Role not found.');
    if (before.system_role && name !== before.name) throw new CommandError('VALIDATION', 'System role names cannot be changed.');
    db.run('UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?', [name, optText(a.description, 300), ctx.now(), id]);
    db.run('DELETE FROM role_permissions WHERE role_id = ?', [id]);
    for (const p of perms) {
      if (p === '*') continue;
      db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)', [id, p]);
    }
    ctx.audit('role.updated', 'role', id, `Role ${name} updated`, { permissions: '…' }, { permissions: perms });
    ctx.persist();
    return { id };
  }
  const dup = row(db, 'SELECT id FROM roles WHERE LOWER(name) = LOWER(?)', [name]);
  if (dup) throw new CommandError('DUPLICATE', 'Role name already exists.');
  const r = run(db, 'INSERT INTO roles (name, description, system_role, created_at, updated_at) VALUES (?, ?, 0, ?, ?)', [name, optText(a.description, 300), ctx.now(), ctx.now()]);
  for (const p of perms) {
    if (p === '*') continue;
    db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)', [r.lastId, p]);
  }
  ctx.audit('role.created', 'role', r.lastId, `Role ${name} created`, null, { permissions: perms });
  ctx.persist();
  return { id: r.lastId };
}

function rolesDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('roles.manage');
  const id = assertInt(a.id, 'id', { min: 1 });
  const r = row<Record<string, unknown>>(ctx.db, 'SELECT * FROM roles WHERE id = ?', [id]);
  if (!r) throw new CommandError('NOT_FOUND', 'Role not found.');
  if (r.system_role) throw new CommandError('VALIDATION', 'System roles cannot be deleted.');
  const users = scalar<number>(ctx.db, 'SELECT COUNT(*) FROM users WHERE role_id = ?', [id]);
  if (users > 0) throw new CommandError('HAS_USERS', `Role is assigned to ${users} user(s). Reassign them first.`);
  ctx.db.run('DELETE FROM roles WHERE id = ?', [id]);
  ctx.audit('role.deleted', 'role', id, `Role ${r.name} deleted`, r, null);
  ctx.persist();
  return { id };
}

// ------------------------------------------------------------ clinic/dentists
function clinicGet(ctx: Ctx) {
  return row(ctx.db, 'SELECT * FROM clinic WHERE id = 1');
}

function clinicUpdate(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('settings.manage');
  const { db } = ctx;
  db.run(`UPDATE clinic SET name = ?, address = ?, phone = ?, email = ?, website = ?, opening_hours = ?, closing_hours = ?,
    weekly_off = ?, message = ?, footer_text = ?, logo_path = ?, updated_at = ? WHERE id = 1`,
    [assertText(a.name ?? 'Dental Care', 'Clinic name', { max: 200 }), optText(a.address, 500), optText(a.phone, 120), optText(a.email, 120),
      optText(a.website, 120), optText(a.openingHours, 60), optText(a.closingHours, 60), optText(a.weeklyOff, 120),
      optText(a.message, 1000), optText(a.footerText, 1000), a.logoPath !== undefined ? (a.logoPath ? String(a.logoPath) : null) : scalar(db, 'SELECT logo_path FROM clinic WHERE id = 1'), ctx.now()]);
  ctx.audit('clinic.updated', 'clinic', 1, 'Clinic information updated', null, null);
  ctx.persist();
  return { ok: true };
}

function dentistsList(ctx: Ctx) {
  const rows = all<Record<string, unknown>>(ctx.db, 'SELECT * FROM dentists ORDER BY sort_order, name');
  const out = [];
  for (const d of rows) {
    const des = all<{ designation: string }>(ctx.db, 'SELECT designation FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order', [d.id]).map((x) => x.designation);
    out.push({ ...d, designations: des });
  }
  return out;
}

function dentistsSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('settings.manage');
  const { db } = ctx;
  const name = assertText(a.name, 'Dentist name', { max: 160 });
  const designations = Array.isArray(a.designations) ? (a.designations as unknown[]).map((d) => String(d).trim()).filter(Boolean).slice(0, 10) : [];
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    db.run('UPDATE dentists SET name = ?, phone = ?, email = ?, registration_no = ?, active = ?, updated_at = ? WHERE id = ?',
      [name, optText(a.phone, 64), optText(a.email, 120), optText(a.registrationNo, 120), a.active === false ? 0 : 1, ctx.now(), id]);
    db.run('DELETE FROM dentist_designations WHERE dentist_id = ?', [id]);
    designations.forEach((d, i) => db.run('INSERT INTO dentist_designations (dentist_id, designation, sort_order) VALUES (?, ?, ?)', [id, d.slice(0, 200), i]));
    ctx.audit('dentist.updated', 'dentist', id, `Dentist ${name} updated`, null, a);
    ctx.persist();
    return { id };
  }
  const r = run(db, 'INSERT INTO dentists (name, phone, email, registration_no, active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    [name, optText(a.phone, 64), optText(a.email, 120), optText(a.registrationNo, 120), scalar<number>(db, 'SELECT COUNT(*) FROM dentists'), ctx.now(), ctx.now()]);
  designations.forEach((d, i) => db.run('INSERT INTO dentist_designations (dentist_id, designation, sort_order) VALUES (?, ?, ?)', [r.lastId, d.slice(0, 200), i]));
  ctx.audit('dentist.created', 'dentist', r.lastId, `Dentist ${name} created`, null, a);
  ctx.persist();
  return { id: r.lastId };
}

function dentistsDelete(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('settings.manage');
  const id = assertInt(a.id, 'id', { min: 1 });
  const refs = scalar<number>(ctx.db, 'SELECT COUNT(*) FROM appointments WHERE dentist_id = ?', [id])
    + scalar<number>(ctx.db, 'SELECT COUNT(*) FROM visits WHERE dentist_id = ?', [id]);
  if (refs > 0) {
    ctx.db.run('UPDATE dentists SET active = 0 WHERE id = ?', [id]);
    ctx.audit('dentist.deactivated', 'dentist', id, `Dentist #${id} deactivated (${refs} linked records preserved)`, null, null);
    ctx.persist();
    return { id, deactivated: true };
  }
  ctx.db.run('DELETE FROM dentists WHERE id = ?', [id]);
  ctx.audit('dentist.deleted', 'dentist', id, `Dentist #${id} deleted`, null, null);
  ctx.persist();
  return { id };
}

// ---------------------------------------------------------------- printers
function printerProfilesList(ctx: Ctx) {
  return all(ctx.db, 'SELECT * FROM printer_profiles ORDER BY document_type, name');
}

function printerProfilesSave(ctx: Ctx, a: Record<string, unknown>) {
  ctx.need('printers.manage');
  const { db } = ctx;
  const name = assertText(a.name, 'Profile name', { max: 120 });
  if (a.isDefault) db.run('UPDATE printer_profiles SET is_default = 0 WHERE document_type = ?', [String(a.documentType ?? 'prescription')]);
  if (a.id) {
    const id = assertInt(a.id, 'id', { min: 1 });
    db.run('UPDATE printer_profiles SET name = ?, document_type = ?, printer_name = ?, paper_size = ?, margins_mm = ?, orientation = ?, font_scale = ?, header_mode = ?, footer_mode = ?, copies = ?, is_default = ?, updated_at = ? WHERE id = ?',
      [name, optText(a.documentType || 'prescription', 32), optText(a.printerName, 160), optText(a.paperSize || 'A4', 24), optText(a.marginsMm || '12,12,14,12', 48),
        optText(a.orientation || 'portrait', 16), Number(a.fontScale ?? 1), optText(a.headerMode || 'full', 24), optText(a.footerMode || 'full', 24),
        assertInt(a.copies ?? 1, 'copies', { min: 1, max: 10 }), a.isDefault ? 1 : 0, ctx.now(), id]);
    ctx.persist();
    return { id };
  }
  const r = run(db, 'INSERT INTO printer_profiles (name, document_type, printer_name, paper_size, margins_mm, orientation, font_scale, header_mode, footer_mode, copies, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [name, optText(a.documentType || 'prescription', 32), optText(a.printerName, 160), optText(a.paperSize || 'A4', 24), optText(a.marginsMm || '12,12,14,12', 48),
      optText(a.orientation || 'portrait', 16), Number(a.fontScale ?? 1), optText(a.headerMode || 'full', 24), optText(a.footerMode || 'full', 24),
      assertInt(a.copies ?? 1, 'copies', { min: 1, max: 10 }), a.isDefault ? 1 : 0, ctx.now(), ctx.now()]);
  ctx.persist();
  return { id: r.lastId };
}

export const financeHandlers: Record<string, Handler> = {
  invoices_list: invoicesList,
  invoices_get: invoicesGet,
  invoices_save: invoicesSave,
  invoices_delete: invoicesDelete,
  payments_list: paymentsList,
  payments_create: paymentsCreate,
  payments_reverse: paymentsReverse,
  inventory_list: inventoryList,
  inventory_get: inventoryGet,
  inventory_save: inventorySave,
  stock_receive: (c, a) => stockMove(c, 'receive', a),
  stock_issue: (c, a) => stockMove(c, 'issue', a),
  stock_adjust: (c, a) => stockMove(c, 'adjust', a),
  suppliers_list: suppliersList,
  suppliers_save: suppliersSave,
  inventory_alerts: inventoryAlerts,
  categories_list: categoriesList,
  categories_save: categoriesSave,
  expenses_list: (c, a) => moneyEntries(c, 'expenses', a, true),
  expenses_save: (c, a) => moneyEntries(c, 'expenses', a, false),
  incomes_list: (c, a) => moneyEntries(c, 'income_records', a, true),
  incomes_save: (c, a) => moneyEntries(c, 'income_records', a, false),
  accounting_summary: accountingSummary,
  staff_list: staffList,
  staff_save: staffSave,
  staff_delete: staffDelete,
  users_list: usersList,
  users_save: usersSave,
  users_delete: usersDelete,
  roles_list: rolesList,
  roles_save: rolesSave,
  roles_delete: rolesDelete,
  clinic_get: clinicGet,
  clinic_update: clinicUpdate,
  dentists_list: dentistsList,
  dentists_save: dentistsSave,
  dentists_delete: dentistsDelete,
  printer_profiles_list: printerProfilesList,
  printer_profiles_save: printerProfilesSave,
};
