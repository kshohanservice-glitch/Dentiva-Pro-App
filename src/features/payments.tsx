// Dentiva Pro — payments: method breakdown, list, reverse.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Select, SearchInput, EmptyState, Loading, DateRangeBar, StatusBadge } from '../components/ui';
import { PatientPicker, PaymentModal, PAY_METHODS } from './_modals';
import { Modal, Field, TextInput } from '../components/ui';
import { formatBdt } from '../lib/money';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function PaymentsPage() {
  const { can, navigate, dateFormat, toast, confirm } = useApp();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ rows: R[]; total: number; summary: R[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<R | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.paymentsList({ from, to, method: method || undefined, search: search || undefined, pageSize: 200 });
      setData(r as { rows: R[]; total: number; summary: R[] });
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [from, to, method, search, toast]);

  useEffect(() => { void load(); }, [load]);

  const total = (data?.summary ?? []).reduce((s, r) => s + (r.total ?? 0), 0);

  const reverse = async (reason: string) => {
    if (!reverseTarget) return;
    try {
      await api.paymentsReverse(reverseTarget.id, reason);
      toast({ kind: 'success', title: 'Payment reversed' });
      setReverseTarget(null);
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Reverse failed', message: friendlyError(e) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-sub">Every collection, by method and receipt.</p>
        </div>
        <div className="page-actions">
          {can('payments.record') && <Btn kind="primary" onClick={() => setPayOpen(true)}>+ Record payment</Btn>}
        </div>
      </div>

      <div className="grid grid-4 mb-3">
        <div className="stat-card"><div className="stat-label">Total collected</div><div className="stat-value">{formatBdt(total)}</div><div className="stat-foot">{from} → {to}</div></div>
        {PAY_METHODS.slice(0, 3).map((m) => (
          <div key={m} className="stat-card"><div className="stat-label">{m}</div><div className="stat-value">{formatBdt((data?.summary ?? []).find((s) => s.method === m)?.total ?? 0)}</div></div>
        ))}
      </div>
      <div className="grid grid-4 mb-3">
        {PAY_METHODS.slice(3).map((m) => (
          <div key={m} className="stat-card"><div className="stat-label">{m}</div><div className="stat-value">{formatBdt((data?.summary ?? []).find((s) => s.method === m)?.total ?? 0)}</div></div>
        ))}
      </div>

      <div className="card card-pad">
        <DateRangeBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search receipt / patient…" />
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All methods</option>
            {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
          </Select>
        </div>
        {loading && <Loading />}
        {!loading && (!data || data.rows.length === 0) && (
          <EmptyState title="No payments" message="Recorded payments will appear here." action={can('payments.record') ? <Btn kind="primary" onClick={() => setPayOpen(true)}>+ Record payment</Btn> : undefined} />
        )}
        {!loading && data && data.rows.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Receipt</th><th>Patient</th><th>Invoice</th><th>Date</th><th>Method</th><th style={{ textAlign: 'right' }}>Amount</th><th>By</th><th></th></tr></thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id} style={{ opacity: p.reversed ? 0.6 : 1 }}>
                  <td className="mono"><strong>{p.receipt_no}</strong>{p.reversed && <div><StatusBadge status="Reversed" /></div>}</td>
                  <td><span className="rowlink" onClick={() => navigate(`patients/${p.patient_id}`)}>{p.patient_name}</span><div className="cell-sub">{p.patient_code}</div></td>
                  <td>{p.invoice_no ? <span className="rowlink" onClick={() => navigate(`invoices/${p.invoice_id}`)}>{p.invoice_no}</span> : '—'}</td>
                  <td>{formatDate(p.payment_date, dateFormat)}</td>
                  <td>{p.method}{p.reference && <div className="cell-sub">{p.reference}</div>}</td>
                  <td className="num mono"><strong>{formatBdt(p.amount_paisa)}</strong></td>
                  <td>{p.created_by_name || '—'}</td>
                  <td>{can('payments.reverse') && !p.reversed && <Btn size="xs" kind="ghost" onClick={() => setReverseTarget(p)}>Reverse</Btn>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {payOpen && <PaymentForAnyone onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); void load(); }} />}
      {reverseTarget && <ReverseModal receipt={reverseTarget.receipt_no} onClose={() => setReverseTarget(null)} onConfirm={(r) => void reverse(r)} />}
      {void confirm}
    </div>
  );
}

function PaymentForAnyone({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [patientId, setPatientId] = useState<number | ''>('');
  const [go, setGo] = useState(false);
  if (go && patientId) return <PaymentModal patientId={patientId} onClose={onClose} onSaved={onSaved} />;
  return (
    <Modal title="Record payment" onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!patientId} onClick={() => setGo(true)}>Continue</Btn>
      </>
    }>
      <Field label="Patient" required><PatientPicker value={patientId} onChange={(id) => setPatientId(id)} /></Field>
    </Modal>
  );
}

function ReverseModal({ receipt, onClose, onConfirm }: { receipt: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Reverse payment ${receipt}?`} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>Reverse payment</Btn>
      </>
    }>
      <p className="small muted">The payment will be marked reversed and its allocations returned to the invoice(s) as due. This is audit-logged.</p>
      <Field label="Reason" required><TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered wrong amount" autoFocus /></Field>
    </Modal>
  );
}
