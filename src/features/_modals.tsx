// Dentiva Pro — shared quick-action modals (visits, appointments, payments…).

import { useEffect, useState } from 'react';
import { api, fileToBase64 } from '../api';
import { useApp } from '../state/app';
import { Modal, Btn, Field, TextInput, TextArea, Select, SearchInput } from '../components/ui';
import { todayISO, currentTimeHM } from '../lib/format';
import { parseBdtToPaisa } from '../lib/money';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function useDentists() {
  const [dentists, setDentists] = useState<R[]>([]);
  useEffect(() => {
    api.dentistsList().then((d) => setDentists((d as R[]).filter((x) => x.active))).catch(() => {});
  }, []);
  return dentists;
}

export function DentistSelect({ value, onChange, allowEmpty = true }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const dentists = useDentists();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">— Select dentist —</option>}
      {dentists.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
    </Select>
  );
}

export function PatientPicker({ value, onChange }: { value: number | ''; onChange: (id: number, patient: R | null) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<R[]>([]);
  const [chosen, setChosen] = useState<R | null>(null);

  useEffect(() => {
    if (!value) { setChosen(null); return; }
    api.patientsGet(Number(value)).then((p) => setChosen(p as R)).catch(() => {});
  }, [value]);

  useEffect(() => {
    if (!q.trim()) { setRows([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.patientsList({ range: 'all', search: q.trim(), pageSize: 8 });
        setRows(r.rows as R[]);
      } catch {
        setRows([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (chosen) {
    return (
      <div className="flex items-center gap-2">
        <div className="card card-pad" style={{ padding: '7px 12px', flex: 1 }}>
          <span className="cell-main">{chosen.name}</span> <span className="muted small">({chosen.code})</span>
        </div>
        <Btn size="sm" kind="ghost" onClick={() => { setChosen(null); onChange('' as unknown as number, null); }}>Change</Btn>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <SearchInput value={q} onChange={setQ} placeholder="Type name, code, or phone…" />
      {rows.length > 0 && (
        <div className="menu" style={{ left: 0, top: 40, right: 0, maxHeight: 240, overflowY: 'auto' }}>
          {rows.map((p) => (
            <button key={p.id} className="menu-item" onClick={() => { setChosen(p); onChange(p.id, p); setRows([]); setQ(''); }}>
              <span><span className="cell-main">{p.name}</span> <span className="muted small">{p.code} · {p.phone || '—'}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ visit
export function VisitModal({ patientId, visit, onClose, onSaved }: { patientId: number; visit?: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    visitDate: visit?.visit_date ?? todayISO(),
    dentistId: visit?.dentist_id ? String(visit.dentist_id) : '',
    complaint: visit?.complaint ?? '',
    history: visit?.history ?? '',
    examination: visit?.examination ?? '',
    diagnosis: visit?.diagnosis ?? '',
    procedure_notes: visit?.procedure_notes ?? '',
    advice: visit?.advice ?? '',
    followUpDate: visit?.follow_up_date ?? '',
    referral_note: visit?.referral_note ?? '',
    notes: visit?.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      if (visit?.id) await api.visitsUpdate({ id: visit.id, ...f, dentistId: f.dentistId || null });
      else await api.visitsCreate({ patientId, ...f, dentistId: f.dentistId || null });
      toast({ kind: 'success', title: visit?.id ? 'Visit updated' : 'Visit recorded' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save visit', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={visit?.id ? 'Edit visit' : 'New visit'} onClose={onClose} size="lg" actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save visit'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Visit date" required><TextInput type="date" value={f.visitDate} onChange={(e) => set('visitDate', e.target.value)} /></Field>
        <Field label="Dentist"><DentistSelect value={f.dentistId} onChange={(v) => set('dentistId', v)} /></Field>
        <div className="span-2"><Field label="Chief complaint"><TextArea value={f.complaint} onChange={(e) => set('complaint', e.target.value)} placeholder="Patient complains of…" /></Field></div>
        <Field label="History"><TextArea value={f.history} onChange={(e) => set('history', e.target.value)} /></Field>
        <Field label="Examination"><TextArea value={f.examination} onChange={(e) => set('examination', e.target.value)} /></Field>
        <div className="span-2"><Field label="Diagnosis / clinical findings"><TextArea value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} /></Field></div>
        <div className="span-2"><Field label="Procedure notes"><TextArea value={f.procedure_notes} onChange={(e) => set('procedure_notes', e.target.value)} /></Field></div>
        <div className="span-2"><Field label="Advice"><TextArea value={f.advice} onChange={(e) => set('advice', e.target.value)} /></Field></div>
        <Field label="Follow-up date"><TextInput type="date" value={f.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} /></Field>
        <Field label="Referral note"><TextInput value={f.referral_note} onChange={(e) => set('referral_note', e.target.value)} /></Field>
        <div className="span-2"><Field label="Additional notes"><TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ appointment
export const APPT_STATUSES = ['Scheduled', 'Confirmed', 'Arrived', 'In Queue', 'In Progress', 'Completed', 'No Show', 'Cancelled', 'Rescheduled'];

export function AppointmentModal({ appointment, defaultPatientId, defaultDate, onClose, onSaved }: { appointment?: R | null; defaultPatientId?: number | ''; defaultDate?: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [patientId, setPatientId] = useState<number | ''>(appointment?.patient_id ?? defaultPatientId ?? '');
  const [f, setF] = useState({
    dentistId: appointment?.dentist_id ? String(appointment.dentist_id) : '',
    apptDate: appointment?.appt_date ?? defaultDate ?? todayISO(),
    apptTime: (appointment?.appt_time ?? currentTimeHM()).slice(0, 5),
    durationMin: String(appointment?.duration_min ?? '30'),
    reason: appointment?.reason ?? '',
    apptType: appointment?.appt_type ?? 'General',
    notes: appointment?.notes ?? '',
    status: appointment?.status ?? 'Scheduled',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!patientId) {
      toast({ kind: 'error', title: 'Patient required', message: 'Choose a patient for this appointment.' });
      return;
    }
    setBusy(true);
    try {
      await api.appointmentsSave({ id: appointment?.id, patientId, dentistId: f.dentistId || null, apptDate: f.apptDate, apptTime: f.apptTime, durationMin: Number(f.durationMin) || 30, reason: f.reason, apptType: f.apptType, notes: f.notes, status: f.status });
      toast({ kind: 'success', title: appointment?.id ? 'Appointment updated' : 'Appointment scheduled' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save appointment', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={appointment?.id ? 'Edit appointment' : 'New appointment'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save appointment'}</Btn>
      </>
    }>
      <div className="form-grid">
        <div className="span-2"><Field label="Patient" required><PatientPicker value={patientId} onChange={(id) => setPatientId(id)} /></Field></div>
        <Field label="Dentist"><DentistSelect value={f.dentistId} onChange={(v) => set('dentistId', v)} /></Field>
        <Field label="Type"><Select value={f.apptType} onChange={(e) => set('apptType', e.target.value)}>
          {['General', 'Follow-up', 'Emergency', 'Consultation', 'Procedure', 'Review'].map((t) => <option key={t}>{t}</option>)}
        </Select></Field>
        <Field label="Date" required><TextInput type="date" value={f.apptDate} onChange={(e) => set('apptDate', e.target.value)} /></Field>
        <Field label="Time" required><TextInput type="time" value={f.apptTime} onChange={(e) => set('apptTime', e.target.value)} /></Field>
        <Field label="Duration (min)"><TextInput type="number" min={5} max={480} value={f.durationMin} onChange={(e) => set('durationMin', e.target.value)} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{APPT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <div className="span-2"><Field label="Reason"><TextInput value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Tooth pain, lower right" /></Field></div>
        <div className="span-2"><Field label="Notes"><TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- payment
export const PAY_METHODS = ['Cash', 'Bank', 'Card', 'bKash', 'Nagad', 'Rocket', 'Upay', 'Others'];

export function PaymentModal({ patientId, invoiceId, duePaisa, onClose, onSaved }: { patientId: number; invoiceId?: number; duePaisa?: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(duePaisa ? (duePaisa / 100).toFixed(2) : '');
  const [method, setMethod] = useState('Cash');
  const [date, setDate] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [openInvoices, setOpenInvoices] = useState<R[]>([]);
  const [alloc, setAlloc] = useState<Record<number, string>>({});

  useEffect(() => {
    if (invoiceId) return;
    api.financials(patientId).then((f) => {
      const invs = ((f as R).invoices as R[]).filter((i) => i.status !== 'Cancelled' && (i.total_paisa - i.paid_paisa) > 0);
      setOpenInvoices(invs);
    }).catch(() => {});
  }, [patientId, invoiceId]);

  const save = async () => {
    const paisa = parseBdtToPaisa(amount);
    if (paisa === null || paisa <= 0) {
      toast({ kind: 'error', title: 'Invalid amount', message: 'Enter a valid payment amount greater than zero.' });
      return;
    }
    setBusy(true);
    try {
      if (invoiceId) {
        await api.paymentsCreate({ patientId, amountPaisa: paisa, method, paymentDate: date, reference, notes, invoiceId });
      } else if (openInvoices.length > 0) {
        const allocations = openInvoices
          .map((i) => ({ invoiceId: i.id, amountPaisa: parseBdtToPaisa(alloc[i.id] ?? '') ?? 0 }))
          .filter((a) => a.amountPaisa > 0);
        const sum = allocations.reduce((s, a) => s + a.amountPaisa, 0);
        if (allocations.length === 0) {
          toast({ kind: 'error', title: 'No allocation', message: 'Distribute the payment across at least one open invoice.' });
          setBusy(false);
          return;
        }
        if (sum !== paisa) {
          toast({ kind: 'error', title: 'Allocation mismatch', message: 'Allocated total must equal the payment amount.' });
          setBusy(false);
          return;
        }
        await api.paymentsCreate({ patientId, amountPaisa: paisa, method, paymentDate: date, reference, notes, allocations });
      } else {
        await api.paymentsCreate({ patientId, amountPaisa: paisa, method, paymentDate: date, reference, notes });
      }
      toast({ kind: 'success', title: 'Payment recorded' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not record payment', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Record payment" onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Record payment'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Amount (৳)" required><TextInput value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus /></Field>
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reference"><TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Txn ID / cheque no." /></Field>
        <div className="span-2"><Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </div>
      {!invoiceId && openInvoices.length > 0 && (
        <div className="mt-3">
          <h4 style={{ margin: '0 0 8px' }}>Allocate to open invoices</h4>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Invoice</th><th>Due</th><th>Allocate (৳)</th></tr></thead>
            <tbody>
              {openInvoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.invoice_no}<div className="cell-sub">{i.invoice_date}</div></td>
                  <td className="num mono">{((i.total_paisa - i.paid_paisa) / 100).toFixed(2)}</td>
                  <td><TextInput value={alloc[i.id] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))} inputMode="decimal" placeholder="0.00" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------- referral
export function ReferralModal({ patientId, referral, onClose, onSaved }: { patientId: number; referral?: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    referredBy: referral?.referred_by ?? '', referredTo: referral?.referred_to ?? '', specialty: referral?.specialty ?? '',
    reason: referral?.reason ?? '', referralDate: referral?.referral_date ?? todayISO(), notes: referral?.notes ?? '',
    followUp: referral?.follow_up ?? '', status: referral?.status ?? 'open',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.referralsSave({ id: referral?.id, patientId, ...f });
      toast({ kind: 'success', title: 'Referral saved' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save referral', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={referral?.id ? 'Edit referral' : 'New referral'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save referral'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Referred by"><TextInput value={f.referredBy} onChange={(e) => set('referredBy', e.target.value)} /></Field>
        <Field label="Referred to"><TextInput value={f.referredTo} onChange={(e) => set('referredTo', e.target.value)} /></Field>
        <Field label="Specialty"><TextInput value={f.specialty} onChange={(e) => set('specialty', e.target.value)} /></Field>
        <Field label="Date"><TextInput type="date" value={f.referralDate} onChange={(e) => set('referralDate', e.target.value)} /></Field>
        <div className="span-2"><Field label="Reason"><TextArea value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field></div>
        <Field label="Follow-up"><TextInput value={f.followUp} onChange={(e) => set('followUp', e.target.value)} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option></Select></Field>
        <div className="span-2"><Field label="Notes"><TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ attachment
export function AttachmentModal({ patientId, onClose, onSaved }: { patientId: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('document');
  const [note, setNote] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const save = async () => {
    if (!file) {
      toast({ kind: 'error', title: 'No file chosen' });
      return;
    }
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      await api.attachmentUpload({ patientId, name: file.name, mime: file.type || 'application/octet-stream', base64, category, note });
      toast({ kind: 'success', title: 'Attachment uploaded' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Upload failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add attachment" onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy || !file} onClick={() => void save()}>{busy ? 'Uploading…' : 'Upload'}</Btn>
      </>
    }>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
        style={{ border: `2px dashed ${dragOver ? 'var(--dp-teal-600)' : 'var(--dp-border-strong)'}`, borderRadius: 10, padding: 22, textAlign: 'center', background: dragOver ? 'var(--dp-teal-50)' : 'var(--dp-surface-2)' }}
      >
        <div><strong>{file ? file.name : 'Drop a file here, or choose one'}</strong></div>
        <div className="muted small mt-2">Images, PDF, scans, reports · max 100 MB</div>
        <div className="mt-2"><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept="image/*,.pdf,.txt,.doc,.docx" /></div>
      </div>
      <div className="form-grid mt-3">
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {['document', 'xray', 'photo', 'report', 'prescription', 'consent', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
        </Select></Field>
        <Field label="Note"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
