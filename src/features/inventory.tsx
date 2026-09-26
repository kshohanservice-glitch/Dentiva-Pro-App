// Dentiva Pro — inventory: items, batches, stock moves, suppliers, alerts.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, TextArea, Select, SearchInput, Tabs, Modal, EmptyState, Loading, Badge } from '../components/ui';
import { formatBdt, parseBdtToPaisa } from '../lib/money';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function InventoryPage() {
  const { can, toast, dateFormat } = useApp();
  const [tab, setTab] = useState('items');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [expOnly, setExpOnly] = useState(false);
  const [rows, setRows] = useState<R[]>([]);
  const [alerts, setAlerts] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [itemModal, setItemModal] = useState<R | 'new' | null>(null);
  const [detail, setDetail] = useState<R | null>(null);
  const [move, setMove] = useState<{ kind: 'receive' | 'issue' | 'adjust'; item: R } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, al] = await Promise.all([
        api.inventoryList({ search: search || undefined, lowStockOnly: lowOnly || undefined, expiringOnly: expOnly || undefined }),
        api.inventoryAlerts().catch(() => null),
      ]);
      setRows(items as R[]);
      setAlerts(al as R);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [search, lowOnly, expOnly, toast]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: number) => {
    try {
      setDetail(await api.inventoryGet(id) as R);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-sub">Batch-tracked stock with expiry and reorder alerts.</p>
        </div>
        <div className="page-actions">
          {can('inventory.manage') && <Btn kind="primary" onClick={() => setItemModal('new')}>+ New item</Btn>}
        </div>
      </div>

      {alerts && (
        <div className="grid grid-4 mb-3">
          <div className="stat-card"><div className="stat-label">Out of stock</div><div className="stat-value" style={{ color: 'var(--dp-danger)' }}>{alerts.counts.out}</div></div>
          <div className="stat-card"><div className="stat-label">Low stock</div><div className="stat-value" style={{ color: 'var(--dp-warning)' }}>{alerts.counts.low}</div></div>
          <div className="stat-card"><div className="stat-label">Expiring ≤ 90 days</div><div className="stat-value" style={{ color: 'var(--dp-warning)' }}>{alerts.counts.expiring}</div></div>
          <div className="stat-card"><div className="stat-label">Expired</div><div className="stat-value" style={{ color: 'var(--dp-danger)' }}>{alerts.counts.expired}</div></div>
        </div>
      )}

      <Tabs tabs={[{ id: 'items', label: 'Items' }, { id: 'suppliers', label: 'Suppliers' }]} active={tab} onChange={setTab} />

      {tab === 'items' && (
        <div className="card card-pad">
          <div className="toolbar">
            <SearchInput value={search} onChange={setSearch} placeholder="Search item / SKU…" />
            <label className="check-row"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
            <label className="check-row"><input type="checkbox" checked={expOnly} onChange={(e) => setExpOnly(e.target.checked)} /> Expiring only</label>
          </div>
          {loading && <Loading />}
          {!loading && rows.length === 0 && <EmptyState title="No items" message="Add dental supplies, medicines, and consumables." action={can('inventory.manage') ? <Btn kind="primary" onClick={() => setItemModal('new')}>+ New item</Btn> : undefined} />}
          {!loading && rows.length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Item</th><th>SKU</th><th>Category</th><th style={{ textAlign: 'right' }}>Stock</th><th>Reorder</th><th>Nearest expiry</th><th></th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td><span className="rowlink" onClick={() => void openDetail(i.id)}><strong>{i.name}</strong></span><div className="cell-sub">{i.supplier_name || ''} · {i.unit}</div></td>
                    <td className="mono">{i.sku}</td>
                    <td>{i.category}</td>
                    <td className="num"><Badge tone={i.stock <= 0 ? 'red' : i.stock <= i.reorder_level ? 'amber' : 'green'}>{i.stock} {i.unit}</Badge></td>
                    <td className="num mono">{i.reorder_level}</td>
                    <td>{i.nearest_expiry ? formatDate(i.nearest_expiry, dateFormat) : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Btn size="xs" kind="ghost" onClick={() => void openDetail(i.id)}>Open</Btn>
                      {can('inventory.manage') && (
                        <>
                          <Btn size="xs" kind="ghost" onClick={() => setMove({ kind: 'receive', item: i })}>Receive</Btn>
                          <Btn size="xs" kind="ghost" onClick={() => setMove({ kind: 'issue', item: i })}>Issue</Btn>
                          <Btn size="xs" kind="ghost" onClick={() => setMove({ kind: 'adjust', item: i })}>Adjust</Btn>
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

      {tab === 'suppliers' && <SuppliersTab />}

      {itemModal && <ItemModal item={itemModal === 'new' ? null : itemModal} onClose={() => setItemModal(null)} onSaved={() => { setItemModal(null); void load(); }} />}
      {move && <StockMoveModal kind={move.kind} item={move.item} onClose={() => setMove(null)} onSaved={() => { setMove(null); void load(); setDetail(null); }} />}
      {detail && <ItemDetailModal item={detail} onClose={() => setDetail(null)} onMove={(kind) => setMove({ kind, item: detail })} onEdit={() => { setItemModal(detail); setDetail(null); }} />}
    </div>
  );
}

function SuppliersTab() {
  const { can, toast } = useApp();
  const [rows, setRows] = useState<R[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.suppliersList(search) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    }
  }, [search, toast]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search suppliers…" />
        <span style={{ flex: 1 }} />
        {can('inventory.manage') && <Btn kind="primary" onClick={() => setModal('new')}>+ New supplier</Btn>}
      </div>
      {rows.length === 0 && <EmptyState title="No suppliers" message="Track where each stock batch came from." />}
      {rows.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong></td>
                <td>{s.phone || '—'}</td>
                <td>{s.email || '—'}</td>
                <td>{s.address || '—'}</td>
                <td>{s.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                <td>{can('inventory.manage') && <Btn size="xs" kind="ghost" onClick={() => setModal(s)}>Edit</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal && <SupplierModal supplier={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function SupplierModal({ supplier, onClose, onSaved }: { supplier: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: supplier?.name ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', address: supplier?.address ?? '', notes: supplier?.notes ?? '', active: supplier?.active !== 0 });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) {
      toast({ kind: 'error', title: 'Name required' });
      return;
    }
    setBusy(true);
    try {
      await api.suppliersSave({ id: supplier?.id, ...f });
      toast({ kind: 'success', title: 'Supplier saved' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={supplier?.id ? 'Edit supplier' : 'New supplier'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <div className="span-2"><Field label="Name" required><TextInput value={f.name as string} onChange={(e) => set('name', e.target.value)} /></Field></div>
        <Field label="Phone"><TextInput value={f.phone as string} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><TextInput value={f.email as string} onChange={(e) => set('email', e.target.value)} /></Field>
        <div className="span-2"><Field label="Address"><TextInput value={f.address as string} onChange={(e) => set('address', e.target.value)} /></Field></div>
        <Field label="Notes"><TextInput value={f.notes as string} onChange={(e) => set('notes', e.target.value)} /></Field>
        <Field label="Status"><Select value={(f.active as boolean) ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">Active</option><option value="0">Inactive</option></Select></Field>
      </div>
    </Modal>
  );
}

function ItemModal({ item, onClose, onSaved }: { item: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [suppliers, setSuppliers] = useState<R[]>([]);
  const [f, setF] = useState({
    sku: item?.sku ?? '', name: item?.name ?? '', category: item?.category ?? 'General', supplierId: item?.supplier_id ? String(item.supplier_id) : '',
    unit: item?.unit ?? 'pcs', purchasePrice: item ? (item.purchase_price_paisa / 100).toFixed(2) : '',
    internalValue: item ? (item.internal_value_paisa / 100).toFixed(2) : '', reorderLevel: String(item?.reorder_level ?? '0'),
    expiryManaged: !!item?.expiry_managed, notes: item?.notes ?? '', active: item?.active !== 0,
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    api.suppliersList('').then((s) => setSuppliers(s as R[])).catch(() => {});
  }, []);

  const save = async () => {
    if (!f.name.trim() || !f.sku.trim()) {
      toast({ kind: 'error', title: 'SKU and name required' });
      return;
    }
    setBusy(true);
    try {
      await api.inventorySave({
        id: item?.id, sku: (f.sku as string).trim(), name: (f.name as string).trim(), category: f.category, supplierId: f.supplierId || null,
        unit: f.unit, purchasePricePaisa: parseBdtToPaisa((f.purchasePrice as string) || '0') ?? 0,
        internalValuePaisa: parseBdtToPaisa((f.internalValue as string) || '0') ?? 0,
        reorderLevel: parseInt(f.reorderLevel as string, 10) || 0, expiryManaged: f.expiryManaged, notes: f.notes, active: f.active,
      });
      toast({ kind: 'success', title: item?.id ? 'Item updated' : 'Item created' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={item?.id ? 'Edit item' : 'New item'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="SKU / code" required><TextInput value={f.sku as string} onChange={(e) => set('sku', e.target.value)} /></Field>
        <Field label="Item name" required><TextInput value={f.name as string} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category"><TextInput value={f.category as string} onChange={(e) => set('category', e.target.value)} /></Field>
        <Field label="Unit"><Select value={f.unit as string} onChange={(e) => set('unit', e.target.value)}>{['pcs', 'box', 'bottle', 'tube', 'pack', 'vial', 'strip', 'kg', 'litre', 'set'].map((u) => <option key={u}>{u}</option>)}</Select></Field>
        <Field label="Supplier"><Select value={f.supplierId as string} onChange={(e) => set('supplierId', e.target.value)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</Select></Field>
        <Field label="Reorder level"><TextInput type="number" min={0} value={f.reorderLevel as string} onChange={(e) => set('reorderLevel', e.target.value)} /></Field>
        <Field label="Purchase price (৳)"><TextInput value={f.purchasePrice as string} onChange={(e) => set('purchasePrice', e.target.value)} inputMode="decimal" /></Field>
        <Field label="Internal value (৳)"><TextInput value={f.internalValue as string} onChange={(e) => set('internalValue', e.target.value)} inputMode="decimal" /></Field>
        <Field label="Status"><Select value={(f.active as boolean) ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">Active</option><option value="0">Inactive</option></Select></Field>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}><label className="check-row"><input type="checkbox" checked={f.expiryManaged as boolean} onChange={(e) => set('expiryManaged', e.target.checked)} /> Track expiry</label></div>
        <div className="span-2"><Field label="Notes"><TextArea value={f.notes as string} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

function StockMoveModal({ kind, item, onClose, onSaved }: { kind: 'receive' | 'issue' | 'adjust'; item: R; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [suppliers, setSuppliers] = useState<R[]>([]);
  const [qty, setQty] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [price, setPrice] = useState('');
  const [supplierId, setSupplierId] = useState(item.supplier_id ? String(item.supplier_id) : '');
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [reason, setReason] = useState('');

  useEffect(() => {
    api.suppliersList('').then((s) => setSuppliers(s as R[])).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      if (kind === 'receive') {
        await api.stockReceive({ itemId: item.id, qty: parseInt(qty, 10), batchNo, expiryDate: expiry || null, purchasePricePaisa: parseBdtToPaisa(price || '0') ?? 0, supplierId: supplierId || null, purchaseDate, note: reason });
      } else if (kind === 'issue') {
        if (!reason.trim()) throw new Error('A reason is required for stock issue.');
        await api.stockIssue({ itemId: item.id, qty: parseInt(qty, 10), reason: reason.trim() });
      } else {
        if (!reason.trim()) throw new Error('A reason is required for stock adjustment.');
        await api.stockAdjust({ itemId: item.id, qtyAfter: parseInt(qty, 10), reason: reason.trim() });
      }
      toast({ kind: 'success', title: kind === 'receive' ? 'Stock received' : kind === 'issue' ? 'Stock issued' : 'Stock adjusted' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Operation failed', message: e instanceof Error ? e.message : friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const titles = { receive: `Receive stock — ${item.name}`, issue: `Issue stock — ${item.name}`, adjust: `Adjust stock — ${item.name}` };

  return (
    <Modal title={titles[kind]} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm'}</Btn>
      </>
    }>
      <p className="small muted">Current stock: <strong>{item.stock ?? '?'} {item.unit}</strong></p>
      <div className="form-grid">
        <Field label={kind === 'adjust' ? 'New quantity on hand' : 'Quantity'} required><TextInput type="number" min={kind === 'adjust' ? 0 : 1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        {kind === 'receive' && (
          <>
            <Field label="Batch no."><TextInput value={batchNo} onChange={(e) => setBatchNo(e.target.value)} /></Field>
            <Field label="Expiry date"><TextInput type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
            <Field label="Purchase price / unit (৳)"><TextInput value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</Select></Field>
            <Field label="Purchase date"><TextInput type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
          </>
        )}
        <div className="span-2"><Field label={kind === 'receive' ? 'Note' : 'Reason'} required={kind !== 'receive'}><TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'issue' ? 'e.g. Used in treatment' : kind === 'adjust' ? 'e.g. Physical count correction' : 'Optional note'} /></Field></div>
      </div>
    </Modal>
  );
}

function ItemDetailModal({ item, onClose, onMove, onEdit }: { item: R; onClose: () => void; onMove: (k: 'receive' | 'issue' | 'adjust') => void; onEdit: () => void }) {
  const { can, dateFormat } = useApp();
  return (
    <Modal title={`${item.name} (${item.sku})`} onClose={onClose} size="lg" actions={
      <>
        {can('inventory.manage') && (
          <>
            <Btn kind="ghost" onClick={onEdit}>Edit item</Btn>
            <Btn kind="secondary" onClick={() => onMove('receive')}>Receive</Btn>
            <Btn kind="secondary" onClick={() => onMove('issue')}>Issue</Btn>
            <Btn kind="secondary" onClick={() => onMove('adjust')}>Adjust</Btn>
          </>
        )}
        <Btn kind="primary" onClick={onClose}>Close</Btn>
      </>
    }>
      <div className="grid grid-3 mb-3">
        <div className="stat-card"><div className="stat-label">On hand</div><div className="stat-value">{item.stock} {item.unit}</div></div>
        <div className="stat-card"><div className="stat-label">Reorder level</div><div className="stat-value">{item.reorder_level}</div></div>
        <div className="stat-card"><div className="stat-label">Purchase price</div><div className="stat-value">{formatBdt(item.purchase_price_paisa)}</div></div>
      </div>
      <h4>Batches</h4>
      {(item.batches as R[]).length === 0 && <p className="muted small">No batches.</p>}
      {(item.batches as R[]).length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Batch</th><th>Expiry</th><th style={{ textAlign: 'right' }}>Received</th><th style={{ textAlign: 'right' }}>Remaining</th><th>Supplier</th></tr></thead>
          <tbody>
            {(item.batches as R[]).map((b) => (
              <tr key={b.id}>
                <td>{b.batch_no || '—'}</td>
                <td>{b.expiry_date ? formatDate(b.expiry_date, dateFormat) : '—'}</td>
                <td className="num mono">{b.qty_received}</td>
                <td className="num mono"><strong>{b.qty_remaining}</strong></td>
                <td>{b.supplier_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <h4 className="mt-4">Movement history</h4>
      {(item.transactions as R[]).length === 0 && <p className="muted small">No movements.</p>}
      {(item.transactions as R[]).length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>When</th><th>Type</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Balance</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>
            {(item.transactions as R[]).map((t) => (
              <tr key={t.id}>
                <td className="small">{formatDate(t.created_at, dateFormat)}</td>
                <td><Badge tone={t.kind === 'receive' ? 'green' : t.kind === 'issue' ? 'amber' : 'blue'}>{t.kind}</Badge></td>
                <td className="num mono">{t.qty_delta > 0 ? `+${t.qty_delta}` : t.qty_delta}</td>
                <td className="num mono">{t.balance_after}</td>
                <td className="small">{t.reason || '—'}</td>
                <td className="small">{t.performed_by_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {void TextArea}
    </Modal>
  );
}
