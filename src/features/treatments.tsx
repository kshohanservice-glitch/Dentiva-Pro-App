// Dentiva Pro — treatment catalog + medication catalog.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, TextArea, Select, SearchInput, Tabs, Modal, EmptyState, Loading, Badge } from '../components/ui';
import { formatBdt, parseBdtToPaisa } from '../lib/money';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function TreatmentsPage() {
  const [tab, setTab] = useState('treatments');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Treatments & Medicines</h1>
          <p className="page-sub">Price catalogs used by invoices, visits, and prescriptions. Historical records keep their original prices.</p>
        </div>
      </div>
      <Tabs tabs={[{ id: 'treatments', label: 'Treatment catalog' }, { id: 'medicines', label: 'Medicine catalog' }]} active={tab} onChange={setTab} />
      {tab === 'treatments' ? <TreatmentCatalog /> : <MedicineCatalog />}
    </div>
  );
}

function TreatmentCatalog() {
  const { can, toast, confirm } = useApp();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.treatmentsList(search, !showInactive) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [search, showInactive, toast]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (t: R) => {
    if (!can('treatments.manage')) return;
    const ok = await confirm({
      title: t.active ? 'Deactivate treatment?' : 'Activate treatment?',
      body: <p><strong>{t.name}</strong> ({t.code}) will be {t.active ? 'hidden from new invoices' : 'available again'}. Past invoices are unaffected.</p>,
      confirmLabel: t.active ? 'Deactivate' : 'Activate',
    });
    if (!ok) return;
    try {
      await api.treatmentsSave({ id: t.id, code: t.code, name: t.name, category: t.category, default_price_paisa: t.default_price_paisa, duration_min: t.duration_min, notes: t.notes, active: !t.active });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Update failed', message: friendlyError(e) });
    }
  };

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search treatments…" />
        <label className="check-row"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
        <span style={{ flex: 1 }} />
        {can('treatments.manage') && <Btn kind="primary" onClick={() => setModal('new')}>+ New treatment</Btn>}
      </div>
      {loading && <Loading />}
      {!loading && rows.length === 0 && <EmptyState title="No treatments" message="Build your price list: root canal, scaling, filling, crown, and more." action={can('treatments.manage') ? <Btn kind="primary" onClick={() => setModal('new')}>+ New treatment</Btn> : undefined} />}
      {!loading && rows.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Code</th><th>Treatment</th><th>Category</th><th>Duration</th><th style={{ textAlign: 'right' }}>Default price</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.code}</td>
                <td><strong>{t.name}</strong>{t.notes && <div className="cell-sub">{t.notes.slice(0, 80)}</div>}</td>
                <td>{t.category}</td>
                <td>{t.duration_min} min</td>
                <td className="num mono"><strong>{formatBdt(t.default_price_paisa)}</strong></td>
                <td>{t.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {can('treatments.manage') && (
                    <>
                      <Btn size="xs" kind="ghost" onClick={() => setModal(t)}>Edit</Btn>
                      <Btn size="xs" kind="ghost" onClick={() => void toggle(t)}>{t.active ? 'Deactivate' : 'Activate'}</Btn>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal && <TreatmentModal treatment={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function TreatmentModal({ treatment, onClose, onSaved }: { treatment: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    code: treatment?.code ?? '', name: treatment?.name ?? '', category: treatment?.category ?? 'General',
    price: treatment ? (treatment.default_price_paisa / 100).toFixed(2) : '', duration: String(treatment?.duration_min ?? '30'), notes: treatment?.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim() || !f.code.trim()) {
      toast({ kind: 'error', title: 'Code and name required' });
      return;
    }
    const paisa = parseBdtToPaisa(f.price || '0');
    if (paisa === null) {
      toast({ kind: 'error', title: 'Invalid price' });
      return;
    }
    setBusy(true);
    try {
      await api.treatmentsSave({ id: treatment?.id, code: f.code.trim(), name: f.name.trim(), category: f.category, default_price_paisa: paisa, duration_min: Number(f.duration) || 30, notes: f.notes });
      toast({ kind: 'success', title: treatment?.id ? 'Treatment updated' : 'Treatment created' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={treatment?.id ? 'Edit treatment' : 'New treatment'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Code" required><TextInput value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="RCT-01" /></Field>
        <Field label="Name" required><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Root canal treatment" /></Field>
        <Field label="Category"><TextInput value={f.category} onChange={(e) => set('category', e.target.value)} /></Field>
        <Field label="Default price (৳)" required><TextInput value={f.price} onChange={(e) => set('price', e.target.value)} inputMode="decimal" placeholder="0.00" /></Field>
        <Field label="Duration (min)"><TextInput type="number" min={1} value={f.duration} onChange={(e) => set('duration', e.target.value)} /></Field>
        <div className="span-2"><Field label="Notes"><TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

function MedicineCatalog() {
  const { can, toast } = useApp();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.medicationsList(search) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search medicines…" />
        <span style={{ flex: 1 }} />
        {can('treatments.manage') && <Btn kind="primary" onClick={() => setModal('new')}>+ New medicine</Btn>}
      </div>
      {loading && <Loading />}
      {!loading && rows.length === 0 && <EmptyState title="No medicines" message="Add commonly prescribed medicines to speed up prescriptions." action={can('treatments.manage') ? <Btn kind="primary" onClick={() => setModal('new')}>+ New medicine</Btn> : undefined} />}
      {!loading && rows.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Medicine</th><th>Generic</th><th>Strength</th><th>Form</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.name}</strong></td>
                <td>{m.generic_name || '—'}</td>
                <td>{m.strength || '—'}</td>
                <td>{m.form}</td>
                <td>{m.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                <td>{can('treatments.manage') && <Btn size="xs" kind="ghost" onClick={() => setModal(m)}>Edit</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal && <MedicineModal medicine={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function MedicineModal({ medicine, onClose, onSaved }: { medicine: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: medicine?.name ?? '', generic_name: medicine?.generic_name ?? '', strength: medicine?.strength ?? '',
    form: medicine?.form ?? 'Tablet', route: medicine?.route ?? '', default_dosage: medicine?.default_dosage ?? '',
    default_duration: medicine?.default_duration ?? '', notes: medicine?.notes ?? '', active: medicine?.active !== 0,
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) {
      toast({ kind: 'error', title: 'Name required' });
      return;
    }
    setBusy(true);
    try {
      await api.medicationsSave({ id: medicine?.id, ...f });
      toast({ kind: 'success', title: medicine?.id ? 'Medicine updated' : 'Medicine created' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={medicine?.id ? 'Edit medicine' : 'New medicine'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Brand / medicine name" required><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Generic name"><TextInput value={f.generic_name} onChange={(e) => set('generic_name', e.target.value)} /></Field>
        <Field label="Strength"><TextInput value={f.strength} onChange={(e) => set('strength', e.target.value)} placeholder="500mg" /></Field>
        <Field label="Form"><Select value={f.form} onChange={(e) => set('form', e.target.value)}>
          {['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Cream', 'Ointment', 'Gel', 'Drops', 'Mouthwash', 'Powder', 'Spray', 'Other'].map((x) => <option key={x}>{x}</option>)}
        </Select></Field>
        <Field label="Route"><TextInput value={f.route} onChange={(e) => set('route', e.target.value)} placeholder="Oral / Topical / …" /></Field>
        <Field label="Default dosage"><TextInput value={f.default_dosage} onChange={(e) => set('default_dosage', e.target.value)} placeholder="1+0+1" /></Field>
        <Field label="Default duration"><TextInput value={f.default_duration} onChange={(e) => set('default_duration', e.target.value)} placeholder="7 days" /></Field>
        <Field label="Status"><Select value={f.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">Active</option><option value="0">Inactive</option></Select></Field>
        <div className="span-2"><Field label="Notes"><TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}
