// Dentiva Pro — staff records, user accounts, roles & permissions.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Btn, Field, TextInput, TextArea, Select, SearchInput, Tabs, Modal, EmptyState, Loading, Badge } from '../components/ui';
import { formatBdt, parseBdtToPaisa } from '../lib/money';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function StaffPage() {
  const { can } = useApp();
  const [tab, setTab] = useState('staff');
  const tabs = [
    { id: 'staff', label: 'Staff' },
    ...(can('users.manage') ? [{ id: 'users', label: 'Users' }] : []),
    ...(can('roles.manage') ? [{ id: 'roles', label: 'Roles & permissions' }] : []),
  ];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Staff & Users</h1>
          <p className="page-sub">Employee records, login accounts, and role-based permissions.</p>
        </div>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'staff' && <StaffTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
    </div>
  );
}

function StaffTab() {
  const { can, toast, dateFormat, confirm } = useApp();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.staffList(search) as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (s: R) => {
    const ok = await confirm({ title: 'Delete staff record?', body: <p><strong>{s.name}</strong> will be permanently removed.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.staffDelete(s.id);
      toast({ kind: 'success', title: 'Staff deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  const sensitiveHidden = rows.length > 0 && rows[0].salary_paisa === null;

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search staff…" />
        <span style={{ flex: 1 }} />
        {can('staff.manage') && <Btn kind="primary" onClick={() => setModal('new')}>+ New staff</Btn>}
      </div>
      {sensitiveHidden && <div className="alert alert-info">Salary and identity details are hidden for your role.</div>}
      {loading && <Loading />}
      {!loading && rows.length === 0 && <EmptyState title="No staff records" message="Add receptionists, assistants, and other employees." />}
      {!loading && rows.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Joining</th><th style={{ textAlign: 'right' }}>Salary</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong><div className="cell-sub">{s.department || ''} {s.blood_group ? `· ${s.blood_group}` : ''}</div></td>
                <td>{s.role_title || '—'}</td>
                <td>{s.phone || '—'}</td>
                <td>{s.joining_date ? formatDate(s.joining_date, dateFormat) : '—'}</td>
                <td className="num mono">{s.salary_paisa === null ? '—' : formatBdt(s.salary_paisa)}</td>
                <td>{s.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {can('staff.manage') && (
                    <>
                      <Btn size="xs" kind="ghost" onClick={() => setModal(s)}>Edit</Btn>
                      <Btn size="xs" kind="ghost" onClick={() => void remove(s)}>Delete</Btn>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal && <StaffModal staff={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function StaffModal({ staff, onClose, onSaved }: { staff: R | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: staff?.name ?? '', dob: staff?.dob ?? '', gender: staff?.gender ?? '', address: staff?.address ?? '', phone: staff?.phone ?? '',
    emergency_contact: staff?.emergency_contact ?? '', emergency_phone: staff?.emergency_phone ?? '', blood_group: staff?.blood_group ?? '',
    nid_no: staff?.nid_no ?? '', role_title: staff?.role_title ?? '', department: staff?.department ?? '', joiningDate: staff?.joining_date ?? todayISO(),
    salary: staff ? (staff.salary_paisa / 100).toFixed(2) : '', notes: staff?.notes ?? '', active: staff?.active !== 0,
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!(f.name as string).trim()) {
      toast({ kind: 'error', title: 'Name required' });
      return;
    }
    setBusy(true);
    try {
      await api.staffSave({ id: staff?.id, ...(f as R), salaryPaisa: parseBdtToPaisa((f.salary as string) || '0') ?? 0 });
      toast({ kind: 'success', title: staff?.id ? 'Staff updated' : 'Staff created' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={staff?.id ? 'Edit staff' : 'New staff'} onClose={onClose} size="lg" actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Full name" required><TextInput value={f.name as string} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Role / title"><TextInput value={f.role_title as string} onChange={(e) => set('role_title', e.target.value)} placeholder="Receptionist" /></Field>
        <Field label="Date of birth"><TextInput type="date" value={f.dob as string} onChange={(e) => set('dob', e.target.value)} /></Field>
        <Field label="Gender"><Select value={f.gender as string} onChange={(e) => set('gender', e.target.value)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></Select></Field>
        <div className="span-2"><Field label="Address"><TextInput value={f.address as string} onChange={(e) => set('address', e.target.value)} /></Field></div>
        <Field label="Phone"><TextInput value={f.phone as string} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Blood group"><Select value={f.blood_group as string} onChange={(e) => set('blood_group', e.target.value)}><option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((b) => <option key={b}>{b}</option>)}</Select></Field>
        <Field label="Emergency contact"><TextInput value={f.emergency_contact as string} onChange={(e) => set('emergency_contact', e.target.value)} /></Field>
        <Field label="Emergency phone"><TextInput value={f.emergency_phone as string} onChange={(e) => set('emergency_phone', e.target.value)} /></Field>
        <Field label="NID / identity no."><TextInput value={f.nid_no as string} onChange={(e) => set('nid_no', e.target.value)} /></Field>
        <Field label="Department"><TextInput value={f.department as string} onChange={(e) => set('department', e.target.value)} /></Field>
        <Field label="Joining date"><TextInput type="date" value={f.joiningDate as string} onChange={(e) => set('joiningDate', e.target.value)} /></Field>
        <Field label="Salary (৳)"><TextInput value={f.salary as string} onChange={(e) => set('salary', e.target.value)} inputMode="decimal" /></Field>
        <Field label="Status"><Select value={(f.active as boolean) ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">Active</option><option value="0">Inactive</option></Select></Field>
        <div className="span-2"><Field label="Notes"><TextArea value={f.notes as string} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

function UsersTab() {
  const { toast, confirm, session } = useApp();
  const [rows, setRows] = useState<R[]>([]);
  const [roles, setRoles] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([api.usersList(), api.rolesList()]);
      setRows(u as R[]);
      setRoles((r as R).roles as R[]);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (u: R) => {
    const ok = await confirm({ title: 'Delete user?', body: <p>Login account <strong>{u.username}</strong> ({u.full_name}) will be deleted. Past audit history keeps the username.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.usersDelete(u.id);
      toast({ kind: 'success', title: 'User deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <span className="muted small">Each staff member who uses Dentiva Pro needs their own login.</span>
        <span style={{ flex: 1 }} />
        <Btn kind="primary" onClick={() => setModal('new')}>+ New user</Btn>
      </div>
      {loading && <Loading />}
      {!loading && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Full name</th><th>Username</th><th>Role</th><th>Last login</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.full_name}</strong>{session?.id === u.id && <span className="muted small"> (you)</span>}</td>
                <td className="mono">{u.username}</td>
                <td><Badge tone="teal">{u.role_name}</Badge></td>
                <td className="small">{u.last_login_at ? formatDate(u.last_login_at, 'DD MMM YYYY') : 'Never'}</td>
                <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Disabled</Badge>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Btn size="xs" kind="ghost" onClick={() => setModal(u)}>Edit</Btn>
                  {session?.id !== u.id && <Btn size="xs" kind="ghost" onClick={() => void remove(u)}>Delete</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal && <UserModal user={modal === 'new' ? null : modal} roles={roles} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function UserModal({ user, roles, onClose, onSaved }: { user: R | null; roles: R[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [roleId, setRoleId] = useState(user?.role_id ? String(user.role_id) : '');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(user?.active !== 0);

  const save = async () => {
    if (!fullName.trim() || !username.trim() || !roleId) {
      toast({ kind: 'error', title: 'All fields required', message: 'Full name, username, and role are required.' });
      return;
    }
    if (!user?.id && password.length < 8) {
      toast({ kind: 'error', title: 'Password required', message: 'New users need a password of at least 8 characters.' });
      return;
    }
    if (password && password.length < 8) {
      toast({ kind: 'error', title: 'Password too short' });
      return;
    }
    setBusy(true);
    try {
      await api.usersSave({ id: user?.id, fullName: fullName.trim(), username: username.trim(), roleId: Number(roleId), active, ...(password ? { password } : {}) });
      toast({ kind: 'success', title: user?.id ? 'User updated' : 'User created' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={user?.id ? 'Edit user' : 'New user'} onClose={onClose} actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Full name" required><TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Username" required><TextInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder="letters, digits, . _ -" /></Field>
        <Field label="Role" required><Select value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">— Select —</option>{roles.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}</Select></Field>
        <Field label="Status"><Select value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}><option value="1">Active</option><option value="0">Disabled</option></Select></Field>
        <div className="span-2"><Field label={user?.id ? 'New password (leave blank to keep)' : 'Password'} required={!user?.id} hint="Minimum 8 characters"><TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field></div>
      </div>
    </Modal>
  );
}

function RolesTab() {
  const { toast, confirm } = useApp();
  const [roles, setRoles] = useState<R[]>([]);
  const [permissions, setPermissions] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<R | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.rolesList();
      setRoles((r.roles as R[]) ?? []);
      setPermissions((r.permissions as R[]) ?? []);
    } catch (e) {
      toast({ kind: 'error', title: 'Load failed', message: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (r: R) => {
    const ok = await confirm({ title: 'Delete role?', body: <p>Role <strong>{r.name}</strong> will be deleted. Roles assigned to users cannot be deleted.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.rolesDelete(r.id);
      toast({ kind: 'success', title: 'Role deleted' });
      void load();
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', message: friendlyError(e) });
    }
  };

  return (
    <div className="card card-pad">
      <div className="toolbar">
        <span className="muted small">Permissions are enforced in the business layer — not just hidden in the UI.</span>
        <span style={{ flex: 1 }} />
        <Btn kind="primary" onClick={() => setModal('new')}>+ New role</Btn>
      </div>
      {loading && <Loading />}
      {!loading && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Role</th><th>Users</th><th>Permissions</th><th></th></tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong>{r.system_role ? <span className="muted small"> (built-in)</span> : null}<div className="cell-sub">{r.description}</div></td>
                <td>{r.user_count}</td>
                <td className="small">{r.name === 'Owner' ? 'Full access (all)' : `${(r.permissions as string[]).length} permission(s)`}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.name !== 'Owner' && <Btn size="xs" kind="ghost" onClick={() => setModal(r)}>Edit</Btn>}
                  {!r.system_role && <Btn size="xs" kind="ghost" onClick={() => void remove(r)}>Delete</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal && <RoleModal role={modal === 'new' ? null : modal} permissions={permissions} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function RoleModal({ role, permissions, onClose, onSaved }: { role: R | null; permissions: R[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(role?.name ?? '');
  const [desc, setDesc] = useState(role?.description ?? '');
  const [grants, setGrants] = useState<Set<string>>(new Set((role?.permissions as string[]) ?? []));

  const toggle = (code: string) => setGrants((g) => {
    const n = new Set(g);
    if (n.has(code)) n.delete(code);
    else n.add(code);
    return n;
  });

  const modules = [...new Set(permissions.map((p) => p.module))];

  const save = async () => {
    if (!name.trim()) {
      toast({ kind: 'error', title: 'Name required' });
      return;
    }
    setBusy(true);
    try {
      await api.rolesSave({ id: role?.id, name: name.trim(), description: desc, permissions: [...grants] });
      toast({ kind: 'success', title: role?.id ? 'Role updated' : 'Role created' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Save failed', message: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={role?.id ? `Edit role — ${role.name}` : 'New role'} onClose={onClose} size="lg" actions={
      <>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save role'}</Btn>
      </>
    }>
      <div className="form-grid">
        <Field label="Role name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} disabled={!!role?.system_role} /></Field>
        <Field label="Description"><TextInput value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      </div>
      <h4 className="mt-4">Permissions ({grants.size})</h4>
      {modules.map((m) => (
        <div key={m} className="mb-3">
          <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>{m}</div>
          <div className="grid grid-3">
            {permissions.filter((p) => p.module === m).map((p) => (
              <label key={p.code} className="check-row" title={p.code}>
                <input type="checkbox" checked={grants.has(p.code)} onChange={() => toggle(p.code)} /> {p.name}
              </label>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
