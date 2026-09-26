// Dentiva Pro — audit log viewer.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { SearchInput, Loading, EmptyState, Pager, TextInput, DateRangeBar } from '../components/ui';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function AuditPage() {
  const { toast, dateFormat } = useApp();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: R[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.auditList({ from, to, search: search || undefined, action: action || undefined, page, pageSize: 50 });
      setData(r as { rows: R[]; total: number });
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [from, to, search, action, page, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [from, to, search, action]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-sub">Every important action, who did it, and when. Newest first.</p>
        </div>
      </div>
      <div className="card card-pad">
        <DateRangeBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search summary / user…" />
          <TextInput value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action filter, e.g. payment" style={{ width: 220 }} />
        </div>
        {loading && <Loading />}
        {!loading && (!data || data.rows.length === 0) && <EmptyState title="No audit events" message="Actions in this period will appear here." />}
        {!loading && data && data.rows.length > 0 && (
          <>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Summary</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small mono" style={{ whiteSpace: 'nowrap' }}>{formatDate(r.timestamp, dateFormat)} {String(r.timestamp).slice(11, 19)}</td>
                    <td>{r.username || '—'}</td>
                    <td><code className="small">{r.action}</code></td>
                    <td className="small">{r.entity_type}{r.entity_id ? ` #${r.entity_id}` : ''}</td>
                    <td className="small">{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <Pager page={page} pageSize={50} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
