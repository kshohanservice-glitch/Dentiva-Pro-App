// Dentiva Pro — appointments (day/week/month/list views + full lifecycle).

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Select, SearchInput, Tabs, Modal, EmptyState, Loading, StatusBadge, Field, TextInput } from '../components/ui';
import { AppointmentModal, useDentists } from './_modals';
import { formatDate, formatTime, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function AppointmentsPage() {
  const { can, navigate, dateFormat, timeFormat, toast, confirm } = useApp();
  const [view, setView] = useState('day');
  const [anchor, setAnchor] = useState(todayISO());
  const [dentistId, setDentistId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<R | 'new' | null>(null);
  const dentists = useDentists();

  const rangeOf = (v: string, a: string): [string, string] => {
    const d = new Date(`${a}T12:00:00`);
    if (v === 'day') return [a, a];
    if (v === 'week') {
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((day + 6) % 7));
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)];
    }
    const first = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    return [first, last];
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [from, to] = view === 'list' ? [anchor, '2100-01-01'] : rangeOf(view, anchor);
      setRows(await api.appointmentsList({ from, to: view === 'list' ? undefined : to, dentistId: dentistId || undefined, status: status || undefined, search: search || undefined }) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [view, anchor, dentistId, status, search, toast]);

  useEffect(() => { void load(); }, [load]);

  const shift = (dir: number) => {
    const d = new Date(`${anchor}T12:00:00`);
    d.setDate(d.getDate() + (view === 'day' ? dir : view === 'week' ? dir * 7 : dir * 30));
    setAnchor(d.toISOString().slice(0, 10));
  };

  const setStatusOf = async (a: R, s: string) => {
    try {
      await api.appointmentsSave({ id: a.id, patientId: a.patient_id, dentistId: a.dentist_id, apptDate: a.appt_date, apptTime: a.appt_time, durationMin: a.duration_min, reason: a.reason, apptType: a.appt_type, notes: a.notes, status: s });
      toast({ kind: 'success', title: `Appointment → ${s}` });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Update failed', message: friendlyError(e) });
    }
  };

  const remove = async (a: R) => {
    const ok = await confirm({ title: 'Delete appointment?', body: <p>Appointment for <strong>{a.patient_name}</strong> on {a.appt_date} will be deleted.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.appointmentsDelete(a.id);
      toast({ kind: 'success', title: 'Appointment deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  const checkIn = async (a: R) => {
    try {
      const q = await api.queueAdd({ patientId: a.patient_id, dentistId: a.dentist_id, appointmentId: a.id });
      toast({ kind: 'success', title: `Checked in — queue #${q.queueNo}` });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Check-in failed', message: friendlyError(e) });
    }
  };

  const [from, to] = rangeOf(view, anchor);
  const days: string[] = [];
  if (view === 'week' || view === 'month') {
    const d = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    while (d <= end) {
      days.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  }


  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Appointments</h1>
          <p className="page-sub">Schedule, confirm, check in, and follow up.</p>
        </div>
        <div className="page-actions">
          {can('appointments.manage') && <Btn kind="primary" onClick={() => setModal('new')}>+ New appointment</Btn>}
        </div>
      </div>

      <div className="card card-pad">
        <div className="toolbar">
          <Tabs tabs={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'list', label: 'List' }]} active={view} onChange={setView} />
        </div>
        <div className="toolbar">
          <Btn size="sm" kind="ghost" onClick={() => shift(-1)}>‹</Btn>
          <TextInput type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} style={{ width: 'auto' }} />
          <Btn size="sm" kind="ghost" onClick={() => shift(1)}>›</Btn>
          <Btn size="sm" kind="ghost" onClick={() => setAnchor(todayISO())}>Today</Btn>
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">All dentists</option>
            {dentists.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['Scheduled', 'Confirmed', 'Arrived', 'In Queue', 'In Progress', 'Completed', 'No Show', 'Cancelled', 'Rescheduled'].map((s) => <option key={s}>{s}</option>)}
          </Select>
          <SearchInput value={search} onChange={setSearch} placeholder="Search patient…" />
        </div>

        {loading && <Loading />}
        {!loading && rows.length === 0 && (
          <EmptyState
            title="No appointments"
            message={view === 'day' ? `Nothing scheduled for ${formatDate(anchor, dateFormat)}.` : 'No appointments in this period.'}
            action={can('appointments.manage') ? <Btn kind="primary" onClick={() => setModal('new')}>+ New appointment</Btn> : undefined}
          />
        )}
        {!loading && rows.length > 0 && (view === 'day' || view === 'list') && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Dentist</th><th>Reason</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.appt_date, dateFormat)}</td>
                  <td className="mono">{formatTime(a.appt_time, timeFormat)}</td>
                  <td><span className="rowlink" onClick={() => navigate(`patients/${a.patient_id}`)}>{a.patient_name}</span><div className="cell-sub">{a.patient_code}</div></td>
                  <td>{a.dentist_name || '—'}</td>
                  <td>{a.reason || a.appt_type}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {can('appointments.manage') && (
                      <>
                        <Btn size="xs" kind="ghost" onClick={() => setModal(a)}>Edit</Btn>
                        {['Scheduled', 'Confirmed'].includes(a.status) && <Btn size="xs" kind="ghost" onClick={() => void checkIn(a)}>Check in</Btn>}
                        {a.status === 'Scheduled' && <Btn size="xs" kind="ghost" onClick={() => void setStatusOf(a, 'Confirmed')}>Confirm</Btn>}
                        <Btn size="xs" kind="ghost" onClick={() => navigate(`patients/${a.patient_id}`)}>Open patient</Btn>
                        <Btn size="xs" kind="ghost" onClick={() => void remove(a)}>Delete</Btn>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {!loading && rows.length > 0 && (view === 'week' || view === 'month') && (
          <div className="grid" style={{ gridTemplateColumns: view === 'week' ? 'repeat(7, minmax(140px, 1fr))' : 'repeat(7, minmax(120px, 1fr))', overflowX: 'auto' }}>
            {days.map((d) => (
              <div key={d} className="card card-pad" style={{ padding: 8, minHeight: 120, background: d === todayISO() ? 'var(--dp-teal-50)' : undefined }}>
                <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>{formatDate(d, dateFormat)}</div>
                {rows.filter((r) => r.appt_date === d).map((a) => (
                  <div key={a.id} onClick={() => can('appointments.manage') && setModal(a)} style={{ fontSize: 11.5, padding: '3px 6px', borderRadius: 5, background: '#fff', border: '1px solid var(--dp-border)', marginBottom: 4, cursor: can('appointments.manage') ? 'pointer' : 'default' }} title={`${a.patient_name} — ${a.status}`}>
                    <strong>{formatTime(a.appt_time, timeFormat)}</strong> {a.patient_name}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <AppointmentModal
          appointment={modal === 'new' ? null : modal}
          defaultDate={anchor}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); void load(); }}
        />
      )}
      {void Field}
      {void TextInput}
      {void Modal}
    </div>
  );
}
