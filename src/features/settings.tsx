// Dentiva Pro — settings: clinic, dentists, general, printing, backup, security, data.

import { useCallback, useEffect, useState } from 'react';
import { api, fileToBase64, downloadBase64 } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, TextArea, Select, Tabs, Modal, Loading, Badge } from '../components/ui';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function SettingsPage() {
  const { routeParam, can } = useApp();
  const tabs = [
    { id: 'clinic', label: 'Clinic' },
    { id: 'dentists', label: 'Dentists' },
    { id: 'general', label: 'General' },
    { id: 'printing', label: 'Printing' },
    { id: 'backup', label: 'Backup' },
    { id: 'security', label: 'Security' },
    ...(can('data.danger') ? [{ id: 'data', label: 'Data management' }] : []),
    { id: 'profile', label: 'My profile' },
  ];
  const [tab, setTab] = useState(routeParam || 'clinic');
  useEffect(() => {
    if (routeParam && tabs.some((t) => t.id === routeParam)) setTab(routeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParam]);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Configure your clinic, printing, backup, and security.</p>
        </div>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'clinic' && <ClinicTab />}
      {tab === 'dentists' && <DentistsTab />}
      {tab === 'general' && <GeneralTab />}
      {tab === 'printing' && <PrintingTab />}
      {tab === 'backup' && <BackupSettingsTab />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'data' && <DataTab />}
      {tab === 'profile' && <ProfileTab />}
    </div>
  );
}

function useSettingsSaver() {
  const { toast, refreshSettings, settings } = useApp();
  const save = async (values: Record<string, string>, msg = 'Settings saved') => {
    try {
      await api.settingsSet(values);
      await refreshSettings();
      toast({ kind: 'success', title: msg });
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    }
  };
  return { save, settings };
}

