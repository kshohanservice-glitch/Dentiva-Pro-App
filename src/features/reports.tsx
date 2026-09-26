// Dentiva Pro — reports with print + CSV/JSON export.

import { useState } from 'react';
import { api, downloadBase64 } from '../api';
import { useApp } from '../state/app';
import { Btn, Select, Field, Loading, DateRangeBar, EmptyState } from '../components/ui';
import { PrintPreviewModal } from '../components/printPreview';
import { buildReportHtml, type PrintPackage } from '../print/engine';
import { formatBdt } from '../lib/money';
import { todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const REPORTS = [
  { id: 'registrations', label: 'Patient registrations', fin: false },
  { id: 'visits', label: 'Visit history', fin: false },
  { id: 'appointments', label: 'Appointments', fin: false },
  { id: 'treatments', label: 'Treatments', fin: false },
  { id: 'prescriptions', label: 'Prescriptions', fin: false },
  { id: 'invoices', label: 'Invoices', fin: true },
  { id: 'payments', label: 'Payments', fin: true },
  { id: 'outstanding', label: 'Outstanding balances', fin: true },
  { id: 'inventory', label: 'Inventory stock', fin: false },
  { id: 'expiry', label: 'Expiry report', fin: false },
  { id: 'expenses', label: 'Expenses', fin: true },
  { id: 'income', label: 'Income', fin: true },
  { id: 'profit', label: 'Profit / net', fin: true },
  { id: 'dentist_activity', label: 'Dentist activity', fin: false },
  { id: 'audit', label: 'Audit report', fin: false },
];

const MONEY_HINT = ['total_paisa', 'paid_paisa', 'due', 'amount_paisa', 'amount', 'total', 'Amount (paisa)', 'Total', 'Paid', 'Due', 'Amount'];

export function ReportsPage() {
  const { can, toast } = useApp();
  const [type, setType] = useState('registrations');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [result, setResult] = useState<{ columns: string[]; rows: R[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PrintPackage | null>(null);

  const report = REPORTS.find((r) => r.id === type)!;
  const allowed = report.fin ? can('reports.financial') : true;

  const run = async () => {
    setLoading(true);
    try {
      const r = await api.reportRun(type, from, to);
      setResult(r as { columns: string[]; rows: R[]; total: number });
    } catch (e) {
      toast({ kind: 'error', title: 'Report failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  };

  const keys = result && result.rows.length ? Object.keys(result.rows[0]) : [];
  const moneyIdx = keys.map((k, i) => (MONEY_HINT.includes(k) ? i : -1)).filter((i) => i >= 0);

  const doPrint = async () => {
    if (!result) return;
    const clinic = await api.clinicGet();
    setPreview(buildReportHtml({ clinic: clinic as R, title: report.label, from, to, columns: result.columns, rows: result.rows, moneyCols: moneyIdx }));
  };

  const doExport = async (format: 'csv' | 'json') => {
    if (!result || !result.rows.length) {
      toast({ kind: 'error', title: 'Nothing to export', message: 'Run a report with rows first.' });
      return;
    }
    const content = format === 'json'
      ? JSON.stringify({ report: type, from, to, rows: result.rows }, null, 2)
      : toCsv(result.columns, keys, result.rows);
    const b64 = btoa(unescape(encodeURIComponent('﻿' + content)));
    downloadBase64(`DentivaPro_${type}_${from}_to_${to}.${format}`, b64, format === 'json' ? 'application/json' : 'text/csv');
    toast({ kind: 'success', title: 'Exported', message: `${result.rows.length} row(s).` });
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">Operational and financial insight for your clinic.</p>
        </div>
      </div>

      <div className="card card-pad">
        <div className="toolbar">
          <Field label="Report"><Select value={type} onChange={(e) => { setType(e.target.value); setResult(null); }} style={{ minWidth: 220 }}>
            {REPORTS.map((r) => <option key={r.id} value={r.id}>{r.label}{r.fin ? ' (financial)' : ''}</option>)}
          </Select></Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><Btn kind="primary" disabled={loading || !allowed} onClick={() => void run()}>{loading ? 'Running…' : 'Run report'}</Btn></div>
        </div>
        <DateRangeBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {!allowed && <div className="alert alert-warning">Financial reports require the <strong>reports.financial</strong> permission.</div>}
        {loading && <Loading />}
        {!loading && !result && <EmptyState title="Choose a report" message="Pick a report and date range, then run it." />}
        {!loading && result && (
          <>
            <div className="toolbar">
              <span className="muted small"><strong>{result.rows.length}</strong> row(s)
                {(report.fin || type === 'treatments') && <> · Total: <strong className="mono">{formatBdt(result.total)}</strong></>}
                {type === 'registrations' && <> · Total: <strong>{result.total}</strong></>}
              </span>
              <span style={{ flex: 1 }} />
              <Btn size="sm" kind="secondary" onClick={() => void doPrint()}>Print / PDF</Btn>
              <Btn size="sm" kind="secondary" onClick={() => void doExport('csv')}>Export CSV</Btn>
              <Btn size="sm" kind="secondary" onClick={() => void doExport('json')}>Export JSON</Btn>
            </div>
            <div className="table-wrap" style={{ maxHeight: 520 }}><table className="table">
              <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {result.rows.slice(0, 1000).map((r, i) => (
                  <tr key={i}>
                    {keys.map((k, j) => (
                      <td key={k} className={typeof r[k] === 'number' ? 'num mono' : ''}>
                        {moneyIdx.includes(j) && typeof r[k] === 'number' ? formatBdt(r[k]) : String(r[k] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table></div>
            {result.rows.length > 1000 && <p className="muted small mt-2">Showing first 1,000 of {result.rows.length} rows. Export for the full set.</p>}
          </>
        )}
      </div>
      {preview && <PrintPreviewModal docType="report" pkg={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function toCsv(columns: string[], keys: string[], rows: R[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(esc).join(',')];
  for (const r of rows) lines.push(keys.map((k) => esc(r[k])).join(','));
  return lines.join('\n');
}
