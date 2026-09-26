// Dentiva Pro — patients: list, registration, and full profile.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, TextArea, Select, SearchInput, Tabs, Pager, Modal, EmptyState, Loading, ErrorBox, StatusBadge, Badge } from '../components/ui';
import { DentistSelect, VisitModal, AppointmentModal, PaymentModal, ReferralModal, AttachmentModal, useDentists } from './_modals';
import { PrintPreviewModal } from '../components/printPreview';
import { buildSummaryHtml, type PrintPackage } from '../print/engine';
import { formatBdt } from '../lib/money';
import { formatDate, formatTime, todayISO, ageFromDob, initials, fileSize } from '../lib/format';
import { friendlyError, CommandError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'last365', label: 'Last 1 year' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'Name' },
  { id: 'code', label: 'Patient code' },
  { id: 'balance', label: 'Balance due' },
];

// ------------------------------------------------------------------ list
export function PatientsPage() {
  const { can, navigate, dateFormat, toast, confirm } = useApp();
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: R[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editPatient, setEditPatient] = useState<R | null>(null);
  const dentists = useDentists();

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.patientsList({ range, from, to, sort, search, dentistId: dentistId || undefined, status: status || undefined, page, pageSize: 25 });
      setData(r as { rows: R[]; total: number });
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [range, from, to, sort, search, dentistId, status, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [range, from, to, sort, search, dentistId, status]);

  const clearFilters = () => {
    setRange('today'); setSort('newest'); setSearch(''); setDentistId(''); setStatus(''); setPage(1);
  };

  const archive = async (p: R) => {
    const ok = await confirm({
      title: 'Archive patient?',
      body: <div><p><strong>{p.name}</strong> ({p.code}) will be archived. Clinical and financial history is preserved and the record stays searchable.</p></div>,
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    try {
      await api.patientsDelete(p.id, 'archive');
      toast({ kind: 'success', title: 'Patient archived' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not archive', message: friendlyError(e) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Patients</h1>
          <p className="page-sub">Register, find, and manage every patient of your clinic.</p>
        </div>
        <div className="page-actions">
          {can('patients.create') && <Btn kind="primary" onClick={() => { setEditPatient(null); setFormOpen(true); }}>+ New patient</Btn>}
        </div>
      </div>

      <div className="card card-pad">
        <div className="toolbar">
          {RANGES.map((r) => (
            <Btn key={r.id} size="sm" kind={range === r.id ? 'primary' : 'ghost'} onClick={() => setRange(r.id)}>{r.label}</Btn>
          ))}
        </div>
        {range === 'custom' && (
          <div className="toolbar">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} aria-label="From" />
            <span className="muted">to</span>
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} aria-label="To" />
          </div>
        )}
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, phone, address…" />
          <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
          </Select>
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)} aria-label="Dentist">
            <option value="">All dentists</option>
            {dentists.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </Select>
          <Btn size="sm" kind="ghost" onClick={clearFilters}>Clear filters</Btn>
        </div>

        {error && <ErrorBox message={error} onRetry={() => void load()} />}
        {!data && !error && <Loading />}
        {data && data.rows.length === 0 && (
          <EmptyState
            title="No patients found"
            message="Try a different date range or search, or register a new patient."
            action={can('patients.create') ? <Btn kind="primary" onClick={() => { setEditPatient(null); setFormOpen(true); }}>+ New patient</Btn> : undefined}
          />
        )}
        {data && data.rows.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Patient</th><th>Code</th><th>Phone</th><th>Dentist</th><th>Registered</th><th>Last visit</th><th style={{ textAlign: 'right' }}>Balance</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {data.rows.map((p) => (
                    <tr key={p.id}>
                      <td><span className="rowlink" onClick={() => navigate(`patients/${p.id}`)}>{p.name}</span><div className="cell-sub">{p.gender || '—'} · {p.age_years ? `${p.age_years} y` : ageFromDob(p.dob)}</div></td>
                      <td className="mono">{p.code}</td>
                      <td>{p.phone || '—'}</td>
                      <td>{p.dentist_name || '—'}</td>
                      <td>{formatDate(p.reg_date, dateFormat)}</td>
                      <td>{p.last_visit ? formatDate(p.last_visit, dateFormat) : '—'}</td>
                      <td className="num mono" style={{ color: p.balance > 0 ? 'var(--dp-danger)' : undefined, fontWeight: p.balance > 0 ? 700 : 400 }}>
                        {can('invoices.view') || can('payments.view') ? formatBdt(p.balance) : '—'}
                      </td>
                      <td><StatusBadge status={p.status} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Btn size="xs" kind="ghost" onClick={() => navigate(`patients/${p.id}`)}>Open</Btn>
                        {can('patients.edit') && <Btn size="xs" kind="ghost" onClick={() => { setEditPatient(p); setFormOpen(true); }}>Edit</Btn>}
                        {can('patients.delete') && p.status !== 'archived' && <Btn size="xs" kind="ghost" onClick={() => void archive(p)}>Archive</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </div>

      {formOpen && (
        <PatientFormModal
          patient={editPatient}
          onClose={() => { setFormOpen(false); setEditPatient(null); }}
          onSaved={(id) => { setFormOpen(false); setEditPatient(null); void load(); if (id) navigate(`patients/${id}`); }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ form
export function PatientFormModal({ patient, onClose, onSaved }: { patient?: R | null; onClose: () => void; onSaved: (id?: number) => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    code: patient?.code ?? '', name: patient?.name ?? '', dob: patient?.dob ?? '', age_years: patient?.age_years ? String(patient.age_years) : '',
    gender: patient?.gender ?? '', blood_group: patient?.blood_group ?? '', address: patient?.address ?? '', phone: patient?.phone ?? '',
    emergency_phone: patient?.emergency_phone ?? '', emergency_contact: patient?.emergency_contact ?? '',
    complaint: patient?.complaint ?? '', prev_problems: patient?.prev_problems ?? '', medical_notes: patient?.medical_notes ?? '',
    dental_notes: patient?.dental_notes ?? '', allergies: patient?.allergies ?? '', notes: patient?.notes ?? '',
    dentist_id: patient?.dentist_id ? String(patient.dentist_id) : '', referral_source: patient?.referral_source ?? '',
    status: patient?.status ?? 'active', tags: (patient?.tags as string[] | undefined)?.join(', ') ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) {
      toast({ kind: 'error', title: 'Name required', message: 'Patient name is required.' });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...f, name: f.name.trim(), code: f.code.trim() || undefined,
        age_years: f.age_years ? Number(f.age_years) : null,
        dentist_id: f.dentist_id ? Number(f.dentist_id) : null,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (patient?.id) {
        await api.patientsUpdate({ id: patient.id, ...payload });
        toast({ kind: 'success', title: 'Patient updated' });
        onSaved(patient.id);
      } else {
        const r = await api.patientsCreate(payload);
        if (r.warnings.length) toast({ kind: 'warning', title: 'Possible duplicate', message: r.warnings.join('\n') });
        else toast({ kind: 'success', title: `Patient registered (${r.code})` });
        onSaved(r.id);
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save patient', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={patient?.id ? 'Edit patient' : 'New patient'} onClose={onClose} size="lg" actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : patient?.id ? 'Save changes' : 'Register patient'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Patient name" required><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Full name (English or বাংলা)" /></Field>
        <Field label="Patient code" hint={patient?.id ? '' : 'Leave blank to auto-generate'}><TextInput value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="Date of birth"><TextInput type="date" value={f.dob} max={todayISO()} onChange={(e) => set('dob', e.target.value)} /></Field>
        <Field label="Age (years)"><TextInput type="number" min={0} max={130} value={f.age_years} onChange={(e) => set('age_years', e.target.value)} /></Field>
        <Field label="Gender"><Select value={f.gender} onChange={(e) => set('gender', e.target.value)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></Select></Field>
        <Field label="Blood group"><Select value={f.blood_group} onChange={(e) => set('blood_group', e.target.value)}><option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((b) => <option key={b}>{b}</option>)}</Select></Field>
        <div className="span-2"><Field label="Address"><TextInput value={f.address} onChange={(e) => set('address', e.target.value)} /></Field></div>
        <Field label="Phone"><TextInput value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="01XXXXXXXXX" /></Field>
        <Field label="Emergency phone"><TextInput value={f.emergency_phone} onChange={(e) => set('emergency_phone', e.target.value)} /></Field>
        <Field label="Emergency contact name"><TextInput value={f.emergency_contact} onChange={(e) => set('emergency_contact', e.target.value)} /></Field>
        <Field label="Assigned dentist"><DentistSelect value={f.dentist_id} onChange={(v) => set('dentist_id', v)} /></Field>
        <Field label="Primary complaint"><TextInput value={f.complaint} onChange={(e) => set('complaint', e.target.value)} /></Field>
        <Field label="Previous problems"><TextInput value={f.prev_problems} onChange={(e) => set('prev_problems', e.target.value)} /></Field>
        <Field label="Allergies"><TextInput value={f.allergies} onChange={(e) => set('allergies', e.target.value)} placeholder="Drug / food allergies" /></Field>
        <Field label="Referral source"><TextInput value={f.referral_source} onChange={(e) => set('referral_source', e.target.value)} /></Field>
        <Field label="Tags (comma separated)"><TextInput value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="vip, diabetic, …" /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></Select></Field>
        <Field label="Medical notes"><TextArea value={f.medical_notes} onChange={(e) => set('medical_notes', e.target.value)} /></Field>
        <Field label="Dental notes"><TextArea value={f.dental_notes} onChange={(e) => set('dental_notes', e.target.value)} /></Field>
        <div className="span-2"><Field label="Additional notes"><TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- profile
export function PatientProfilePage({ id }: { id: string }) {
  const { can, navigate, dateFormat, timeFormat, toast, confirm, settings } = useApp();
  const pid = Number(id);
  const [patient, setPatient] = useState<R | null>(null);
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'edit' | 'visit' | 'appointment' | 'payment' | 'referral' | 'attachment' | 'invoice' | null>(null);
  const [preview, setPreview] = useState<PrintPackage | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setPatient(await api.patientsGet(pid) as R);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [pid]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!patient) return <Loading />;
  if (Number.isNaN(pid)) return <ErrorBox message="Invalid patient id." />;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(can('clinical.view') ? [{ id: 'clinical', label: 'Clinical & Visits' }] : []),
    ...(can('clinical.chart') ? [{ id: 'chart', label: 'Dental Chart' }] : []),
    { id: 'timeline', label: 'Timeline' },
    ...(can('invoices.view') ? [{ id: 'financial', label: 'Financial' }] : []),
    ...(can('appointments.view') ? [{ id: 'appointments', label: 'Appointments' }] : []),
    { id: 'attachments', label: 'Attachments' },
  ];

  const printSummary = async () => {
    try {
      const [clinic, logo, visits, fin] = await Promise.all([
        api.clinicGet(),
        api.logoGet().catch(() => ({ base64: '', mime: '' })),
        can('clinical.view') ? api.visitsList(pid) : Promise.resolve([]),
        can('invoices.view') ? api.financials(pid).catch(() => null) : Promise.resolve(null),
      ]);
      setPreview(buildSummaryHtml({
        clinic: clinic as R,
        logoDataUrl: logo.base64 ? `data:${logo.mime};base64,${logo.base64}` : '',
        patient,
        visits: visits as R[],
        financials: fin as R | null,
        dateFormat,
      }));
    } catch (e) {
      toast({ kind: 'error', title: 'Could not prepare summary', message: friendlyError(e) });
    }
  };

  const deletePatient = async () => {
    const ok = await confirm({
      title: 'Permanently delete patient?',
      body: (
        <div>
          <p><strong>{patient.name}</strong> ({patient.code}) and all linked clinical records will be permanently deleted.</p>
          <p style={{ color: 'var(--dp-danger)', fontWeight: 600 }}>This cannot be undone. Patients with invoices or payments cannot be deleted — archive them instead.</p>
        </div>
      ),
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.patientsDelete(pid, 'delete');
      toast({ kind: 'success', title: 'Patient deleted' });
      navigate('patients');
    } catch (e) {
      toast({ kind: 'error', title: 'Could not delete', message: friendlyError(e) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <Btn kind="ghost" onClick={() => navigate('patients')}>‹ Back</Btn>
        <div className="avatar" style={{ width: 46, height: 46, fontSize: 17 }}>{initials(patient.name)}</div>
        <div>
          <h1 className="page-title">{patient.name} <span className="muted mono" style={{ fontSize: 15 }}>{patient.code}</span></h1>
          <p className="page-sub">{patient.gender || '—'} · {patient.age_years ? `${patient.age_years} y` : ageFromDob(patient.dob)} · {patient.phone || 'No phone'} · Registered {formatDate(patient.reg_date, dateFormat)}</p>
        </div>
        <div className="page-actions">
          <StatusBadge status={patient.status} />
          {can('patients.edit') && <Btn kind="secondary" onClick={() => setModal('edit')}>Edit</Btn>}
          {can('patients.delete') && <Btn kind="ghost" onClick={() => void deletePatient()}>Delete</Btn>}
        </div>
      </div>

      <div className="card card-pad mb-3">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <span className="small muted"><strong>Quick actions:</strong></span>
          {can('clinical.create_visit') && <Btn size="sm" kind="secondary" onClick={() => setModal('visit')}>+ New visit</Btn>}
          {can('appointments.manage') && <Btn size="sm" kind="secondary" onClick={() => setModal('appointment')}>+ Appointment</Btn>}
          {can('prescriptions.create') && <Btn size="sm" kind="secondary" onClick={() => navigate(`prescriptions/new?patient=${pid}`)}>+ Prescription</Btn>}
          {can('invoices.create') && <Btn size="sm" kind="secondary" onClick={() => navigate(`invoices/new?patient=${pid}`)}>+ Invoice</Btn>}
          {can('payments.record') && <Btn size="sm" kind="secondary" onClick={() => setModal('payment')}>Record payment</Btn>}
          {can('clinical.referral') && <Btn size="sm" kind="secondary" onClick={() => setModal('referral')}>+ Referral</Btn>}
          {can('patients.attachments') && <Btn size="sm" kind="secondary" onClick={() => setModal('attachment')}>+ Attachment</Btn>}
          {can('clinical.chart') && <Btn size="sm" kind="secondary" onClick={() => setTab('chart')}>Dental chart</Btn>}
          <Btn size="sm" kind="secondary" onClick={() => void printSummary()}>Print summary</Btn>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab patient={patient} />}
      {tab === 'clinical' && <ClinicalTab pid={pid} onNewVisit={() => setModal('visit')} />}
      {tab === 'chart' && <ChartTab pid={pid} />}
      {tab === 'timeline' && <TimelineTab pid={pid} />}
      {tab === 'financial' && <FinancialTab pid={pid} onPay={() => setModal('payment')} />}
      {tab === 'appointments' && <PatientAppointmentsTab pid={pid} onNew={() => setModal('appointment')} />}
      {tab === 'attachments' && <AttachmentsTab pid={pid} onNew={() => setModal('attachment')} />}

      {modal === 'edit' && <PatientFormModal patient={patient} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
      {modal === 'visit' && <VisitModal patientId={pid} onClose={() => setModal(null)} onSaved={() => { setModal(null); setTab('clinical'); }} />}
      {modal === 'appointment' && <AppointmentModal defaultPatientId={pid} onClose={() => setModal(null)} onSaved={() => setModal(null)} />}
      {modal === 'payment' && <PaymentModal patientId={pid} onClose={() => setModal(null)} onSaved={() => setModal(null)} />}
      {modal === 'referral' && <ReferralModal patientId={pid} onClose={() => setModal(null)} onSaved={() => { setModal(null); setTab('clinical'); }} />}
      {modal === 'attachment' && <AttachmentModal patientId={pid} onClose={() => setModal(null)} onSaved={() => { setModal(null); setTab('attachments'); }} />}
      {preview && <PrintPreviewModal docType="summary" pkg={preview} onClose={() => setPreview(null)} />}
      {void timeFormat}
      {void settings}
    </div>
  );
}

function OverviewTab({ patient }: { patient: R }) {
  const { can } = useApp();
  const rows: Array<[string, string]> = [
    ['Patient code', patient.code],
    ['Phone', patient.phone || '—'],
    ['Emergency', patient.emergency_contact ? `${patient.emergency_contact} (${patient.emergency_phone || '—'})` : (patient.emergency_phone || '—')],
    ['Address', patient.address || '—'],
    ['Blood group', patient.blood_group || '—'],
    ['Assigned dentist', patient.dentist_name || '—'],
    ['Referral source', patient.referral_source || '—'],
    ['Tags', (patient.tags as string[] ?? []).join(', ') || '—'],
  ];
  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <h3 className="card-title">Identity & contact</h3>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
            <span className="muted">{k}</span><strong style={{ textAlign: 'right', maxWidth: '60%' }}>{v}</strong>
          </div>
        ))}
      </div>
      <div className="card card-pad">
        <h3 className="card-title">Medical snapshot</h3>
        {!can('clinical.view') && <p className="muted small">Clinical details are restricted for your role.</p>}
        {can('clinical.view') && (
          <>
            <InfoBlock label="Primary complaint" text={patient.complaint} />
            <InfoBlock label="Previous problems" text={patient.prev_problems} />
            <InfoBlock label="Allergies" text={patient.allergies} alert />
            <InfoBlock label="Medical notes" text={patient.medical_notes} />
            <InfoBlock label="Dental notes" text={patient.dental_notes} />
            <InfoBlock label="Additional notes" text={patient.notes} />
          </>
        )}
      </div>
    </div>
  );
}

function InfoBlock({ label, text, alert }: { label: string; text: string; alert?: boolean }) {
  if (!text) return null;
  return (
    <div className="mt-2">
      <div className="small muted"><strong>{label}</strong></div>
      <div style={{ whiteSpace: 'pre-wrap', color: alert ? 'var(--dp-danger)' : undefined, fontWeight: alert ? 600 : 400 }}>{text}</div>
    </div>
  );
}

function ClinicalTab({ pid, onNewVisit }: { pid: number; onNewVisit: () => void }) {
  const { can, dateFormat, toast, confirm } = useApp();
  const [visits, setVisits] = useState<R[]>([]);
  const [referrals, setReferrals] = useState<R[]>([]);
  const [notes, setNotes] = useState<R[]>([]);
  const [noteText, setNoteText] = useState('');
  const [editVisit, setEditVisit] = useState<R | null>(null);

  const load = useCallback(async () => {
    try {
      const [v, r, n] = await Promise.all([api.visitsList(pid), api.referralsList(pid), api.mednotesList(pid)]);
      setVisits(v as R[]); setReferrals(r as R[]); setNotes(n as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  }, [pid, toast]);

  useEffect(() => { void load(); }, [load]);

  const delVisit = async (v: R) => {
    const ok = await confirm({ title: 'Delete visit?', body: <p>Visit on <strong>{v.visit_date}</strong> will be permanently deleted.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.visitsDelete(v.id);
      toast({ kind: 'success', title: 'Visit deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      await api.mednotesCreate(pid, noteText.trim());
      setNoteText('');
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not add note', message: friendlyError(e) });
    }
  };

  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <div className="flex justify-between items-center mb-2">
          <h3 className="card-title">Visits ({visits.length})</h3>
          {can('clinical.create_visit') && <Btn size="sm" kind="primary" onClick={onNewVisit}>+ New visit</Btn>}
        </div>
        {visits.length === 0 && <p className="muted small">No visits yet.</p>}
        {visits.map((v) => (
          <div key={v.id} className="card card-pad mb-2" style={{ padding: 12 }}>
            <div className="flex justify-between items-center">
              <strong>{formatDate(v.visit_date, dateFormat)}</strong>
              <span className="muted small">{v.dentist_name || ''}</span>
            </div>
            {v.complaint && <div className="small mt-2"><strong>C/C:</strong> {v.complaint}</div>}
            {v.diagnosis && <div className="small"><strong>Dx:</strong> {v.diagnosis}</div>}
            {v.advice && <div className="small"><strong>Advice:</strong> {v.advice}</div>}
            <div className="flex gap-2 mt-2">
              {can('clinical.edit_visit') && <Btn size="xs" kind="ghost" onClick={() => setEditVisit(v)}>Edit</Btn>}
              {can('clinical.delete_visit') && <Btn size="xs" kind="ghost" onClick={() => void delVisit(v)}>Delete</Btn>}
            </div>
          </div>
        ))}
      </div>
      <div>
        <div className="card card-pad mb-3">
          <h3 className="card-title">Medical notes</h3>
          {can('clinical.create_visit') && (
            <div className="flex gap-2 mt-2">
              <TextInput value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a dated medical note…" style={{ flex: 1 }} />
              <Btn size="sm" kind="secondary" onClick={() => void addNote()}>Add</Btn>
            </div>
          )}
          <div className="mt-2">
            {notes.length === 0 && <p className="muted small">No extra notes.</p>}
            {notes.map((n) => (
              <div key={n.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
                <div>{n.note}</div>
                <div className="muted">{formatDate(n.created_at, dateFormat)} · {n.created_by_name || ''}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <h3 className="card-title">Referrals ({referrals.length})</h3>
          {referrals.length === 0 && <p className="muted small">No referrals.</p>}
          {referrals.map((r) => (
            <div key={r.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
              <div><strong>{r.referred_to || r.specialty || 'Referral'}</strong> <StatusBadge status={r.status} /></div>
              <div className="muted">{formatDate(r.referral_date, dateFormat)} · {r.reason}</div>
            </div>
          ))}
        </div>
      </div>
      {editVisit && <VisitModal patientId={pid} visit={editVisit} onClose={() => setEditVisit(null)} onSaved={() => { setEditVisit(null); void load(); }} />}
    </div>
  );
}

const ADULT = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28', '48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];
const CHILD = ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65', '85', '84', '83', '82', '81', '71', '72', '73', '74', '75'];

function ChartTab({ pid }: { pid: number }) {
  const { toast, dateFormat, can } = useApp();
  const [mode, setMode] = useState<'adult' | 'child'>('adult');
  const [latest, setLatest] = useState<Record<string, R>>({});
  const [history, setHistory] = useState<R[]>([]);
  const [types, setTypes] = useState<R[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [condition, setCondition] = useState('caries');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const c = await api.chartGet(pid);
      setLatest((c as R).latest ?? {});
      setHistory(((c as R).history ?? []) as R[]);
      setTypes(((c as R).types ?? []) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Chart load failed', message: friendlyError(e) });
    }
  }, [pid, toast]);

  useEffect(() => { void load(); }, [load]);

  const colorOf = (code: string) => types.find((t) => t.code === code)?.color ?? '#e2e8f0';
  const teeth = mode === 'adult' ? ADULT : CHILD;

  const toggle = (t: string) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const apply = async () => {
    if (selected.length === 0) {
      toast({ kind: 'error', title: 'No teeth selected', message: 'Click one or more teeth first.' });
      return;
    }
    try {
      await api.chartSet({ patientId: pid, teeth: selected, condition, notes: note });
      toast({ kind: 'success', title: `Chart updated (${selected.join(', ')})` });
      setSelected([]);
      setNote('');
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Update failed', message: friendlyError(e) });
    }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
      <div className="card card-pad">
        <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
          <Tabs tabs={[{ id: 'adult', label: 'Adult (32)' }, { id: 'child', label: 'Pediatric (20)' }]} active={mode} onChange={(id) => { setMode(id as 'adult' | 'child'); setSelected([]); }} />
          <span className="muted small">{selected.length} selected</span>
        </div>
        <div className="chart-arch">
          <div className="chart-row">
            {teeth.slice(0, teeth.length / 2).map((t) => (
              <button key={t} className={`tooth${selected.includes(t) ? ' selected' : ''}`} onClick={() => toggle(t)} title={`Tooth ${t}`}>
                <div className="tooth-code">{t}</div>
                <div className="tooth-face" style={{ background: latest[t] ? colorOf(latest[t].condition_code) : '#f1f5f9' }} />
              </button>
            ))}
          </div>
          <div className="chart-row">
            {teeth.slice(teeth.length / 2).map((t) => (
              <button key={t} className={`tooth${selected.includes(t) ? ' selected' : ''}`} onClick={() => toggle(t)} title={`Tooth ${t}`}>
                <div className="tooth-code">{t}</div>
                <div className="tooth-face" style={{ background: latest[t] ? colorOf(latest[t].condition_code) : '#f1f5f9' }} />
              </button>
            ))}
          </div>
        </div>
        <div className="legend mt-3">
          {types.map((t) => <span key={t.code} className="legend-item"><span className="legend-dot" style={{ background: t.color }} />{t.name}</span>)}
        </div>
        {can('clinical.chart') && (
          <div className="form-grid mt-3" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
            <Field label="Condition"><Select value={condition} onChange={(e) => setCondition(e.target.value)}>{types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</Select></Field>
            <Field label="Notes"><TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Condition notes…" /></Field>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}><Btn kind="primary" onClick={() => void apply()}>Apply to selected</Btn></div>
          </div>
        )}
      </div>
      <div className="card card-pad">
        <h3 className="card-title">Condition history</h3>
        <p className="card-sub">{history.length} record(s)</p>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {history.slice(0, 60).map((h) => (
            <div key={h.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
              <div><strong>Tooth {h.tooth_code}</strong> → <Badge tone="teal">{h.condition_code}</Badge></div>
              {h.notes && <div>{h.notes}</div>}
              <div className="muted">{formatDate(h.recorded_at, dateFormat)}</div>
            </div>
          ))}
          {history.length === 0 && <p className="muted small">No chart records yet.</p>}
        </div>
      </div>
    </div>
  );
}

function TimelineTab({ pid }: { pid: number }) {
  const { dateFormat } = useApp();
  const [filter, setFilter] = useState('all');
  const [events, setEvents] = useState<R[]>([]);
  useEffect(() => {
    api.timeline(pid, filter).then((e) => setEvents(e as R[])).catch(() => {});
  }, [pid, filter]);
  return (
    <div className="card card-pad">
      <Tabs
        tabs={[{ id: 'all', label: 'All' }, { id: 'clinical', label: 'Clinical' }, { id: 'financial', label: 'Financial' }, { id: 'appointments', label: 'Appointments' }, { id: 'documents', label: 'Documents' }, { id: 'prescriptions', label: 'Prescriptions' }, { id: 'treatment', label: 'Treatment' }]}
        active={filter}
        onChange={setFilter}
      />
      {events.length === 0 && <p className="muted">No events in this category.</p>}
      <div className="timeline">
        {events.map((e, i) => (
          <div key={i} className={`tl-item tl-${e.group}`}>
            <div className="tl-title">{e.title}</div>
            <div className="tl-meta">{formatDate(e.ts, dateFormat)} · {e.type}{e.detail ? ` · ${e.detail}` : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinancialTab({ pid, onPay }: { pid: number; onPay: () => void }) {
  const { navigate, dateFormat, can } = useApp();
  const [fin, setFin] = useState<R | null>(null);
  useEffect(() => {
    api.financials(pid).then((f) => setFin(f as R)).catch(() => {});
  }, [pid]);
  if (!fin) return <Loading />;
  return (
    <div>
      <div className="grid grid-3 mb-3">
        <div className="stat-card"><div className="stat-label">Total billed</div><div className="stat-value">{formatBdt(fin.billed)}</div></div>
        <div className="stat-card"><div className="stat-label">Total paid</div><div className="stat-value">{formatBdt(fin.paid)}</div></div>
        <div className="stat-card"><div className="stat-label">Outstanding</div><div className="stat-value" style={{ color: fin.outstanding > 0 ? 'var(--dp-danger)' : undefined }}>{formatBdt(fin.outstanding)}</div></div>
      </div>
      <div className="grid grid-2">
        <div className="card card-pad">
          <div className="flex justify-between items-center mb-2">
            <h3 className="card-title">Invoices ({(fin.invoices as R[]).length})</h3>
            {can('invoices.create') && <Btn size="sm" kind="primary" onClick={() => navigate(`invoices/new?patient=${pid}`)}>+ Invoice</Btn>}
          </div>
          {(fin.invoices as R[]).map((i) => (
            <div key={i.id} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
              <div><span className="rowlink" onClick={() => navigate(`invoices/${i.id}`)}><strong>{i.invoice_no}</strong></span><div className="cell-sub">{formatDate(i.invoice_date, dateFormat)}</div></div>
              <div style={{ textAlign: 'right' }}><div className="mono"><strong>{formatBdt(i.total_paisa)}</strong></div><StatusBadge status={i.status} /></div>
            </div>
          ))}
          {(fin.invoices as R[]).length === 0 && <p className="muted small">No invoices.</p>}
        </div>
        <div className="card card-pad">
          <div className="flex justify-between items-center mb-2">
            <h3 className="card-title">Payments ({(fin.payments as R[]).length})</h3>
            {can('payments.record') && <Btn size="sm" kind="primary" onClick={onPay}>Record payment</Btn>}
          </div>
          {(fin.payments as R[]).map((p) => (
            <div key={p.id} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
              <div><strong>{p.receipt_no}</strong><div className="cell-sub">{formatDate(p.payment_date, dateFormat)} · {p.method}{p.reversed ? ' · REVERSED' : ''}</div></div>
              <div className="mono"><strong>{formatBdt(p.amount_paisa)}</strong></div>
            </div>
          ))}
          {(fin.payments as R[]).length === 0 && <p className="muted small">No payments.</p>}
        </div>
      </div>
    </div>
  );
}

function PatientAppointmentsTab({ pid, onNew }: { pid: number; onNew: () => void }) {
  const { dateFormat, timeFormat, can } = useApp();
  const [rows, setRows] = useState<R[]>([]);
  useEffect(() => {
    api.appointmentsList({ patientId: pid }).then((r) => setRows(r as R[])).catch(() => {});
  }, [pid]);
  return (
    <div className="card card-pad">
      <div className="flex justify-between items-center mb-2">
        <h3 className="card-title">Appointments ({rows.length})</h3>
        {can('appointments.manage') && <Btn size="sm" kind="primary" onClick={onNew}>+ New</Btn>}
      </div>
      {rows.length === 0 && <p className="muted small">No appointments.</p>}
      {rows.map((a) => (
        <div key={a.id} className="flex justify-between items-center" style={{ padding: '8px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
          <div><strong>{formatDate(a.appt_date, dateFormat)} · {formatTime(a.appt_time, timeFormat)}</strong><div className="cell-sub">{a.reason || a.appt_type} · {a.dentist_name || ''}</div></div>
          <StatusBadge status={a.status} />
        </div>
      ))}
    </div>
  );
}

function AttachmentsTab({ pid, onNew }: { pid: number; onNew: () => void }) {
  const { can, toast, confirm, dateFormat } = useApp();
  const [rows, setRows] = useState<R[]>([]);
  const [previewImg, setPreviewImg] = useState<{ name: string; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.attachmentsList(pid) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  }, [pid, toast]);

  useEffect(() => { void load(); }, [load]);

  const open = async (a: R) => {
    try {
      const f = await api.attachmentGet(a.id);
      const bin = atob(f.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes as BlobPart], { type: f.mime });
      const url = URL.createObjectURL(blob);
      if (f.mime.startsWith('image/')) setPreviewImg({ name: f.name, url });
      else window.open(url, '_blank');
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open file', message: friendlyError(e) });
    }
  };

  const download = async (a: R) => {
    try {
      const f = await api.attachmentGet(a.id);
      const bin = atob(f.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes as BlobPart], { type: f.mime });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url;
      el.download = f.name;
      el.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast({ kind: 'error', title: 'Download failed', message: friendlyError(e) });
    }
  };

  const del = async (a: R) => {
    const ok = await confirm({ title: 'Delete attachment?', body: <p><strong>{a.original_name}</strong> will be permanently deleted.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.attachmentDelete(a.id);
      toast({ kind: 'success', title: 'Attachment deleted' });
      void load();
    } catch (e) {
      if (e instanceof CommandError) toast({ kind: 'error', title: 'Delete failed', message: e.message });
      else toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  return (
    <div className="card card-pad">
      <div className="flex justify-between items-center mb-2">
        <h3 className="card-title">Attachments ({rows.length})</h3>
        {can('patients.attachments') && <Btn size="sm" kind="primary" onClick={onNew}>+ Add</Btn>}
      </div>
      {rows.length === 0 && <EmptyState title="No attachments yet" message="Upload X-rays, photos, PDFs, scans, or reports." action={can('patients.attachments') ? <Btn kind="primary" onClick={onNew}>+ Add attachment</Btn> : undefined} />}
      {rows.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>File</th><th>Category</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.original_name}</strong><div className="cell-sub">{a.note}</div></td>
                <td><Badge tone="gray">{a.category}</Badge></td>
                <td className="mono">{fileSize(a.size_bytes)}</td>
                <td>{formatDate(a.created_at, dateFormat)}<div className="cell-sub">{a.uploaded_by_name || ''}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Btn size="xs" kind="ghost" onClick={() => void open(a)}>Open</Btn>
                  <Btn size="xs" kind="ghost" onClick={() => void download(a)}>Download</Btn>
                  {can('patients.attachments') && <Btn size="xs" kind="ghost" onClick={() => void del(a)}>Delete</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {previewImg && (
        <Modal title={previewImg.name} onClose={() => setPreviewImg(null)} size="lg">
          <img src={previewImg.url} alt={previewImg.name} style={{ maxWidth: '100%' }} />
        </Modal>
      )}
    </div>
  );
}