function ClinicTab() {
  const { can, toast } = useApp();
  const [clinic, setClinic] = useState<R | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = can('settings.manage');

  const load = useCallback(async () => {
    try {
      const [c, logo] = await Promise.all([api.clinicGet(), api.logoGet().catch(() => ({ base64: '', mime: '' }))]);
      setClinic(c as R);
      if (logo.base64) setLogoUrl(`data:${logo.mime};base64,${logo.base64}`);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);
  if (!clinic) return <Loading />;

  const set = (k: string, v: string) => setClinic((c) => (c ? { ...c, [k]: v } : c));

  const save = async () => {
    if (!clinic.name.trim()) {
      toast({ kind: 'error', title: 'Clinic name required' });
      return;
    }
    setBusy(true);
    try {
      await api.clinicUpdate({ name: clinic.name, address: clinic.address, phone: clinic.phone, email: clinic.email, website: clinic.website, openingHours: clinic.opening_hours, closingHours: clinic.closing_hours, weeklyOff: clinic.weekly_off, message: clinic.message, footerText: clinic.footer_text });
      toast({ kind: 'success', title: 'Clinic information saved' });
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (f: File | undefined) => {
    if (!f) return;
    try {
      const base64 = await fileToBase64(f);
      await api.logoSave(base64, f.type);
      toast({ kind: 'success', title: 'Logo updated' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Logo upload failed', message: friendlyError(e) });
    }
  };

  const removeLogo = async () => {
    try {
      await api.clinicUpdate({ name: clinic.name, address: clinic.address, phone: clinic.phone, logoPath: '' });
      setLogoUrl('');
      toast({ kind: 'success', title: 'Logo removed' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Remove failed', message: friendlyError(e) });
    }
  };

  return (
    <div className="card card-pad">
      <div className="form-grid">
        <Field label="Clinic / dental care name" required><TextInput value={clinic.name} onChange={(e) => set('name', e.target.value)} disabled={!editable} /></Field>
        <Field label="Phone"><TextInput value={clinic.phone} onChange={(e) => set('phone', e.target.value)} disabled={!editable} /></Field>
        <div className="span-2"><Field label="Address"><TextInput value={clinic.address} onChange={(e) => set('address', e.target.value)} disabled={!editable} /></Field></div>
        <Field label="Email"><TextInput value={clinic.email} onChange={(e) => set('email', e.target.value)} disabled={!editable} /></Field>
        <Field label="Website"><TextInput value={clinic.website} onChange={(e) => set('website', e.target.value)} disabled={!editable} /></Field>
        <Field label="Opening hours"><TextInput value={clinic.opening_hours} onChange={(e) => set('opening_hours', e.target.value)} disabled={!editable} /></Field>
        <Field label="Closing hours"><TextInput value={clinic.closing_hours} onChange={(e) => set('closing_hours', e.target.value)} disabled={!editable} /></Field>
        <Field label="Weekly off"><TextInput value={clinic.weekly_off} onChange={(e) => set('weekly_off', e.target.value)} disabled={!editable} /></Field>
        <Field label="Clinic logo (PNG / JPEG / WebP / SVG, max 5 MB)">
          <div className="flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="Clinic logo" style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain', border: '1px solid var(--dp-border)', borderRadius: 8, padding: 4 }} />}
            {editable && (
              <>
                <TextInput type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => void uploadLogo(e.target.files?.[0])} style={{ width: 'auto' }} />
                {logoUrl && <Btn size="sm" kind="ghost" onClick={() => void removeLogo()}>Remove</Btn>}
              </>
            )}
          </div>
        </Field>
        <div className="span-2"><Field label="Prescription advice / message"><TextArea value={clinic.message} onChange={(e) => set('message', e.target.value)} disabled={!editable} /></Field></div>
        <div className="span-2"><Field label="Print footer text"><TextArea value={clinic.footer_text} onChange={(e) => set('footer_text', e.target.value)} disabled={!editable} /></Field></div>
      </div>
      {editable && <div className="mt-4"><Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save clinic information'}</Btn></div>}
    </div>
  );
}

function DentistsTab() {
  const { can, toast, confirm } = useApp();
  const [rows, setRows] = useState<R[]>([]);
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.dentistsList() as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (d: R) => {
    const ok = await confirm({ title: 'Remove dentist?', body: <p><strong>{d.name}</strong> will be removed. Dentists with visits or appointments are deactivated instead, preserving history.</p>, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      const r = await api.dentistsDelete(d.id) as R;
      toast({ kind: 'success', title: r.deactivated ? 'Dentist deactivated (history preserved)' : 'Dentist removed' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Remove failed', message: friendlyError(e) });
    }
  };

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <span className="muted small">Unlimited dentists, each with an independent profile and designations.</span>
        <span style={{ flex: 1 }} />
        {can('settings.manage') && <Btn kind="primary" onClick={() => setModal('new')}>+ Add dentist</Btn>}
      </div>
      {(rows as R[]).map((d) => (
        <div key={d.id} className="card card-pad mb-2" style={{ padding: 12 }}>
          <div className="flex justify-between items-center">
            <div>
              <strong>{d.name}</strong> {d.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
              <div className="cell-sub">{(d.designations as string[]).join(' · ') || '—'}</div>
              <div className="cell-sub">{d.phone || ''} {d.registration_no ? `· Reg: ${d.registration_no}` : ''}</div>
            </div>
            {can('settings.manage') && (
              <div className="flex gap-2">
                <Btn size="sm" kind="ghost" onClick={() => setModal(d)}>Edit</Btn>
                <Btn size="sm" kind="ghost" onClick={() => void remove(d)}>Remove</Btn>
              </div>
            )}
          </div>
        </div>
      ))}
      {modal && <DentistModal dentist={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function DentistModal({ dentist, onClose, onSaved }: { dentist: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: dentist?.name ?? '', phone: dentist?.phone ?? '', email: dentist?.email ?? '',
    registrationNo: dentist?.registration_no ?? '', designations: ((dentist?.designations as string[]) ?? []).join('\n'), active: dentist?.active !== 0,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) {
      toast({ kind: 'error', title: 'Name required' });
      return;
    }
    setBusy(true);
    try {
      await api.dentistsSave({ id: dentist?.id, name: f.name.trim(), phone: f.phone, email: f.email, registrationNo: f.registrationNo, designations: f.designations.split('\n').map((x) => x.trim()).filter(Boolean), active: f.active });
      toast({ kind: 'success', title: dentist?.id ? 'Dentist updated' : 'Dentist added' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={dentist?.id ? 'Edit dentist' : 'Add dentist'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <div className="span-2"><Field label="Name" required><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Dr. …" /></Field></div>
        <div className="span-2"><Field label="Designations (one per line)"><TextArea value={f.designations} onChange={(e) => set('designations', e.target.value)} placeholder={'BDS (DU)\nPGT (Orthodontics)'} /></Field></div>
        <Field label="Registration no."><TextInput value={f.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} /></Field>
        <Field label="Phone"><TextInput value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><TextInput value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Status"><Select value={f.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">Active</option><option value="0">Inactive</option></Select></Field>
      </div>
    </Modal>
  );
}

function GeneralTab() {
  const { can } = useApp();
  const { save, settings } = useSettingsSaver();
  const [f, setF] = useState({ date_format: '', time_format: '', default_paper_size: '', invoice_tax_percent: '', prescription_show_code: '', invoice_show_signature: '', patient_code_prefix: '', invoice_prefix: '', receipt_prefix: '' });
  useEffect(() => {
    setF({
      date_format: settings.date_format ?? 'DD MMM YYYY',
      time_format: settings.time_format ?? '12h',
      default_paper_size: settings.default_paper_size ?? 'A4',
      invoice_tax_percent: settings.invoice_tax_percent ?? '0',
      prescription_show_code: settings.prescription_show_code ?? '1',
      invoice_show_signature: settings.invoice_show_signature ?? '0',
      patient_code_prefix: settings.patient_code_prefix ?? 'DP-',
      invoice_prefix: settings.invoice_prefix ?? 'INV-',
      receipt_prefix: settings.receipt_prefix ?? 'RCP-',
    });
  }, [settings]);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const editable = can('settings.manage');

  return (
    <div className="card card-pad">
      <div className="form-grid">
        <Field label="Currency"><Select value="BDT" disabled><option value="BDT">BDT (৳)</option></Select></Field>
        <Field label="Date format"><Select value={f.date_format} onChange={(e) => set('date_format', e.target.value)} disabled={!editable}>
          <option>DD MMM YYYY</option><option>DD-MM-YYYY</option><option>MM-DD-YYYY</option><option>YYYY-MM-DD</option>
        </Select></Field>
        <Field label="Time format"><Select value={f.time_format} onChange={(e) => set('time_format', e.target.value)} disabled={!editable}>
          <option value="12h">12-hour (AM/PM)</option><option value="24h">24-hour</option>
        </Select></Field>
        <Field label="Default paper size"><Select value={f.default_paper_size} onChange={(e) => set('default_paper_size', e.target.value)} disabled={!editable}>
          <option>A4</option><option>A5</option>
        </Select></Field>
        <Field label="Invoice tax %"><TextInput value={f.invoice_tax_percent} onChange={(e) => set('invoice_tax_percent', e.target.value)} inputMode="decimal" disabled={!editable} /></Field>
        <Field label="Show patient code on prescriptions"><Select value={f.prescription_show_code} onChange={(e) => set('prescription_show_code', e.target.value)} disabled={!editable}>
          <option value="1">Yes</option><option value="0">No</option>
        </Select></Field>
        <Field label="Signature area on invoices"><Select value={f.invoice_show_signature} onChange={(e) => set('invoice_show_signature', e.target.value)} disabled={!editable}>
          <option value="0">No (default)</option><option value="1">Yes</option>
        </Select></Field>
        <Field label="Patient code prefix"><TextInput value={f.patient_code_prefix} onChange={(e) => set('patient_code_prefix', e.target.value)} disabled={!editable} /></Field>
        <Field label="Invoice prefix"><TextInput value={f.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value)} disabled={!editable} /></Field>
        <Field label="Receipt prefix"><TextInput value={f.receipt_prefix} onChange={(e) => set('receipt_prefix', e.target.value)} disabled={!editable} /></Field>
      </div>
      <p className="small muted mt-3">Bengali (বাংলা) input is supported in all free-text fields — names, notes, prescriptions, and advice — and prints correctly.</p>
      {editable && <div className="mt-3"><Btn kind="primary" onClick={() => void save(f)}>Save preferences</Btn></div>}
    </div>
  );
}

function PrintingTab() {
  const { can, toast, confirm } = useApp();
  const [rows, setRows] = useState<R[]>([]);
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.printerProfiles() as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <span className="muted small">One profile per document type and paper. Printing uses the Windows printer dialog, so standard, wireless, and Bluetooth printers all work, plus Save as PDF.</span>
        <span style={{ flex: 1 }} />
        {can('printers.manage') && <Btn kind="primary" onClick={() => setModal('new')}>+ New profile</Btn>}
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Profile</th><th>Document</th><th>Paper</th><th>Orientation</th><th>Font</th><th>Copies</th><th>Default</th><th></th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong>{p.printer_name && <div className="cell-sub">{p.printer_name}</div>}</td>
              <td>{p.document_type}</td>
              <td>{p.paper_size}</td>
              <td>{p.orientation}</td>
              <td className="num">{Math.round((p.font_scale ?? 1) * 100)}%</td>
              <td className="num">{p.copies}</td>
              <td>{p.is_default ? <Badge tone="green">Default</Badge> : ''}</td>
              <td>{can('printers.manage') && <Btn size="xs" kind="ghost" onClick={() => setModal(p)}>Edit</Btn>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {modal && <PrinterModal profile={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
      {void confirm}
    </div>
  );
}

function PrinterModal({ profile, onClose, onSaved }: { profile: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: profile?.name ?? '', documentType: profile?.document_type ?? 'prescription', printerName: profile?.printer_name ?? '',
    paperSize: profile?.paper_size ?? 'A4', marginsMm: profile?.margins_mm ?? '12,12,14,12', orientation: profile?.orientation ?? 'portrait',
    fontScale: String(profile?.font_scale ?? '1'), copies: String(profile?.copies ?? '1'), isDefault: !!profile?.is_default,
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!(f.name as string).trim()) {
      toast({ kind: 'error', title: 'Profile name required' });
      return;
    }
    setBusy(true);
    try {
      await api.printerProfileSave({ id: profile?.id, ...(f as R), fontScale: parseFloat(f.fontScale as string) || 1, copies: parseInt(f.copies as string, 10) || 1 });
      toast({ kind: 'success', title: 'Printer profile saved' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={profile?.id ? 'Edit printer profile' : 'New printer profile'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <div className="span-2"><Field label="Profile name" required><TextInput value={f.name as string} onChange={(e) => set('name', e.target.value)} /></Field></div>
        <Field label="Document type"><Select value={f.documentType as string} onChange={(e) => set('documentType', e.target.value)}>
          <option value="prescription">Prescription</option><option value="invoice">Invoice</option><option value="summary">Patient summary</option><option value="report">Report</option>
        </Select></Field>
        <Field label="Printer name (optional)"><TextInput value={f.printerName as string} onChange={(e) => set('printerName', e.target.value)} placeholder="As shown in Windows" /></Field>
        <Field label="Paper size"><Select value={f.paperSize as string} onChange={(e) => set('paperSize', e.target.value)}>
          <option>A4</option><option>A5</option><option value="THERMAL_80">Thermal 80mm</option><option value="THERMAL_58">Thermal 58mm</option>
        </Select></Field>
        <Field label="Orientation"><Select value={f.orientation as string} onChange={(e) => set('orientation', e.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></Select></Field>
        <Field label="Margins (mm: top,right,bottom,left)"><TextInput value={f.marginsMm as string} onChange={(e) => set('marginsMm', e.target.value)} /></Field>
        <Field label="Font scale"><Select value={f.fontScale as string} onChange={(e) => set('fontScale', e.target.value)}>{['0.8', '0.9', '0.95', '1', '1.05', '1.1', '1.2'].map((x) => <option key={x} value={x}>{Math.round(parseFloat(x) * 100)}%</option>)}</Select></Field>
        <Field label="Copies"><TextInput type="number" min={1} max={10} value={f.copies as string} onChange={(e) => set('copies', e.target.value)} /></Field>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}><label className="check-row"><input type="checkbox" checked={f.isDefault as boolean} onChange={(e) => set('isDefault', e.target.checked)} /> Default for this document</label></div>
      </div>
    </Modal>
  );
}

function BackupSettingsTab() {
  const { can } = useApp();
  const { save, settings } = useSettingsSaver();
  const [location, setLocation] = useState('');
  const [days, setDays] = useState('7');
  useEffect(() => {
    setLocation(settings.backup_location ?? '');
    setDays(settings.auto_backup_days ?? '7');
  }, [settings]);
  const editable = can('settings.manage');
  return (
    <div className="card card-pad">
      <div className="form-grid">
        <div className="span-2"><Field label="Backup folder" hint="Desktop app writes scheduled backups here. Keep a copy on a separate drive or pen-drive."><TextInput value={location} onChange={(e) => setLocation(e.target.value)} disabled={!editable} placeholder="e.g. D:\DentivaBackups" /></Field></div>
        <Field label="Automatic backup schedule"><Select value={days} onChange={(e) => setDays(e.target.value)} disabled={!editable}>
          <option value="7">Every 7 days</option><option value="15">Every 15 days</option><option value="30">Every 30 days</option>
        </Select></Field>
        <Field label="Last automatic backup"><TextInput value={settings.last_auto_backup ? formatDate(settings.last_auto_backup, 'DD MMM YYYY') : 'Never'} disabled /></Field>
      </div>
      {editable && <div className="mt-3"><Btn kind="primary" onClick={() => void save({ backup_location: location, auto_backup_days: days })}>Save backup settings</Btn></div>}
    </div>
  );
}

function SecurityTab() {
  const { can } = useApp();
  const { save, settings } = useSettingsSaver();
  const [mins, setMins] = useState('15');
  useEffect(() => {
    setMins(settings.auto_lock_minutes ?? '15');
  }, [settings]);
  const editable = can('settings.manage');
  return (
    <div className="card card-pad">
      <div className="form-grid">
        <Field label="Auto-lock after inactivity"><Select value={mins} onChange={(e) => setMins(e.target.value)} disabled={!editable}>
          <option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option>
        </Select></Field>
      </div>
      <div className="alert alert-info mt-3">
        Passwords are stored as Argon2id hashes (desktop) — never plain text. Permissions are enforced in the business layer.
        Every login, permission change, backup, restore, and deletion is audit-logged.
      </div>
      {editable && <div><Btn kind="primary" onClick={() => void save({ auto_lock_minutes: mins })}>Save security settings</Btn></div>}
    </div>
  );
}

function DataTab() {
  const { toast, refresh, can } = useApp();
  const [mod, setMod] = useState('patients');
  const [format, setFormat] = useState('csv');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  const doExport = async () => {
    setBusy(true);
    try {
      const r = await api.dataExport(mod, format, from, to);
      downloadBase64(r.filename, r.base64, format === 'json' ? 'application/json' : 'text/csv');
      toast({ kind: 'success', title: 'Export complete', message: `${r.count} row(s) exported.` });
    } catch (e) {
      toast({ kind: 'error', title: 'Export failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      await api.dataReset(typed);
      toast({ kind: 'success', title: 'Database reset', message: 'A pre-reset backup was taken. The app will restart setup.' });
      await refresh();
    } catch (e) {
      toast({ kind: 'error', title: 'Reset failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <h3 className="card-title">Controlled export</h3>
        <p className="card-sub">Exports respect your role permissions</p>
        <div className="form-grid">
          <Field label="Module"><Select value={mod} onChange={(e) => setMod(e.target.value)}>
            <option value="patients">Patients</option><option value="appointments">Appointments</option>
            <option value="invoices">Invoices</option><option value="payments">Payments</option>
            <option value="accounting">Expenses</option><option value="inventory">Inventory</option><option value="audit">Audit log</option>
          </Select></Field>
          <Field label="Format"><Select value={format} onChange={(e) => setFormat(e.target.value)}><option value="csv">CSV</option><option value="json">JSON</option></Select></Field>
          <Field label="From"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="mt-3"><Btn kind="primary" disabled={busy} onClick={() => void doExport()}>{busy ? 'Exporting…' : 'Export'}</Btn></div>
      </div>
      {can('data.danger') && (
        <div className="card card-pad" style={{ borderColor: 'var(--dp-danger)' }}>
          <h3 className="card-title" style={{ color: 'var(--dp-danger)' }}>Danger zone</h3>
          <p className="card-sub">Factory reset — deletes ALL data (a safety backup is taken first)</p>
          <div className="alert alert-error">This permanently deletes patients, visits, prescriptions, invoices, payments, stock, staff, and users. Activation is preserved; setup must be redone.</div>
          <Field label="Type DELETE ALL DATA to confirm" required><TextInput value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE ALL DATA" /></Field>
          <div className="mt-3"><Btn kind="danger" disabled={busy || typed !== 'DELETE ALL DATA'} onClick={() => void doReset()}>{busy ? 'Resetting…' : 'Reset all data'}</Btn></div>
        </div>
      )}
    </div>
  );
}

function ProfileTab() {
  const { session, toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (next.length < 8) {
      toast({ kind: 'error', title: 'Password too short', message: 'New password must be at least 8 characters.' });
      return;
    }
    if (next !== confirmPw) {
      toast({ kind: 'error', title: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirmPw('');
      toast({ kind: 'success', title: 'Password changed' });
    } catch (e) {
      toast({ kind: 'error', title: 'Change failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <h3 className="card-title">My account</h3>
        <div className="small mt-2"><strong>Name:</strong> {session?.fullName}</div>
        <div className="small"><strong>Username:</strong> <span className="mono">{session?.username}</span></div>
        <div className="small"><strong>Role:</strong> {session?.roleName}</div>
        <h4 className="mt-4">My permissions ({session?.permissions.length})</h4>
        <div className="legend">
          {(session?.permissions ?? []).slice(0, 60).map((p) => <Badge key={p}>{p}</Badge>)}
        </div>
      </div>
      <div className="card card-pad">
        <h3 className="card-title">Change password</h3>
        <div className="form-grid mt-2">
          <div className="span-2"><Field label="Current password" required><TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field></div>
          <Field label="New password" required><TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password" required><TextInput type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <div className="mt-3"><Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Change password'}</Btn></div>
      </div>
    </div>
  );
}
