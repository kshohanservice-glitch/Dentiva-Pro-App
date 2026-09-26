// Dentiva Pro — application shell: sidebar, header, search palette, notifications.

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useApp } from '../state/app';
import { api } from '../api';
import { Icons } from './icons';
import { formatDate, todayISO } from '../lib/format';
import { friendlyError } from '../lib/ipc';

interface NavEntry {
  route: string;
  label: string;
  icon: React.ReactNode;
  perm?: string;
}

const NAV: Array<{ section: string; items: NavEntry[] }> = [
  {
    section: 'Practice',
    items: [
      { route: 'dashboard', label: 'Dashboard', icon: Icons.dashboard },
      { route: 'patients', label: 'Patients', icon: Icons.patients, perm: 'patients.view' },
      { route: 'appointments', label: 'Appointments', icon: Icons.calendar, perm: 'appointments.view' },
      { route: 'queue', label: 'Queue', icon: Icons.queue, perm: 'queue.manage' },
    ],
  },
  {
    section: 'Clinical',
    items: [
      { route: 'treatments', label: 'Treatments', icon: Icons.treatments, perm: 'clinical.view' },
      { route: 'prescriptions', label: 'Prescriptions', icon: Icons.rx, perm: 'clinical.view' },
    ],
  },
  {
    section: 'Billing',
    items: [
      { route: 'invoices', label: 'Invoice', icon: Icons.invoice, perm: 'invoices.view' },
      { route: 'payments', label: 'Payments', icon: Icons.payments, perm: 'payments.view' },
      { route: 'inventory', label: 'Inventory', icon: Icons.inventory, perm: 'inventory.view' },
      { route: 'accounting', label: 'Accounting', icon: Icons.accounting, perm: 'accounting.view' },
    ],
  },
  {
    section: 'Administration',
    items: [
      { route: 'staff', label: 'Staff & Users', icon: Icons.staff, perm: 'staff.view' },
      { route: 'reports', label: 'Reports', icon: Icons.reports, perm: 'reports.view' },
      { route: 'audit', label: 'Audit Log', icon: Icons.audit, perm: 'audit.view' },
      { route: 'backup', label: 'Backup & Restore', icon: Icons.backup, perm: 'backup.run' },
      { route: 'settings', label: 'Settings', icon: Icons.settings },
      { route: 'about', label: 'About', icon: Icons.about },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { route, navigate, session, can, status, toast, refresh, dateFormat } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [clinicName, setClinicName] = useState('Dentiva Pro');
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<Array<Record<string, unknown>>>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.clinicGet().then((c) => setClinicName(String((c as Record<string, unknown>).name ?? 'Dentiva Pro'))).catch(() => {});
    api.notifications(true).then((n) => { setUnread(n.unread); setNotifs(n.rows as Array<Record<string, unknown>>); }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      api.notifications(true).then((n) => { setUnread(n.unread); if (notifOpen) setNotifs(n.rows as Array<Record<string, unknown>>); }).catch(() => {});
    }, 60000);
    return () => window.clearInterval(t);
  }, [notifOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const doLock = useCallback(async () => {
    try {
      await api.lock();
      await refresh();
    } catch (e) {
      toast({ kind: 'error', title: 'Lock failed', message: friendlyError(e) });
    }
  }, [refresh, toast]);

  const doLogout = useCallback(async () => {
    try {
      await api.logout();
      await refresh();
      navigate('dashboard');
    } catch (e) {
      toast({ kind: 'error', title: 'Logout failed', message: friendlyError(e) });
    }
  }, [refresh, navigate, toast]);

  const openNotifs = async () => {
    setNotifOpen(!notifOpen);
    setUserOpen(false);
    if (!notifOpen) {
      try {
        const n = await api.notifications(false);
        setNotifs(n.rows as Array<Record<string, unknown>>);
        setUnread(n.unread);
      } catch {
        /* noop */
      }
    }
  };

  const markAll = async () => {
    await api.notificationsMark(undefined, true);
    const n = await api.notifications(false);
    setNotifs(n.rows as Array<Record<string, unknown>>);
    setUnread(n.unread);
  };

  const openNotif = async (n: Record<string, unknown>) => {
    await api.notificationsMark(Number(n.id));
    setUnread((u) => Math.max(0, u - 1));
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    if (n.action_route) {
      navigate(String(n.action_route));
      setNotifOpen(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-mark">{Icons.tooth}</div>
          <div className="brand-text">
            <div className="brand-name">Dentiva Pro</div>
            <div className="brand-sub">Dental Clinic</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {NAV.map((sec) => {
            const items = sec.items.filter((i) => !i.perm || can(i.perm) || (session?.roleName === 'Owner'));
            if (items.length === 0) return null;
            return (
              <div key={sec.section}>
                <div className="nav-section">{sec.section}</div>
                {items.map((i) => (
                  <button
                    key={i.route}
                    className={`nav-item${route === i.route ? ' active' : ''}`}
                    onClick={() => navigate(i.route)}
                    title={collapsed ? i.label : undefined}
                  >
                    <span className="nav-icon">{i.icon}</span>
                    <span className="nav-label">{i.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <span className="nav-icon">{collapsed ? Icons.expand : Icons.collapse}</span>
            <span className="nav-label">{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div>
            <div className="topbar-clinic">{clinicName}</div>
            <div className="topbar-date">{formatDate(todayISO(), dateFormat)} · v{status?.version ?? '1.0.0'}</div>
          </div>
          <div className="topbar-spacer" />
          <button className="icon-btn" onClick={() => setPaletteOpen(true)} title="Global search (Ctrl+K)" aria-label="Global search">
            {Icons.search}
          </button>
          <div style={{ position: 'relative' }} ref={notifRef}>
            <button className="icon-btn" onClick={openNotifs} title="Notifications" aria-label="Notifications">
              {Icons.bell}
              {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
            </button>
            {notifOpen && (
              <div className="menu" style={{ right: 0, top: 44, width: 360, maxHeight: 440, overflowY: 'auto' }}>
                <div className="flex justify-between items-center" style={{ padding: '6px 10px' }}>
                  <strong>Notifications</strong>
                  <button className="btn btn-xs btn-ghost" onClick={markAll}>Mark all read</button>
                </div>
                <div className="menu-sep" />
                {notifs.length === 0 && <div className="muted small" style={{ padding: 12 }}>No notifications.</div>}
                {notifs.slice(0, 30).map((n) => (
                  <button key={String(n.id)} className="menu-item" onClick={() => void openNotif(n)} style={{ fontWeight: n.is_read ? 400 : 700 }}>
                    <span>
                      <span style={{ display: 'block', fontSize: 13 }}>{String(n.title)}</span>
                      <span className="muted small" style={{ display: 'block', fontWeight: 400 }}>{String(n.message ?? '').slice(0, 90)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={() => void doLock()} title="Lock application" aria-label="Lock">
            {Icons.lock}
          </button>
          <div style={{ position: 'relative' }} ref={userRef}>
            <button
              className="user-chip"
              onClick={() => { setUserOpen(!userOpen); setNotifOpen(false); }}
              aria-label="User menu"
            >
              <span className="avatar">{(session?.fullName ?? '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span className="uinfo">
                <span className="uname">{session?.fullName ?? ''}</span>
                <br />
                <span className="urole">{session?.roleName ?? ''}</span>
              </span>
            </button>
            {userOpen && (
              <div className="menu" style={{ right: 0, top: 48 }}>
                <button className="menu-item" onClick={() => { setUserOpen(false); navigate('settings/profile'); }}>{Icons.staff} My profile & password</button>
                <button className="menu-item" onClick={() => { setUserOpen(false); void doLock(); }}>{Icons.lock} Lock now</button>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { setUserOpen(false); void doLogout(); }}>{Icons.logout} Log out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      {paletteOpen && <SearchPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const { navigate } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [active, setActive] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      if (e.key === 'Enter' && results[active]) {
        navigate(String(results[active].route));
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, navigate, results, active]);

  const onType = (v: string) => {
    setQ(v);
    setActive(0);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      if (v.trim().length < 2) { setResults([]); return; }
      try {
        setResults((await api.search(v.trim())) as Array<Record<string, unknown>>);
      } catch {
        setResults([]);
      }
    }, 220);
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="Global search">
        <input
          className="palette-input"
          autoFocus
          placeholder="Search patients, invoices, appointments, inventory… (min 2 chars)"
          value={q}
          onChange={(e) => onType(e.target.value)}
        />
        <div className="palette-list">
          {results.length === 0 && <div className="muted small" style={{ padding: 14 }}>Results respect your permissions. Type to search.</div>}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}-${i}`}
              className={`palette-item${i === active ? ' active' : ''}`}
              onClick={() => { navigate(String(r.route)); onClose(); }}
            >
              <span className="badge badge-teal">{String(r.kind)}</span>
              <span>
                <span style={{ display: 'block', fontWeight: 600 }}>{String(r.title)}</span>
                {!!r.subtitle && <span className="muted small">{String(r.subtitle)}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
