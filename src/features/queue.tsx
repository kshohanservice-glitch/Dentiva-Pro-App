// Dentiva Pro — live queue management.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, TextInput, Select, EmptyState, Loading, Badge, Modal, Field } from '../components/ui';
import { PatientPicker, DentistSelect } from './_modals';
import { formatTime, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

function waitingMinutes(arrival: string): number {
  const t = Date.parse(arrival.replace(' ', 'T'));
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

function waitTone(mins: number): 'green' | 'amber' | 'red' {
  if (mins < 15) return 'green';
  if (mins < 40) return 'amber';
  return 'red';
}

export function QueuePage() {
  const { navigate, timeFormat, toast } = useApp();
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.queueList(date) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [date, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: number, action: string) => {
    try {
      await api.queueAction(id, action);
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Action failed', message: friendlyError(e) });
    }
  };

  const callNext = async () => {
    const next = rows.find((r) => r.status === 'waiting');
    if (!next) {
      toast({ kind: 'info', title: 'Queue empty', message: 'Nobody is waiting right now.' });
      return;
    }
    await act(next.id, 'call');
  };

  const active = rows.filter((r) => !['completed', 'cancelled'].includes(r.status));
  const done = rows.filter((r) => ['completed', 'cancelled'].includes(r.status));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Queue</h1>
          <p className="page-sub">{active.length} waiting · {done.length} finished · {date}</p>
        </div>
        <div className="page-actions">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
          <Btn kind="secondary" onClick={() => void load()}>Refresh</Btn>
          <Btn kind="secondary" onClick={() => void callNext()}>Call next</Btn>
          <Btn kind="primary" onClick={() => setAddOpen(true)}>+ Add to queue</Btn>
        </div>
      </div>

      <div className="card card-pad">
        {loading && <Loading />}
        {!loading && rows.length === 0 && (
          <EmptyState title="Queue is empty" message="Add walk-ins or check patients in from Appointments." action={<Btn kind="primary" onClick={() => setAddOpen(true)}>+ Add to queue</Btn>} />
        )}
        {!loading && rows.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>#</th><th>Patient</th><th>Dentist</th><th>Arrived</th><th>Waiting</th><th>Priority</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((q) => {
                const mins = waitingMinutes(q.arrival_time);
                return (
                  <tr key={q.id} style={{ background: q.status === 'in_progress' ? 'var(--dp-teal-50)' : undefined }}>
                    <td><strong style={{ fontSize: 16 }}>#{q.queue_no}</strong></td>
                    <td><span className="rowlink" onClick={() => navigate(`patients/${q.patient_id}`)}>{q.patient_name}</span><div className="cell-sub">{q.patient_code}</div></td>
                    <td>{q.dentist_name || '—'}</td>
                    <td className="mono">{formatTime(q.arrival_time?.slice(11, 16) ?? '', timeFormat)}</td>
                    <td><Badge tone={waitTone(mins)}>{mins} min</Badge></td>
                    <td><Badge tone={q.priority === 'normal' ? 'gray' : q.priority === 'urgent' ? 'red' : 'blue'}>{q.priority}</Badge></td>
                    <td><Badge tone={q.status === 'in_progress' ? 'blue' : q.status === 'completed' ? 'green' : q.status === 'cancelled' ? 'red' : 'amber'}>{q.status}</Badge></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {q.status === 'waiting' && <Btn size="xs" kind="secondary" onClick={() => void act(q.id, 'call')}>Call</Btn>}
                      {q.status === 'called' && <Btn size="xs" kind="secondary" onClick={() => void act(q.id, 'start')}>Start</Btn>}
                      {q.status === 'waiting' && <Btn size="xs" kind="ghost" onClick={() => void act(q.id, 'start')}>Start</Btn>}
                      {(q.status === 'waiting' || q.status === 'called') && <Btn size="xs" kind="ghost" onClick={() => void act(q.id, 'hold')}>Hold</Btn>}
                      {q.status === 'hold' && <Btn size="xs" kind="ghost" onClick={() => void act(q.id, 'return')}>Return</Btn>}
                      {['waiting', 'called', 'in_progress', 'hold'].includes(q.status) && <Btn size="xs" kind="ghost" onClick={() => void act(q.id, 'complete')}>Complete</Btn>}
                      {q.status === 'in_progress' && <Btn size="xs" kind="ghost" onClick={() => navigate(`patients/${q.patient_id}`)}>Open patient</Btn>}
                      {!['completed', 'cancelled'].includes(q.status) && <Btn size="xs" kind="ghost" onClick={() => void act(q.id, 'cancel')}>Cancel</Btn>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {addOpen && <QueueAddModal date={date} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void load(); }} />}
    </div>
  );
}

function QueueAddModal({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [patientId, setPatientId] = useState<number | ''>('');
  const [dentistId, setDentistId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!patientId) {
      toast({ kind: 'error', title: 'Patient required' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.queueAdd({ patientId, dentistId: dentistId || null, date, priority });
      toast({ kind: 'success', title: `Added to queue (#${r.queueNo})` });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not add', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add to queue" onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Adding…' : 'Add'}</Btn>
      </>
    }>
      <div className="form-grid">
        <div className="span-2"><Field label="Patient" required><PatientPicker value={patientId} onChange={(id) => setPatientId(id)} /></Field></div>
        <Field label="Dentist"><DentistSelect value={dentistId} onChange={setDentistId} /></Field>
        <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="vip">VIP</option></Select></Field>
      </div>
    </Modal>
  );
}
