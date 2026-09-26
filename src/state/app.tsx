// Dentiva Pro — global app state: session, settings, toasts, confirmations.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { api, type AppStatus, type SessionInfo } from '../api';
import { hasPermission } from '../lib/permissions';
import type { DateFormat, TimeFormat } from '../lib/format';

// ------------------------------------------------------------------ toasts
export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

interface ConfirmOptions {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
}

interface AppContextValue {
  status: AppStatus | null;
  session: SessionInfo | null;
  settings: Record<string, string>;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  loading: boolean;
  can: (code: string) => boolean;
  refresh: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  toast: (t: Omit<Toast, 'id'>) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  route: string;
  navigate: (r: string) => void;
  routeParam: string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

let toastId = 1;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [route, setRoute] = useState<string>(() => window.location.hash.replace(/^#\/?/, '') || 'dashboard');
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const idleTimer = useRef<number | null>(null);
  const lastActive = useRef<number>(Date.now());

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      if (s.setupComplete) {
        try {
          const st = await api.settingsGet();
          setSettings(st);
        } catch {
          /* settings load only after login-gated? settings_get is open; keep quiet */
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api.settingsGet());
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onHash = () => setRoute(window.location.hash.replace(/^#\/?/, '') || 'dashboard');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [refresh]);

  const navigate = useCallback((r: string) => {
    window.location.hash = `#/${r}`;
    setRoute(r);
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = toastId++;
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.kind === 'error' ? 7000 : 4500);
  }, []);

  const confirm = useCallback((o: ConfirmOptions) => {
    setConfirmText('');
    return new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve }));
  }, []);

  const session = status?.session ?? null;
  const can = useCallback(
    (code: string) => (session ? hasPermission(session.permissions, code) : false),
    [session],
  );

  // Auto-lock on inactivity (also enforced by backend lock state).
  useEffect(() => {
    if (!session || status?.locked) return;
    const mins = parseInt(settings.auto_lock_minutes ?? status?.autoLockMinutes ?? '15', 10);
    if (!mins || mins <= 0) return;
    const bump = () => { lastActive.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    idleTimer.current = window.setInterval(async () => {
      if (Date.now() - lastActive.current > mins * 60 * 1000) {
        try {
          await api.lock();
        } catch {
          /* noop */
        }
        await refresh();
      }
    }, 15000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      if (idleTimer.current) window.clearInterval(idleTimer.current);
    };
  }, [session, status?.locked, status?.autoLockMinutes, settings.auto_lock_minutes, refresh]);

  const [routeBase, routeParam] = useMemo(() => {
    const parts = route.split('/');
    return [parts[0] || 'dashboard', parts.slice(1).join('/')];
  }, [route]);

  const value: AppContextValue = {
    status,
    session,
    settings,
    dateFormat: (settings.date_format as DateFormat) || 'DD MMM YYYY',
    timeFormat: (settings.time_format as TimeFormat) || '12h',
    loading,
    can,
    refresh,
    refreshSettings,
    toast,
    confirm,
    route: routeBase,
    navigate,
    routeParam,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-msg">{t.message}</div>}
          </div>
        ))}
      </div>
      {confirmState && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { confirmState.resolve(false); setConfirmState(null); } }}>
          <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label={confirmState.title}>
            <div className="modal-title">{confirmState.title}</div>
            <div className="modal-body">{confirmState.body}</div>
            {confirmState.requireText && (
              <div className="modal-body">
                <label className="field">
                  <span className="field-label">Type <strong>{confirmState.requireText}</strong> to confirm</span>
                  <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
                </label>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>Cancel</button>
              <button
                className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`}
                disabled={!!confirmState.requireText && confirmText !== confirmState.requireText}
                onClick={() => { confirmState.resolve(true); setConfirmState(null); }}
              >
                {confirmState.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}
