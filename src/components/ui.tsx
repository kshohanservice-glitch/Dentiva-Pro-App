// Dentiva Pro — shared UI primitives (buttons, fields, tables, modals, states).

import { useEffect, useRef, useState } from 'react';
import type React from 'react';

export function Btn({ kind = 'secondary', size, block, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'xs'; block?: boolean }) {
  return (
    <button
      className={`btn btn-${kind}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''}`}
      {...rest}
    />
  );
}

export function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}{required && <span className="req"> *</span>}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = props;
  return <input className={`input${invalid ? ' invalid' : ''}`} {...rest} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = props;
  return <textarea className={`textarea${invalid ? ' invalid' : ''}`} {...rest} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = props;
  return <select className={`select${invalid ? ' invalid' : ''}`} {...rest} />;
}

export function Badge({ tone = 'gray', children }: { tone?: 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'gray'; children: React.ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="bdot" />
      {children}
    </span>
  );
}

export function statusTone(status: string): 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'gray' {
  const s = status.toLowerCase();
  if (['paid', 'completed', 'active', 'confirmed', 'arrived', 'success', 'ok'].includes(s)) return 'green';
  if (['due', 'overdue', 'no show', 'expired', 'critical', 'cancelled', 'failed'].includes(s)) return 'red';
  if (['partially paid', 'scheduled', 'waiting', 'hold', 'warning', 'pending', 'in queue', 'rescheduled', 'open'].includes(s)) return 'amber';
  if (['in progress', 'called', 'info'].includes(s)) return 'blue';
  return 'gray';
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

export function Modal({ title, onClose, children, actions, size }: { title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode; size?: 'sm' | 'lg' | 'xl' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${size ? ` modal-${size}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
          <path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
          <path d="M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
        </svg>
      </div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-row">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-error">
      <div>{message}</div>
      {onRetry && (
        <div className="mt-2">
          <Btn size="sm" kind="secondary" onClick={onRetry}>Retry</Btn>
        </div>
      )}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: string }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} className={`tab${active === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <Btn size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</Btn>
      <span>Page {page} of {pages} · {total} record(s)</span>
      <Btn size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</Btn>
    </div>
  );
}

/** Debounced text input for search boxes. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | null>(null);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      className={`input search-input ${className}`}
      value={local}
      placeholder={placeholder}
      onChange={(e) => {
        setLocal(e.target.value);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onChange(e.target.value), 300);
      }}
    />
  );
}

export function DateRangeBar({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const presets: Array<{ label: string; days: number }> = [
    { label: 'Today', days: 0 },
    { label: '7 days', days: 6 },
    { label: '30 days', days: 29 },
    { label: '90 days', days: 89 },
    { label: '1 year', days: 364 },
  ];
  const setDays = (days: number) => {
    const t = new Date();
    const toS = t.toISOString().slice(0, 10);
    t.setDate(t.getDate() - days);
    onChange(t.toISOString().slice(0, 10), toS);
  };
  return (
    <div className="toolbar">
      {presets.map((p) => (
        <Btn key={p.label} size="sm" kind="ghost" onClick={() => setDays(p.days)}>{p.label}</Btn>
      ))}
      <input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => onChange(e.target.value, to)} aria-label="From date" />
      <span className="muted">to</span>
      <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => onChange(from, e.target.value)} aria-label="To date" />
    </div>
  );
}
