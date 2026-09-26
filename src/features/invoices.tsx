// Dentiva Pro — invoices: builder, detail, payments, print.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, Select, SearchInput, Modal, EmptyState, Loading, StatusBadge, DateRangeBar } from '../components/ui';
import { PatientPicker, DentistSelect, PaymentModal } from './_modals';
import { PrintPreviewModal } from '../components/printPreview';
import { buildInvoiceHtml, type PrintPackage } from '../print/engine';
import { formatBdt, parseBdtToPaisa } from '../lib/money';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function InvoicesPage() {
  const { can, navigate, routeParam, dateFormat, toast, confirm, settings } = useApp();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ id?: number; patientId?: number } | null>(null);
  const [preview, setPreview] = useState<PrintPackage | null>(null);

  useEffect(() => {
    if (!routeParam) return;
    if (routeParam.startsWith('new')) {
      const m = /patient=(\d+)/.exec(routeParam);
      if (can('invoices.create')) setEditor({ patientId: m ? Number(m[1]) : undefined });
      window.location.hash = '#/invoices';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParam]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.invoicesList({ from, to, search: search || undefined, status: status || undefined, pageSize: 200 });
      setRows((r.rows as R[]) ?? []);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [from, to, search, status, toast]);

  useEffect(() => { void load(); }, [load]);

  const printInv = async (id: number) => {
    try {
      const [inv, clinic, logo] = await Promise.all([
        api.invoicesGet(id),
        api.clinicGet(),
        api.logoGet().catch(() => ({ base64: '', mime: '' })),
      ]);
      const i = inv as R;
      setPreview(buildInvoiceHtml({
        clinic: clinic as R,
        logoDataUrl: logo.base64 ? `data:${logo.mime};base64,${logo.base64}` : '',
        invoice: i,
        items: i.items ?? [],
        showSignature: settings.invoice_show_signature === '1',
        dateFormat,
      }));
    } catch (e) {
      toast({ kind: 'error', title: 'Print failed', message: friendlyError(e) });
    }
  };

  const remove = async (i: R) => {
    const ok = await confirm({ title: 'Delete invoice?', body: <p>Invoice <strong>{i.invoice_no}</strong> ({formatBdt(i.total_paisa)}) will be deleted. Invoices with payments cannot be deleted.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.invoicesDelete(i.id);
      toast({ kind: 'success', title: 'Invoice deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">Treatment billing with partial payments and due tracking.</p>
        </div>
        <div className="page-actions">
          {can('invoices.create') && <Btn kind="primary" onClick={() => setEditor({})}>+ New invoice</Btn>}
        </div>
      </div>

      <div className="card card-pad">
        <DateRangeBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoice / patient…" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['Paid', 'Partially Paid', 'Due', 'Overdue', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
        {loading && <Loading />}
        {!loading && rows.length === 0 && (
          <EmptyState title="No invoices" message="Create your first invoice to bill a treatment." action={can('invoices.create') ? <Btn kind="primary" onClick={() => setEditor({})}>+ New invoice</Btn> : undefined} />
        )}
        {!loading && rows.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Invoice</th><th>Patient</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td><span className="rowlink" onClick={() => navigate(`invoices/${i.id}`)}>{i.invoice_no}</span></td>
                  <td><span className="rowlink" onClick={() => navigate(`patients/${i.patient_id}`)}>{i.patient_name}</span><div className="cell-sub">{i.patient_code}</div></td>
                  <td>{formatDate(i.invoice_date, dateFormat)}</td>
                  <td className="num mono"><strong>{formatBdt(i.total_paisa)}</strong></td>
                  <td className="num mono">{formatBdt(i.paid_paisa)}</td>
                  <td className="num mono" style={{ color: i.total_paisa - i.paid_paisa > 0 ? 'var(--dp-danger)' : undefined }}><strong>{formatBdt(i.total_paisa - i.paid_paisa)}</strong></td>
                  <td><StatusBadge status={i.status} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Btn size="xs" kind="ghost" onClick={() => navigate(`invoices/${i.id}`)}>Open</Btn>
                    {can('invoices.print') && <Btn size="xs" kind="ghost" onClick={() => void printInv(i.id)}>Print</Btn>}
                    {can('invoices.delete') && <Btn size="xs" kind="ghost" onClick={() => void remove(i)}>Delete</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {editor && <InvoiceEditor id={editor.id} defaultPatientId={editor.patientId} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); void load(); if (id) navigate(`invoices/${id}`); }} />}
      {preview && <PrintPreviewModal docType="invoice" pkg={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

interface InvLine {
  key: number;
  treatmentId: number | null;
  description: string;
  toothCodes: string;
  qty: string;
  unitPrice: string;
}

export function InvoiceEditor({ id, defaultPatientId, onClose, onSaved }: { id?: number; defaultPatientId?: number; onClose: () => void; onSaved: (id?: number) => void }) {
  const { toast, settings } = useApp();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [patientId, setPatientId] = useState<number | ''>(defaultPatientId ?? '');
  const [dentistId, setDentistId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<InvLine[]>([{ key: 1, treatmentId: null, description: '', toothCodes: '', qty: '1', unitPrice: '' }]);
  const [catalog, setCatalog] = useState<R[]>([]);
  const [catalogQ, setCatalogQ] = useState('');
  const [paid, setPaid] = useState(0);

  useEffect(() => {
    api.treatmentsList('', true).then((t) => setCatalog(t as R[])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.invoicesGet(id).then((r) => {
      const inv = r as R;
      setPatientId(inv.patient_id);
      setDentistId(inv.dentist_id ? String(inv.dentist_id) : '');
      setDate(inv.invoice_date);
      setDiscount(inv.discount_paisa ? (inv.discount_paisa / 100).toFixed(2) : '');
      setNotes(inv.notes ?? '');
      setPaid(inv.paid_paisa ?? 0);
      setLines(((inv.items ?? []) as R[]).map((it, i) => ({ key: i + 1, treatmentId: it.treatment_id, description: it.description, toothCodes: it.tooth_codes ?? '', qty: String(it.qty), unitPrice: (it.unit_price_paisa / 100).toFixed(2) })));
    }).catch((e) => toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) }))
      .finally(() => setLoading(false));
  }, [id, toast]);

  const setLine = (key: number, patch: Partial<InvLine>) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const addTreatment = (t: R) => {
    setLines((l) => [...l, { key: Date.now() + Math.random(), treatmentId: t.id, description: t.name, toothCodes: '', qty: '1', unitPrice: (t.default_price_paisa / 100).toFixed(2) }]);
    setCatalogQ('');
  };

  const subtotal = lines.reduce((s, l) => {
    const q = parseInt(l.qty, 10) || 0;
    const u = parseBdtToPaisa(l.unitPrice || '0') ?? 0;
    return s + q * u;
  }, 0);
  const discountPaisa = parseBdtToPaisa(discount || '0') ?? 0;
  const taxPct = parseFloat(settings.invoice_tax_percent ?? '0') || 0;
  const tax = Math.round(((subtotal - discountPaisa) * taxPct) / 100);
  const total = Math.max(0, subtotal - discountPaisa + tax);

  const save = async () => {
    if (!patientId) {
      toast({ kind: 'error', title: 'Patient required' });
      return;
    }
    const valid = lines.filter((l) => l.description.trim());
    if (valid.length === 0) {
      toast({ kind: 'error', title: 'Add at least one item' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.invoicesSave({
        id, patientId, dentistId: dentistId || null, invoiceDate: date,
        discountPaisa, taxPaisa: tax, notes,
        items: valid.map((l) => ({
          treatmentId: l.treatmentId, description: l.description.trim(), toothCodes: l.toothCodes.trim(),
          qty: parseInt(l.qty, 10) || 1, unitPricePaisa: parseBdtToPaisa(l.unitPrice || '0') ?? 0,
        })),
      });
      toast({ kind: 'success', title: id ? 'Invoice updated' : `Invoice ${r.invoiceNo} created` });
      onSaved(r.id);
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const filtered = catalogQ ? catalog.filter((t) => t.name.toLowerCase().includes(catalogQ.toLowerCase()) || t.code.toLowerCase().includes(catalogQ.toLowerCase())).slice(0, 8) : [];

  return (
    <Modal title={id ? `Edit invoice #${id}` : 'New invoice'} onClose={onClose} size="xl" actions={
      <>
        <span className="muted small" style={{ marginRight: 'auto' }}>Total: <strong className="mono">{formatBdt(total)}</strong></span>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : id ? 'Save changes' : 'Create invoice'}</Btn>
      </>
    }>
      {loading && <Loading />}
      {!loading && (
        <>
          {paid > 0 && <div className="alert alert-warning">This invoice already has {formatBdt(paid)} in payments. Amount edits are restricted to protect history.</div>}
          <div className="form-grid-3">
            <div className="span-2"><Field label="Patient" required><PatientPicker value={patientId} onChange={(v) => setPatientId(v)} /></Field></div>
            <Field label="Date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <div className="span-3"><Field label="Dentist"><DentistSelect value={dentistId} onChange={setDentistId} /></Field></div>
          </div>
          <h4 className="mt-4" style={{ marginBottom: 6 }}>Items</h4>
          <div className="toolbar">
            <SearchInput value={catalogQ} onChange={setCatalogQ} placeholder="Add from treatment catalog…" />
            <Btn size="sm" kind="secondary" onClick={() => setLines((l) => [...l, { key: Date.now(), treatmentId: null, description: '', toothCodes: '', qty: '1', unitPrice: '' }])}>+ Custom item</Btn>
          </div>
          {filtered.length > 0 && (
            <div className="menu" style={{ position: 'static', marginBottom: 8, maxHeight: 180, overflowY: 'auto' }}>
              {filtered.map((t) => (
                <button key={t.id} className="menu-item" onClick={() => addTreatment(t)}>
                  <span><strong>{t.name}</strong> <span className="muted small">{t.code} · {formatBdt(t.default_price_paisa)}</span></span>
                </button>
              ))}
            </div>
          )}
          {lines.map((l, i) => (
            <div key={l.key} className="card card-pad mb-2" style={{ padding: 10 }}>
              <div className="form-grid-3">
                <div className="span-2"><Field label={`Item #${i + 1}`}><TextInput value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Treatment / service description" /></Field></div>
                <Field label="Teeth"><TextInput value={l.toothCodes} onChange={(e) => setLine(l.key, { toothCodes: e.target.value })} placeholder="11, 12" /></Field>
                <Field label="Qty"><TextInput type="number" min={1} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></Field>
                <Field label="Unit price (৳)"><TextInput value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} inputMode="decimal" placeholder="0.00" /></Field>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <strong className="mono">{formatBdt((parseInt(l.qty, 10) || 0) * (parseBdtToPaisa(l.unitPrice || '0') ?? 0))}</strong>
                  <Btn size="xs" kind="ghost" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}>Remove</Btn>
                </div>
              </div>
            </div>
          ))}
          <div className="form-grid mt-3">
            <Field label="Discount (৳)"><TextInput value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0.00" /></Field>
            <Field label={`Tax (${taxPct}%)`}><TextInput value={formatBdt(tax)} disabled /></Field>
            <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </>
      )}
    </Modal>
  );
}

export function InvoiceDetailPage({ id }: { id: string }) {
  const { can, navigate, dateFormat, toast, settings } = useApp();
  const iid = Number(id);
  const [inv, setInv] = useState<R | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [preview, setPreview] = useState<PrintPackage | null>(null);

  const load = useCallback(async () => {
    try {
      setInv(await api.invoicesGet(iid) as R);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  }, [iid, toast]);

  useEffect(() => { void load(); }, [load]);
  if (!inv) return <Loading />;

  const due = inv.total_paisa - inv.paid_paisa;

  const printInv = async () => {
    const [clinic, logo] = await Promise.all([api.clinicGet(), api.logoGet().catch(() => ({ base64: '', mime: '' }))]);
    setPreview(buildInvoiceHtml({
      clinic: clinic as R,
      logoDataUrl: logo.base64 ? `data:${logo.mime};base64,${logo.base64}` : '',
      invoice: inv,
      items: inv.items ?? [],
      showSignature: settings.invoice_show_signature === '1',
      dateFormat,
    }));
  };

  return (
    <div>
      <div className="page-head">
        <Btn kind="ghost" onClick={() => navigate('invoices')}>‹ Back</Btn>
        <div>
          <h1 className="page-title">{inv.invoice_no}</h1>
          <p className="page-sub">{formatDate(inv.invoice_date, dateFormat)} · <span className="rowlink" onClick={() => navigate(`patients/${inv.patient_id}`)}>{inv.patient_name} ({inv.patient_code})</span></p>
        </div>
        <div className="page-actions">
          <StatusBadge status={inv.status} />
          {can('invoices.edit') && <Btn kind="secondary" onClick={() => setEditOpen(true)}>Edit</Btn>}
          {can('payments.record') && due > 0 && <Btn kind="primary" onClick={() => setPayOpen(true)}>Record payment</Btn>}
          {can('invoices.print') && <Btn kind="secondary" onClick={() => void printInv()}>Print</Btn>}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <h3 className="card-title">Items</h3>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Description</th><th>Qty</th><th style={{ textAlign: 'right' }}>Unit</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {(inv.items as R[]).map((it) => (
                <tr key={it.id}>
                  <td>{it.description}{it.tooth_codes && <div className="cell-sub">Teeth: {it.tooth_codes}</div>}</td>
                  <td>{it.qty}</td>
                  <td className="num mono">{formatBdt(it.unit_price_paisa)}</td>
                  <td className="num mono"><strong>{formatBdt(it.line_total_paisa)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="mt-3" style={{ maxWidth: 300, marginLeft: 'auto' }}>
            <div className="flex justify-between small"><span>Subtotal</span><span className="mono">{formatBdt(inv.subtotal_paisa)}</span></div>
            {!!inv.discount_paisa && <div className="flex justify-between small"><span>Discount</span><span className="mono">− {formatBdt(inv.discount_paisa)}</span></div>}
            {!!inv.tax_paisa && <div className="flex justify-between small"><span>Tax</span><span className="mono">{formatBdt(inv.tax_paisa)}</span></div>}
            <div className="flex justify-between" style={{ fontWeight: 800, fontSize: 16, borderTop: '1px solid var(--dp-border)', marginTop: 6, paddingTop: 6 }}><span>Total</span><span className="mono">{formatBdt(inv.total_paisa)}</span></div>
            <div className="flex justify-between small"><span>Paid</span><span className="mono">{formatBdt(inv.paid_paisa)}</span></div>
            <div className="flex justify-between" style={{ fontWeight: 800, fontSize: 16, color: due > 0 ? 'var(--dp-danger)' : 'var(--dp-success)' }}><span>Due</span><span className="mono">{formatBdt(due)}</span></div>
          </div>
          {inv.notes && <p className="small mt-3"><strong>Notes:</strong> {inv.notes}</p>}
        </div>
        <div className="card card-pad">
          <h3 className="card-title">Payments</h3>
          {((inv.payments as R[]) ?? []).length === 0 && ((inv.allocations as R[]) ?? []).length === 0 && <p className="muted small">No payments recorded yet.</p>}
          {((inv.payments as R[]) ?? []).map((p) => (
            <div key={p.id} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
              <div><strong>{p.receipt_no}</strong><div className="cell-sub">{formatDate(p.payment_date, dateFormat)} · {p.method}</div></div>
              <strong className="mono">{formatBdt(p.amount_paisa)}</strong>
            </div>
          ))}
          {((inv.allocations as R[]) ?? []).filter((a) => !(inv.payments as R[] ?? []).some((p) => p.id === a.payment_id)).map((a) => (
            <div key={a.id} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
              <div><strong>{a.receipt_no}</strong><div className="cell-sub">Allocated from shared payment</div></div>
              <strong className="mono">{formatBdt(a.amount_paisa)}</strong>
            </div>
          ))}
        </div>
      </div>

      {editOpen && <InvoiceEditor id={iid} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void load(); }} />}
      {payOpen && <PaymentModal patientId={inv.patient_id} invoiceId={iid} duePaisa={due} onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); void load(); }} />}
      {preview && <PrintPreviewModal docType="invoice" pkg={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
