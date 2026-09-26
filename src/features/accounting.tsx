// Dentiva Pro — accounting: income, expenses, categories, summary.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, Select, Tabs, Modal, EmptyState, Loading, DateRangeBar } from '../components/ui';
import { PAY_METHODS } from './_modals';
import { formatBdt, parseBdtToPaisa } from '../lib/money';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function AccountingPage() {
  const { can, toast, dateFormat, confirm } = useApp();
  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [summary, setSummary] = useState<R | null>(null);
  const [expenses, setExpenses] = useState<R[]>([]);
  const [incomes, setIncomes] = useState<R[]>([]);
  const [categories, setCategories] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryModal, setEntryModal] = useState<{ kind: 'expense' | 'income'; row?: R } | null>(null);
  const [catModal, setCatModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e, i, c] = await Promise.all([
        api.accountingSummary(from, to),
        api.expensesList({ from, to }),
        api.incomesList({ from, to }),
        api.categoriesList(),
      ]);
      setSummary(s as R);
      setExpenses(e as R[]);
      setIncomes(i as R[]);
      setCategories(c as R[]);
    } catch (err) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(err) });
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => { void load(); }, [load]);

  const delEntry = async (kind: 'expense' | 'income', row: R) => {
    const ok = await confirm({ title: `Delete ${kind}?`, body: <p>{formatBdt(row.amount_paisa)} — {row.category_name || 'Uncategorized'} will be deleted.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      if (kind === 'expense') await api.expensesSave({ id: row.id, delete: true });
      else await api.incomesSave({ id: row.id, delete: true });
      toast({ kind: 'success', title: 'Deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Accounting</h1>
          <p className="page-sub">Clinic income and expenses beyond patient billing.</p>
        </div>
        <div className="page-actions">
          {can('accounting.manage') && (
            <>
              <Btn kind="secondary" onClick={() => setEntryModal({ kind: 'income' })}>+ Income</Btn>
              <Btn kind="primary" onClick={() => setEntryModal({ kind: 'expense' })}>+ Expense</Btn>
            </>
          )}
        </div>
      </div>

      <DateRangeBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />

      {summary && (
        <div className="grid grid-4 mb-3">
          <div className="stat-card"><div className="stat-label">Other income</div><div className="stat-value">{formatBdt(summary.income)}</div></div>
          <div className="stat-card"><div className="stat-label">Expenses</div><div className="stat-value">{formatBdt(summary.expense)}</div></div>
          <div className="stat-card"><div className="stat-label">Net</div><div className="stat-value" style={{ color: summary.net >= 0 ? 'var(--dp-success)' : 'var(--dp-danger)' }}>{formatBdt(summary.net)}</div></div>
          <div className="stat-card"><div className="stat-label">Receivables</div><div className="stat-value">{formatBdt(summary.receivables)}</div><div className="stat-foot">Open invoice dues</div></div>
        </div>
      )}

      <Tabs tabs={[{ id: 'overview', label: 'Breakdown' }, { id: 'expenses', label: `Expenses (${expenses.length})` }, { id: 'income', label: `Income (${incomes.length})` }, { id: 'categories', label: 'Categories' }]} active={tab} onChange={setTab} />

      {loading && <Loading />}

      {!loading && tab === 'overview' && summary && (
        <div className="grid grid-2">
          <div className="card card-pad">
            <h3 className="card-title">By category</h3>
            {(summary.byCategory as R[]).length === 0 && <p className="muted small">No entries in this period.</p>}
            {(summary.byCategory as R[]).map((c, i) => (
              <div key={i} className="flex justify-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
                <span>{c.name || 'Uncategorized'} <span className="muted small">({c.kind})</span></span>
                <strong className="mono">{formatBdt(c.total)}</strong>
              </div>
            ))}
          </div>
          <div className="card card-pad">
            <h3 className="card-title">By payment method</h3>
            {(summary.byMethod as R[]).length === 0 && <p className="muted small">No entries in this period.</p>}
            {(summary.byMethod as R[]).map((c, i) => (
              <div key={i} className="flex justify-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--dp-surface-3)' }}>
                <span>{c.method} <span className="muted small">({c.kind})</span></span>
                <strong className="mono">{formatBdt(c.total)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && (tab === 'expenses' || tab === 'income') && (
        <div className="card card-pad">
          {(tab === 'expenses' ? expenses : incomes).length === 0 && <EmptyState title={`No ${tab} yet`} message={`Record ${tab === 'expenses' ? 'rent, salaries, supplies' : 'non-clinical income'} here.`} />}
          {(tab === 'expenses' ? expenses : incomes).length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th><th>Method</th><th>Note</th><th>By</th><th></th></tr></thead>
              <tbody>
                {(tab === 'expenses' ? expenses : incomes).map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(tab === 'expenses' ? r.expense_date : r.income_date, dateFormat)}</td>
                    <td>{r.category_name || '—'}</td>
                    <td className="num mono"><strong>{formatBdt(r.amount_paisa)}</strong></td>
                    <td>{r.method}</td>
                    <td className="small">{r.note || '—'}</td>
                    <td className="small">{r.created_by_name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {can('accounting.manage') && (
                        <>
                          <Btn size="xs" kind="ghost" onClick={() => setEntryModal({ kind: tab as 'expense' | 'income', row: r })}>Edit</Btn>
                          <Btn size="xs" kind="ghost" onClick={() => void delEntry(tab as 'expense' | 'income', r)}>Delete</Btn>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {!loading && tab === 'categories' && (
        <div className="card card-pad">
          <div className="toolbar">
            <span style={{ flex: 1 }} />
            {can('accounting.manage') && <Btn kind="primary" onClick={() => setCatModal('new')}>+ New category</Btn>}
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Type</th><th>Name</th><th>Description</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.kind}</td>
                  <td><strong>{c.name}</strong></td>
                  <td className="small">{c.description || '—'}</td>
                  <td>{c.active ? 'Active' : 'Inactive'}</td>
                  <td>{can('accounting.manage') && <Btn size="xs" kind="ghost" onClick={() => setCatModal(c)}>Edit</Btn>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {entryModal && <EntryModal kind={entryModal.kind} row={entryModal.row} categories={categories} onClose={() => setEntryModal(null)} onSaved={() => { setEntryModal(null); void load(); }} />}
      {catModal && <CategoryModal category={catModal === 'new' ? null : catModal} onClose={() => setCatModal(null)} onSaved={() => { setCatModal(null); void load(); }} />}
    </div>
  );
}

function EntryModal({ kind, row, categories, onClose, onSaved }: { kind: 'expense' | 'income'; row?: R; categories: R[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    categoryId: row?.category_id ? String(row.category_id) : '',
    amount: row ? (row.amount_paisa / 100).toFixed(2) : '',
    date: row ? (kind === 'expense' ? row.expense_date : row.income_date) : todayISO(),
    method: row?.method ?? 'Cash',
    reference: row?.reference ?? '',
    note: row?.note ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    const paisa = parseBdtToPaisa(f.amount);
    if (paisa === null || paisa <= 0) {
      toast({ kind: 'error', title: 'Invalid amount' });
      return;
    }
    setBusy(true);
    try {
      const payload = { id: row?.id, categoryId: f.categoryId || null, amountPaisa: paisa, date: f.date, method: f.method, reference: f.reference, note: f.note };
      if (kind === 'expense') await api.expensesSave(payload);
      else await api.incomesSave(payload);
      toast({ kind: 'success', title: `${kind === 'expense' ? 'Expense' : 'Income'} saved` });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={row?.id ? `Edit ${kind}` : `New ${kind}`} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Category"><Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">— Uncategorized —</option>
          {categories.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </Select></Field>
        <Field label="Amount (৳)" required><TextInput value={f.amount} onChange={(e) => set('amount', e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus /></Field>
        <Field label="Date"><TextInput type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Method"><Select value={f.method} onChange={(e) => set('method', e.target.value)}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Reference"><TextInput value={f.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
        <Field label="Note"><TextInput value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CategoryModal({ category, onClose, onSaved }: { category: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(category?.kind ?? 'expense');
  const [name, setName] = useState(category?.name ?? '');
  const [desc, setDesc] = useState(category?.description ?? '');
  const [active, setActive] = useState(category?.active !== 0);

  const save = async () => {
    if (!name.trim()) {
      toast({ kind: 'error', title: 'Name required' });
      return;
    }
    setBusy(true);
    try {
      await api.categoriesSave({ id: category?.id, kind, name: name.trim(), description: desc, active });
      toast({ kind: 'success', title: 'Category saved' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={category?.id ? 'Edit category' : 'New category'} onClose={onClose} size="sm" actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></Select></Field>
        <Field label="Status"><Select value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}><option value="1">Active</option><option value="0">Inactive</option></Select></Field>
        <div className="span-2"><Field label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <div className="span-2"><Field label="Description"><TextInput value={desc} onChange={(e) => setDesc(e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}
