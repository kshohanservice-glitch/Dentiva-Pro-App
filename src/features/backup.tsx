// Dentiva Pro — backup & restore with mandatory pre-restore safety backup.

import { useCallback, useEffect, useState } from 'react';
import { api, downloadBase64 } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, EmptyState, Loading, StatusBadge } from '../components/ui';
import { formatDate } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function BackupPage() {
  const { can, toast, dateFormat, refresh, settings } = useApp();
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<{ name: string; base64: string } | null>(null);
  const [meta, setMeta] = useState<R | null>(null);
  const [typed, setTyped] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.backupList() as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const runBackup = async () => {
    setBusy(true);
    try {
      const b = await api.backupRun('manual');
      downloadBase64(b.filename, b.base64, 'application/octet-stream');
      toast({
        kind: b.missing.length ? 'warning' : 'success',
        title: 'Backup complete',
        message: `${b.filename} (${(b.sizeBytes / 1024).toFixed(0)} KB)${b.missing.length ? ` — ${b.missing.length} attachment file(s) missing from storage.` : ' — database + attachments included.'}`,
      });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Backup failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      const s = String(r.result ?? '');
      const base64 = s.includes(',') ? s.split(',')[1] : s;
      setRestoreFile({ name: f.name, base64 });
      try {
        setMeta(await api.restoreValidate(f.name, base64) as R);
      } catch (e) {
        setMeta(null);
        toast({ kind: 'error', title: 'Invalid backup file', message: friendlyError(e) });
      }
    };
    r.readAsDataURL(f);
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    setBusy(true);
    try {
      await api.restoreRun(restoreFile.name, restoreFile.base64, typed);
      toast({ kind: 'success', title: 'Restore completed', message: 'A pre-restore safety backup was kept. The app will now reload its state.' });
      setRestoreFile(null);
      setMeta(null);
      setTyped('');
      await refresh();
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Restore failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const last = rows.find((r) => r.kind !== 'pre-restore' && r.status === 'ok') ?? rows[0];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Backup & Restore</h1>
          <p className="page-sub">Full database + attachment backups. Never lose clinic data.</p>
        </div>
        <div className="page-actions">
          {can('backup.run') && <Btn kind="primary" disabled={busy} onClick={() => void runBackup()}>{busy ? 'Working…' : 'Run backup now'}</Btn>}
        </div>
      </div>

      <div className="grid grid-3 mb-3">
        <div className="stat-card"><div className="stat-label">Last backup</div><div className="stat-value" style={{ fontSize: 17 }}>{last ? formatDate(last.created_at, dateFormat) : 'Never'}</div><div className="stat-foot">{last?.filename ?? 'Run your first backup now'}</div></div>
        <div className="stat-card"><div className="stat-label">Schedule</div><div className="stat-value" style={{ fontSize: 17 }}>Every {settings.auto_backup_days ?? '7'} days</div><div className="stat-foot">Change in Settings → Backup</div></div>
        <div className="stat-card"><div className="stat-label">Location</div><div className="stat-value" style={{ fontSize: 14 }}>{settings.backup_location || 'Downloads (preview) / app folder'}</div><div className="stat-foot">Backups download as .dentivabak files</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <h3 className="card-title">Backup history</h3>
          <p className="card-sub">Record of backups created on this installation</p>
          {loading && <Loading />}
          {!loading && rows.length === 0 && <EmptyState title="No backups yet" message="Run your first backup to protect your data." />}
          {!loading && rows.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 420 }}><table className="table">
              <thead><tr><th>File</th><th>When</th><th>Size</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small mono">{r.filename}<div className="cell-sub">{r.kind} · v{r.app_version} · schema {r.schema_version}</div></td>
                    <td className="small">{formatDate(r.created_at, dateFormat)}</td>
                    <td className="small mono">{(r.size_bytes / 1024).toFixed(0)} KB</td>
                    <td><StatusBadge status={r.status === 'ok' ? 'Success' : r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Restore from backup</h3>
          <p className="card-sub">A mandatory safety backup of current data is taken first</p>
          {!can('backup.restore') && <div className="alert alert-warning">Restoring requires the <strong>backup.restore</strong> permission.</div>}
          {can('backup.restore') && (
            <>
              <Field label="Backup file (.dentivabak)">
                <TextInput type="file" accept=".dentivabak" onChange={(e) => pickFile(e.target.files?.[0])} />
              </Field>
              {meta && (
                <div className="card card-pad mt-3" style={{ background: 'var(--dp-surface-2)' }}>
                  <div className="small"><strong>Clinic:</strong> {meta.clinicName || '—'}</div>
                  <div className="small"><strong>Created:</strong> {formatDate(meta.createdAt, dateFormat)}</div>
                  <div className="small"><strong>App / schema:</strong> v{meta.appVersion} / {meta.schemaVersion}</div>
                  <div className="small"><strong>Attachments:</strong> {meta.attachments}</div>
                  <div className="small"><strong>Checksum:</strong> {meta.checksumOk ? 'valid' : 'INVALID'}</div>
                </div>
              )}
              {meta && (
                <div className="mt-3">
                  <div className="alert alert-error">
                    <strong>Warning:</strong> restoring replaces ALL current data (patients, invoices, stock, users).
                    A pre-restore safety backup is created automatically, but verify the backup details above before continuing.
                  </div>
                  <Field label="Type RESTORE to confirm" required>
                    <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="RESTORE" />
                  </Field>
                  <div className="mt-3">
                    <Btn kind="danger" disabled={busy || typed !== 'RESTORE' || !meta.checksumOk} onClick={() => void doRestore()}>
                      {busy ? 'Restoring…' : 'Restore now'}
                    </Btn>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
