// Dentiva Pro — prescriptions: multi-medication editor + clinical print.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, TextArea, Select, SearchInput, Modal, EmptyState, Loading, DateRangeBar } from '../components/ui';
import { PatientPicker, DentistSelect } from './_modals';
import { PrintPreviewModal } from '../components/printPreview';
import { buildPrescriptionHtml, type PrintPackage } from '../print/engine';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function PrescriptionsPage() {
  const { can, navigate, routeParam, dateFormat, toast, confirm, settings } = useApp();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ id?: number; patientId?: number } | null>(null);
  const [preview, setPreview] = useState<PrintPackage | null>(null);

  // Deep links: prescriptions/new?patient=ID and prescriptions/RXID (print)
  useEffect(() => {
    if (!routeParam) return;
    if (routeParam.startsWith('new')) {
      const m = /patient=(\d+)/.exec(routeParam);
      if (can('prescriptions.create')) setEditor({ patientId: m ? Number(m[1]) : undefined });
      window.location.hash = '#/prescriptions';
    } else if (/^\d+$/.test(routeParam)) {
      void printRx(Number(routeParam));
      window.location.hash = '#/prescriptions';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParam]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.prescriptionsList({ from, to, search: search || undefined }) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [from, to, search, toast]);

  useEffect(() => { void load(); }, [load]);

  const printRx = async (id: number) => {
    try {
      const [rx, clinic, logo] = await Promise.all([
        api.prescriptionsGet(id),
        api.clinicGet(),
        api.logoGet().catch(() => ({ base64: '', mime: '' })),
      ]);
      const r = rx as R;
      const dentists = await api.dentistsList() as R[];
      const dentist = dentists.find((d) => d.id === r.dentist_id) ?? { name: r.dentist_name };
      const c = clinic as R;
      setPreview(buildPrescriptionHtml({
        clinic: c,
        logoDataUrl: logo.base64 ? `data:${logo.mime};base64,${logo.base64}` : '',
        dentist,
        designations: dentist.designations ?? r.dentist_designations ?? [],
        patient: r,
        rx: r,
        items: r.items ?? [],
        showCode: settings.prescription_show_code !== '0',
        dateFormat,
        footerHours: c.opening_hours ? `Visiting hours: ${c.opening_hours} – ${c.closing_hours}${c.weekly_off ? ` (Closed: ${c.weekly_off})` : ''}` : '',
      }));
    } catch (e) {
      toast({ kind: 'error', title: 'Print failed', message: friendlyError(e) });
    }
  };

  const remove = async (r: R) => {
    const ok = await confirm({ title: 'Delete prescription?', body: <p>Prescription for <strong>{r.patient_name}</strong> ({r.prescription_date}) will be deleted.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.prescriptionsDelete(r.id);
      toast({ kind: 'success', title: 'Prescription deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Prescriptions</h1>
          <p className="page-sub">Clinical prescriptions with Bengali-safe printing.</p>
        </div>
        <div className="page-actions">
          {can('prescriptions.create') && <Btn kind="primary" onClick={() => setEditor({})}>+ New prescription</Btn>}
        </div>
      </div>

      <div className="card card-pad">
        <DateRangeBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search patient…" />
        </div>
        {loading && <Loading />}
        {!loading && rows.length === 0 && (
          <EmptyState title="No prescriptions" message="Create a prescription from here, a patient profile, or a visit." action={can('prescriptions.create') ? <Btn kind="primary" onClick={() => setEditor({})}>+ New prescription</Btn> : undefined} />
        )}
        {!loading && rows.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Patient</th><th>Dentist</th><th>Medications</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.prescription_date, dateFormat)}</td>
                  <td><span className="rowlink" onClick={() => navigate(`patients/${r.patient_id}`)}>{r.patient_name}</span><div className="cell-sub">{r.patient_code}</div></td>
                  <td>{r.dentist_name || '—'}</td>
                  <td>{r.item_count} item(s)</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {can('prescriptions.print') && <Btn size="xs" kind="secondary" onClick={() => void printRx(r.id)}>Print</Btn>}
                    {can('prescriptions.edit') && <Btn size="xs" kind="ghost" onClick={() => setEditor({ id: r.id })}>Edit</Btn>}
                    {can('prescriptions.edit') && <Btn size="xs" kind="ghost" onClick={() => void remove(r)}>Delete</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {editor && <PrescriptionEditor id={editor.id} defaultPatientId={editor.patientId} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(); }} onPrint={(id) => { setEditor(null); void load(); void printRx(id); }} />}
      {preview && <PrintPreviewModal docType="prescription" pkg={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

interface MedItem {
  key: number;
  medication_id: number | null;
  medicine_name: string;
  generic_name: string;
  strength: string;
  form: string;
  route: string;
  dosage: string;
  morning: string;
  noon: string;
  night: string;
  meal_relation: string;
  frequency: string;
  duration: string;
  quantity: string;
  instruction: string;
  prn: string;
  notes: string;
}

const blankItem = (key: number): MedItem => ({
  key, medication_id: null, medicine_name: '', generic_name: '', strength: '', form: 'Tablet', route: '',
  dosage: '', morning: '', noon: '', night: '', meal_relation: '', frequency: '', duration: '', quantity: '', instruction: '', prn: '', notes: '',
});

function PrescriptionEditor({ id, defaultPatientId, onClose, onSaved, onPrint }: { id?: number; defaultPatientId?: number; onClose: () => void; onSaved: () => void; onPrint: (id: number) => void }) {
  const { toast, can } = useApp();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [patientId, setPatientId] = useState<number | ''>(defaultPatientId ?? '');
  const [dentistId, setDentistId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [cc, setCc] = useState('');
  const [oe, setOe] = useState('');
  const [re, setRe] = useState('');
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<MedItem[]>([blankItem(1)]);
  const [catalog, setCatalog] = useState<R[]>([]);
  const [catalogQ, setCatalogQ] = useState('');

  useEffect(() => {
    api.medicationsList('').then((m) => setCatalog(m as R[])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.prescriptionsGet(id).then((r) => {
      const rx = r as R;
      setPatientId(rx.patient_id);
      setDentistId(rx.dentist_id ? String(rx.dentist_id) : '');
      setDate(rx.prescription_date);
      setCc(rx.cc_text ?? ''); setOe(rx.oe_text ?? ''); setRe(rx.re_text ?? '');
      setAdvice(rx.advice ?? ''); setFollowUp(rx.follow_up ?? ''); setNotes(rx.notes ?? '');
      setItems(((rx.items ?? []) as R[]).map((it, i) => ({
        key: i + 1, medication_id: it.medication_id ?? null, medicine_name: it.medicine_name ?? '',
        generic_name: it.generic_name ?? '', strength: it.strength ?? '', form: it.form ?? 'Tablet', route: it.route ?? '',
        dosage: it.dosage ?? '', morning: it.morning ?? '', noon: it.noon ?? '', night: it.night ?? '',
        meal_relation: it.meal_relation ?? '', frequency: it.frequency ?? '', duration: it.duration ?? '',
        quantity: it.quantity ?? '', instruction: it.instruction ?? '', prn: it.prn ?? '', notes: it.notes ?? '',
      })));
    }).catch((e) => toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) }))
      .finally(() => setLoading(false));
  }, [id, toast]);

  const setItem = (key: number, patch: Partial<MedItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addFromCatalog = (m: R) => {
    setItems((list) => [...list, {
      ...blankItem(Date.now() + Math.random()), medication_id: m.id, medicine_name: m.name,
      generic_name: m.generic_name ?? '', strength: m.strength ?? '', form: m.form ?? 'Tablet',
      route: m.route ?? '', dosage: m.default_dosage ?? '', duration: m.default_duration ?? '',
    }]);
  };

  const save = async (andPrint: boolean) => {
    if (!patientId) {
      toast({ kind: 'error', title: 'Patient required' });
      return;
    }
    if (items.length === 0 || items.every((i) => !i.medicine_name.trim())) {
      toast({ kind: 'error', title: 'Medication required', message: 'Add at least one medication.' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.prescriptionsSave({
        id, patientId, dentistId: dentistId || null, prescriptionDate: date,
        cc_text: cc, oe_text: oe, re_text: re, advice, followUp, notes,
        items: items.filter((i) => i.medicine_name.trim()).map((i) => ({ ...i })),
      });
      toast({ kind: 'success', title: id ? 'Prescription updated' : 'Prescription created' });
      if (andPrint) onPrint(r.id);
      else onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const filtered = catalogQ ? catalog.filter((m) => m.name.toLowerCase().includes(catalogQ.toLowerCase()) || (m.generic_name ?? '').toLowerCase().includes(catalogQ.toLowerCase())).slice(0, 8) : [];

  return (
    <Modal title={id ? `Edit prescription #${id}` : 'New prescription'} onClose={onClose} size="xl" actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        {can('prescriptions.print') && <Btn kind="secondary" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Save & print'}</Btn>}
        <Btn kind="primary" disabled={busy} onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save prescription'}</Btn>
      </>
    }>
      {loading && <Loading />}
      {!loading && (
        <>
          <div className="form-grid-3">
            <div className="span-2"><Field label="Patient" required><PatientPicker value={patientId} onChange={(v) => setPatientId(v)} /></Field></div>
            <Field label="Date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <div className="span-3"><Field label="Dentist"><DentistSelect value={dentistId} onChange={setDentistId} /></Field></div>
          </div>
          <div className="grid grid-3 mt-3">
            <Field label="C/C (chief complaints)"><TextArea value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Patient complains of pain, swelling, …" /></Field>
            <Field label="O/E (on examination)"><TextArea value={oe} onChange={(e) => setOe(e.target.value)} placeholder="On examination …" /></Field>
            <Field label="R/E / investigations"><TextArea value={re} onChange={(e) => setRe(e.target.value)} placeholder="Advice: …" /></Field>
          </div>

          <h4 className="mt-4" style={{ marginBottom: 6 }}>Medications ({items.length})</h4>
          <div className="toolbar">
            <SearchInput value={catalogQ} onChange={setCatalogQ} placeholder="Add from medicine catalog…" />
            <Btn size="sm" kind="secondary" onClick={() => setItems((l) => [...l, blankItem(Date.now())])}>+ Free-text item</Btn>
          </div>
          {filtered.length > 0 && (
            <div className="menu" style={{ position: 'static', marginBottom: 8, maxHeight: 180, overflowY: 'auto' }}>
              {filtered.map((m) => (
                <button key={m.id} className="menu-item" onClick={() => { addFromCatalog(m); setCatalogQ(''); }}>
                  <span><strong>{m.name}</strong> <span className="muted small">{m.strength} · {m.form}</span></span>
                </button>
              ))}
            </div>
          )}
          {items.map((it, idx) => (
            <div key={it.key} className="card card-pad mb-2" style={{ padding: 12, background: 'var(--dp-surface-2)' }}>
              <div className="flex justify-between items-center mb-2">
                <strong>#{idx + 1}</strong>
                <Btn size="xs" kind="ghost" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>Remove</Btn>
              </div>
              <div className="form-grid-3">
                <div className="span-2"><Field label="Medicine name" required><TextInput value={it.medicine_name} onChange={(e) => setItem(it.key, { medicine_name: e.target.value })} placeholder="e.g. Amoxicillin 500mg / Napa" /></Field></div>
                <Field label="Form"><Select value={it.form} onChange={(e) => setItem(it.key, { form: e.target.value })}>
                  {['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Cream', 'Ointment', 'Gel', 'Drops', 'Mouthwash', 'Powder', 'Spray', 'Other'].map((x) => <option key={x}>{x}</option>)}
                </Select></Field>
                <Field label="Generic"><TextInput value={it.generic_name} onChange={(e) => setItem(it.key, { generic_name: e.target.value })} /></Field>
                <Field label="Strength"><TextInput value={it.strength} onChange={(e) => setItem(it.key, { strength: e.target.value })} placeholder="500mg" /></Field>
                <Field label="Route"><TextInput value={it.route} onChange={(e) => setItem(it.key, { route: e.target.value })} placeholder="Oral" /></Field>
                <Field label="Dosage"><TextInput value={it.dosage} onChange={(e) => setItem(it.key, { dosage: e.target.value })} placeholder="1+0+1" /></Field>
                <Field label="Morning"><TextInput value={it.morning} onChange={(e) => setItem(it.key, { morning: e.target.value })} placeholder="1" /></Field>
                <Field label="Noon"><TextInput value={it.noon} onChange={(e) => setItem(it.key, { noon: e.target.value })} placeholder="0" /></Field>
                <Field label="Night"><TextInput value={it.night} onChange={(e) => setItem(it.key, { night: e.target.value })} placeholder="1" /></Field>
                <Field label="Meal relation"><Select value={it.meal_relation} onChange={(e) => setItem(it.key, { meal_relation: e.target.value })}>
                  <option value="">—</option><option>Before meal</option><option>After meal</option><option>With meal</option><option>Empty stomach</option>
                </Select></Field>
                <Field label="Frequency"><TextInput value={it.frequency} onChange={(e) => setItem(it.key, { frequency: e.target.value })} placeholder="Twice daily" /></Field>
                <Field label="Duration"><TextInput value={it.duration} onChange={(e) => setItem(it.key, { duration: e.target.value })} placeholder="7 days" /></Field>
                <Field label="Quantity"><TextInput value={it.quantity} onChange={(e) => setItem(it.key, { quantity: e.target.value })} placeholder="14 tablets" /></Field>
                <Field label="PRN / as needed"><TextInput value={it.prn} onChange={(e) => setItem(it.key, { prn: e.target.value })} placeholder="If pain persists" /></Field>
                <div className="span-2"><Field label="Instruction"><TextInput value={it.instruction} onChange={(e) => setItem(it.key, { instruction: e.target.value })} placeholder="খাবারের পরে / After meal …" /></Field></div>
                <Field label="Notes"><TextInput value={it.notes} onChange={(e) => setItem(it.key, { notes: e.target.value })} /></Field>
              </div>
            </div>
          ))}

          <div className="form-grid mt-3">
            <div className="span-2"><Field label="Advice"><TextArea value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="General advice for the patient…" /></Field></div>
            <Field label="Follow-up"><TextInput value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="After 7 days" /></Field>
            <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </>
      )}
    </Modal>
  );
}
