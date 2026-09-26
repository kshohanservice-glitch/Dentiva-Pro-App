// Dentiva Pro — dashboard (permission-aware widgets).

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Loading, ErrorBox, Badge } from '../components/ui';
import { formatBdt, formatBdtCompact } from '../lib/money';
import { formatDate, formatTime } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function DashboardPage() {
  const { can, navigate, dateFormat, timeFormat } = useApp();
  const [data, setData] = useState<R | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      setData(await api.dashboard());
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  useEffect(() => { void load(); }, []);

  if (error) return <div className="page-head"><h1 className="page-title">Dashboard</h1></div>;
  if (!data) return <Loading label="Loading dashboard…" />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">{formatDate(data.date, dateFormat)} — here is your clinic at a glance.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => void load()}>Refresh</button>
          {can('patients.create') && <button className="btn btn-primary" onClick={() => navigate('patients/new')}>+ New patient</button>}
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="grid grid-4">
        {can('patients.view') && (
          <>
            <div className="stat-card"><div className="stat-label">Today&apos;s patients</div><div className="stat-value">{data.todayPatients ?? 0}</div><div className="stat-foot">Visits recorded today</div></div>
            <div className="stat-card"><div className="stat-label">New patients</div><div className="stat-value">{data.newPatients ?? 0}</div><div className="stat-foot">Registered today · {data.totalPatients ?? 0} total</div></div>
          </>
        )}
        {can('appointments.view') && (
          <>
            <div className="stat-card"><div className="stat-label">Today&apos;s appointments</div><div className="stat-value">{data.todayAppointments ?? 0}</div><div className="stat-foot">{data.missedAppointments ? `${data.missedAppointments} need follow-up` : 'Schedule is clear'}</div></div>
            <div className="stat-card"><div className="stat-label">Waiting in queue</div><div className="stat-value">{data.queueWaiting ?? 0}</div><div className="stat-foot">Currently waiting / called</div></div>
          </>
        )}
        {can('payments.view') && (
          <>
            <div className="stat-card"><div className="stat-label">Today&apos;s revenue</div><div className="stat-value">{formatBdtCompact(data.todayRevenue ?? 0)}</div><div className="stat-foot">{formatBdt(data.todayRevenue ?? 0)} collected</div></div>
            <div className="stat-card"><div className="stat-label">Outstanding balance</div><div className="stat-value">{formatBdtCompact(data.outstanding ?? 0)}</div><div className="stat-foot">Across all open invoices</div></div>
          </>
        )}
        {can('inventory.view') && (
          <>
            <div className="stat-card"><div className="stat-label">Low stock items</div><div className="stat-value">{data.lowStock ?? 0}</div><div className="stat-foot">At or below reorder level</div></div>
            <div className="stat-card"><div className="stat-label">Expiring soon</div><div className="stat-value">{data.expiring ?? 0}</div><div className="stat-foot">Within 90 days</div></div>
          </>
        )}
      </div>

      <div className="grid grid-2 mt-4">
        {can('appointments.view') && (
          <div className="card card-pad">
            <h3 className="card-title">Upcoming appointments</h3>
            <p className="card-sub">Next scheduled visits</p>
            {(data.upcomingAppointments ?? []).length === 0 && <p className="muted small">No upcoming appointments.</p>}
            {(data.upcomingAppointments ?? []).map((a: R) => (
              <div key={a.id} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
                <div><div className="cell-main">{a.patient_name}</div><div className="cell-sub">{formatDate(a.appt_date, dateFormat)} · {formatTime(a.appt_time, timeFormat)}</div></div>
                <Badge tone={a.status === 'Confirmed' ? 'green' : 'amber'}>{a.status}</Badge>
              </div>
            ))}
          </div>
        )}
        {can('queue.manage') && (
          <div className="card card-pad">
            <h3 className="card-title">Live queue</h3>
            <p className="card-sub">Now waiting</p>
            {(data.queueNow ?? []).length === 0 && <p className="muted small">Queue is empty. <button className="btn btn-xs btn-secondary" onClick={() => navigate('queue')}>Open queue</button></p>}
            {(data.queueNow ?? []).map((q: R) => (
              <div key={q.id} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
                <div><div className="cell-main">#{q.queue_no} · {q.patient_name}</div><div className="cell-sub">{q.dentist_id ? '' : ''}{formatTime(q.arrival_time?.slice(11, 16) ?? '', timeFormat)} arrival</div></div>
                <Badge tone={q.status === 'in_progress' ? 'blue' : 'amber'}>{q.status}</Badge>
              </div>
            ))}
          </div>
        )}
        {can('patients.view') && (
          <div className="card card-pad">
            <h3 className="card-title">Recent patients</h3>
            <p className="card-sub">Latest registrations</p>
            {(data.recentPatients ?? []).map((p: R) => (
              <div key={p.id} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
                <div><button className="btn btn-xs btn-ghost rowlink" style={{ padding: 0 }} onClick={() => navigate(`patients/${p.id}`)}><span className="cell-main">{p.name}</span></button><div className="cell-sub">{p.code} · {p.phone || '—'}</div></div>
                <span className="muted small">{formatDate(p.reg_date, dateFormat)}</span>
              </div>
            ))}
          </div>
        )}
        {can('payments.view') && (
          <div className="card card-pad">
            <h3 className="card-title">Recent payments</h3>
            <p className="card-sub">Latest collections</p>
            {(data.recentPayments ?? []).map((p: R, i: number) => (
              <div key={i} className="flex justify-between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
                <div><div className="cell-main">{p.patient_name}</div><div className="cell-sub">{p.receipt_no} · {p.method}</div></div>
                <strong className="mono">{formatBdt(p.amount_paisa)}</strong>
              </div>
            ))}
            {(data.recentPayments ?? []).length === 0 && <p className="muted small">No payments recorded yet.</p>}
          </div>
        )}
      </div>

      <div className="grid grid-2 mt-4">
        {can('payments.view') && (data.revenueTrend ?? []).length > 0 && (
          <div className="card card-pad">
            <h3 className="card-title">Revenue trend — last 14 days</h3>
            <TrendBars data={(data.revenueTrend as R[]).map((r) => ({ label: String(r.d).slice(5), value: r.total }))} money />
          </div>
        )}
        {can('appointments.view') && (data.appointmentTrend ?? []).length > 0 && (
          <div className="card card-pad">
            <h3 className="card-title">Appointments — last 14 days</h3>
            <TrendBars data={(data.appointmentTrend as R[]).map((r) => ({ label: String(r.d).slice(5), value: r.n }))} />
          </div>
        )}
      </div>
    </div>
  );
}

function TrendBars({ data, money }: { data: Array<{ label: string; value: number }>; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-center gap-2" style={{ alignItems: 'flex-end', height: 130, marginTop: 8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }} title={`${d.label}: ${money ? formatBdt(d.value) : d.value}`}>
          <div style={{ height: Math.max(4, (d.value / max) * 92), width: '70%', maxWidth: 26, borderRadius: 4, background: 'linear-gradient(180deg, var(--dp-teal-500), var(--dp-navy-700))' }} />
          <div className="muted" style={{ fontSize: 9 }}>{d.label.slice(0, 6)}</div>
        </div>
      ))}
    </div>
  );
}
