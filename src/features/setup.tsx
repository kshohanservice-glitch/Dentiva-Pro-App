// Dentiva Pro — first-run setup wizard (10 steps).

import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Icons } from '../components/icons';
import { Btn, Field, TextInput, TextArea, Select } from '../components/ui';
import { friendlyError } from '../lib/ipc';
import { passwordStrength, isValidEmail } from '../lib/validation';

const STEPS = ['Welcome', 'Clinic', 'Primary dentist', 'More dentists', 'Admin account', 'Preferences', 'Backup folder', 'Auto backup', 'Security', 'Review'];

interface DentistForm {
  name: string;
  designations: string;
  registrationNo: string;
  phone: string;
  email: string;
}

export function SetupWizard() {
  const { refresh, toast } = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clinic, setClinic] = useState({ name: '', address: '', phone: '', email: '', website: '', openingHours: '9:00 AM', closingHours: '9:00 PM', weeklyOff: 'Friday', message: '', footerText: '' });
  const [dentists, setDentists] = useState<DentistForm[]>([{ name: '', designations: 'BDS', registrationNo: '', phone: '', email: '' }]);
  const [admin, setAdmin] = useState({ fullName: '', username: '', password: '', confirm: '' });
  const [prefs, setPrefs] = useState({ dateFormat: 'DD MMM YYYY', timeFormat: '12h', paperSize: 'A4', taxPercent: '0' });
  const [backup, setBackup] = useState({ location: '', scheduleDays: '7' });
  const [security, setSecurity] = useState({ autoLock: '15' });

  const setC = (k: keyof typeof clinic, v: string) => setClinic((c) => ({ ...c, [k]: v }));
  const setD = (i: number, k: keyof DentistForm, v: string) => setDentists((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));

  const validate = (): string => {
    if (step === 1) {
      if (!clinic.name.trim()) return 'Clinic name is required.';
      if (clinic.email && !isValidEmail(clinic.email)) return 'Clinic email looks invalid.';
    }
    if (step === 2) {
      if (!dentists[0].name.trim()) return 'Primary dentist name is required.';
    }
    if (step === 4) {
      if (!admin.fullName.trim()) return 'Full name is required.';
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(admin.username)) return 'Username must be 3–32 chars (letters, digits, . _ -).';
      if (admin.password.length < 8) return 'Password must be at least 8 characters.';
      if (admin.password !== admin.confirm) return 'Passwords do not match.';
    }
    return '';
  };

  const next = () => {
    const err = validate();
    setError(err);
    if (!err) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const finish = async () => {
    setError('');
    setBusy(true);
    try {
      await api.setupInit({
        clinic,
        dentists: dentists.filter((d) => d.name.trim()).map((d) => ({
          name: d.name.trim(),
          designations: d.designations.split('\n').map((x) => x.trim()).filter(Boolean),
          registrationNo: d.registrationNo.trim(),
          phone: d.phone.trim(),
          email: d.email.trim(),
        })),
        admin: { fullName: admin.fullName.trim(), username: admin.username.trim(), password: admin.password },
        preferences: prefs,
        backup,
        security,
      });
      toast({ kind: 'success', title: 'Setup complete', message: 'Please sign in with your owner account.' });
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const pw = passwordStrength(admin.password);

  return (
    <div className="auth-wrap">
      <div className="wizard">
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`wizard-step${i < step ? ' done' : ''}${i === step ? ' now' : ''}`}>{i + 1}. {s}</div>
          ))}
        </div>
        <div className="wizard-body">
          {step === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div className="brand-mark" style={{ width: 56, height: 56, margin: '0 auto 14px' }}>{Icons.tooth}</div>
              <h2 style={{ margin: '0 0 6px', color: 'var(--dp-navy-900)' }}>Welcome to Dentiva Pro</h2>
              <p className="muted">Let&apos;s set up your clinic in a few quick steps. Everything stays on this computer — no internet needed.</p>
            </div>
          )}
          {step === 1 && (
            <div className="form-grid">
              <div className="span-2"><Field label="Clinic / dental care name" required><TextInput value={clinic.name} onChange={(e) => setC('name', e.target.value)} placeholder="e.g. Smile Dental Care" /></Field></div>
              <div className="span-2"><Field label="Address"><TextArea value={clinic.address} onChange={(e) => setC('address', e.target.value)} placeholder="House, road, area, city" /></Field></div>
              <Field label="Phone"><TextInput value={clinic.phone} onChange={(e) => setC('phone', e.target.value)} placeholder="01XXXXXXXXX" /></Field>
              <Field label="Email"><TextInput value={clinic.email} onChange={(e) => setC('email', e.target.value)} placeholder="clinic@example.com" /></Field>
              <Field label="Website"><TextInput value={clinic.website} onChange={(e) => setC('website', e.target.value)} /></Field>
              <Field label="Weekly off day"><TextInput value={clinic.weeklyOff} onChange={(e) => setC('weeklyOff', e.target.value)} placeholder="Friday" /></Field>
              <Field label="Opening hours"><TextInput value={clinic.openingHours} onChange={(e) => setC('openingHours', e.target.value)} /></Field>
              <Field label="Closing hours"><TextInput value={clinic.closingHours} onChange={(e) => setC('closingHours', e.target.value)} /></Field>
            </div>
          )}
          {step === 2 && (
            <div className="form-grid">
              <div className="span-2"><Field label="Dentist name" required><TextInput value={dentists[0].name} onChange={(e) => setD(0, 'name', e.target.value)} placeholder="Dr. …" /></Field></div>
              <div className="span-2"><Field label="Designations (one per line)" hint="Printed on prescriptions, e.g. BDS (DU), PGT (Orthodontics)"><TextArea value={dentists[0].designations} onChange={(e) => setD(0, 'designations', e.target.value)} /></Field></div>
              <Field label="Registration no."><TextInput value={dentists[0].registrationNo} onChange={(e) => setD(0, 'registrationNo', e.target.value)} /></Field>
              <Field label="Phone"><TextInput value={dentists[0].phone} onChange={(e) => setD(0, 'phone', e.target.value)} /></Field>
              <div className="span-2"><Field label="Email"><TextInput value={dentists[0].email} onChange={(e) => setD(0, 'email', e.target.value)} /></Field></div>
            </div>
          )}
          {step === 3 && (
            <div>
              <p className="small muted">Add more dentists now, or skip — you can always add them later in Settings. Each dentist has an independent profile.</p>
              {dentists.slice(1).map((d, k) => (
                <div key={k} className="card card-pad mb-3">
                  <div className="form-grid">
                    <Field label={`Dentist #${k + 2} name`}><TextInput value={d.name} onChange={(e) => setD(k + 1, 'name', e.target.value)} /></Field>
                    <Field label="Phone"><TextInput value={d.phone} onChange={(e) => setD(k + 1, 'phone', e.target.value)} /></Field>
                    <div className="span-2"><Field label="Designations (one per line)"><TextArea value={d.designations} onChange={(e) => setD(k + 1, 'designations', e.target.value)} /></Field></div>
                  </div>
                  <div className="mt-2"><Btn size="sm" kind="ghost" onClick={() => setDentists((ds) => ds.filter((_, j) => j !== k + 1))}>Remove</Btn></div>
                </div>
              ))}
              <Btn kind="secondary" onClick={() => setDentists((ds) => [...ds, { name: '', designations: '', registrationNo: '', phone: '', email: '' }])}>+ Add dentist</Btn>
            </div>
          )}
          {step === 4 && (
            <div className="form-grid">
              <Field label="Full name" required><TextInput value={admin.fullName} onChange={(e) => setAdmin((a) => ({ ...a, fullName: e.target.value }))} /></Field>
              <Field label="Username" required><TextInput value={admin.username} onChange={(e) => setAdmin((a) => ({ ...a, username: e.target.value }))} /></Field>
              <Field label="Password" required hint={`Strength: ${pw.label}${pw.hints.length ? ` — ${pw.hints[0]}` : ''}`}><TextInput type="password" value={admin.password} onChange={(e) => setAdmin((a) => ({ ...a, password: e.target.value }))} autoComplete="new-password" /></Field>
              <Field label="Confirm password" required><TextInput type="password" value={admin.confirm} onChange={(e) => setAdmin((a) => ({ ...a, confirm: e.target.value }))} autoComplete="new-password" /></Field>
              <div className="span-2 small muted">This owner account has full access. Create staff accounts with limited roles after setup.</div>
            </div>
          )}
          {step === 5 && (
            <div className="form-grid">
              <Field label="Currency"><Select value="BDT" disabled><option value="BDT">BDT (৳)</option></Select></Field>
              <Field label="Invoice tax %"><TextInput value={prefs.taxPercent} onChange={(e) => setPrefs((p) => ({ ...p, taxPercent: e.target.value }))} inputMode="decimal" /></Field>
              <Field label="Date format"><Select value={prefs.dateFormat} onChange={(e) => setPrefs((p) => ({ ...p, dateFormat: e.target.value }))}>
                <option>DD MMM YYYY</option><option>DD-MM-YYYY</option><option>MM-DD-YYYY</option><option>YYYY-MM-DD</option>
              </Select></Field>
              <Field label="Time format"><Select value={prefs.timeFormat} onChange={(e) => setPrefs((p) => ({ ...p, timeFormat: e.target.value }))}>
                <option value="12h">12-hour (AM/PM)</option><option value="24h">24-hour</option>
              </Select></Field>
              <Field label="Default paper size"><Select value={prefs.paperSize} onChange={(e) => setPrefs((p) => ({ ...p, paperSize: e.target.value }))}>
                <option>A4</option><option>A5</option>
              </Select></Field>
            </div>
          )}
          {step === 6 && (
            <div className="form-grid">
              <div className="span-2"><Field label="Backup folder" hint="In the desktop app, backups are written to this folder. In web preview, backups download as files."><TextInput value={backup.location} onChange={(e) => setBackup((b) => ({ ...b, location: e.target.value }))} placeholder="e.g. D:\DentivaBackups (optional)" /></Field></div>
            </div>
          )}
          {step === 7 && (
            <div className="form-grid">
              <Field label="Automatic backup schedule"><Select value={backup.scheduleDays} onChange={(e) => setBackup((b) => ({ ...b, scheduleDays: e.target.value }))}>
                <option value="7">Every 7 days</option><option value="15">Every 15 days</option><option value="30">Every 30 days</option>
              </Select></Field>
            </div>
          )}
          {step === 8 && (
            <div className="form-grid">
              <Field label="Auto-lock after inactivity"><Select value={security.autoLock} onChange={(e) => setSecurity((s) => ({ ...s, autoLock: e.target.value }))}>
                <option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option>
              </Select></Field>
            </div>
          )}
          {step === 9 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Review</h3>
              <div className="card card-pad small">
                <div><strong>Clinic:</strong> {clinic.name || '—'} · {clinic.phone || '—'}</div>
                <div><strong>Dentists:</strong> {dentists.filter((d) => d.name.trim()).length}</div>
                <div><strong>Owner:</strong> {admin.fullName || '—'} ({admin.username || '—'})</div>
                <div><strong>Date/time:</strong> {prefs.dateFormat} · {prefs.timeFormat} · Paper {prefs.paperSize}</div>
                <div><strong>Backup:</strong> every {backup.scheduleDays} days{backup.location ? ` → ${backup.location}` : ''}</div>
                <div><strong>Auto-lock:</strong> {security.autoLock} minutes</div>
              </div>
            </div>
          )}
          {error && <div className="alert alert-error mt-3">{error}</div>}
        </div>
        <div className="wizard-actions">
          <Btn kind="ghost" disabled={step === 0 || busy} onClick={() => { setError(''); setStep((s) => s - 1); }}>Back</Btn>
          {step < STEPS.length - 1
            ? <Btn kind="primary" onClick={next}>Continue</Btn>
            : <Btn kind="primary" disabled={busy} onClick={() => void finish()}>{busy ? 'Setting up…' : 'Finish setup'}</Btn>}
        </div>
      </div>
    </div>
  );
}
