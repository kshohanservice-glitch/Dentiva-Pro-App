// Dentiva Pro — login + lock screens.

import { useState } from 'react';
import type React from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Icons } from '../components/icons';
import { Btn, Field, TextInput } from '../components/ui';
import { friendlyError } from '../lib/ipc';

export function LoginScreen() {
  const { refresh, toast } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      await api.login(username.trim(), password);
      await refresh();
    } catch (err) {
      const msg = friendlyError(err);
      setError(msg);
      toast({ kind: 'error', title: 'Login failed', message: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark">{Icons.tooth}</div>
          <div>
            <h1 className="auth-title">Dentiva Pro</h1>
            <p className="auth-sub">Sign in to your clinic</p>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="Username" required error={error && !username ? error : undefined}>
            <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </Field>
          <Field label="Password" required>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" invalid={!!error} />
          </Field>
        </div>
        {error && <div className="alert alert-error mt-3">{error}</div>}
        <div className="mt-4">
          <Btn kind="primary" block disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</Btn>
        </div>
        <p className="small muted mt-3">Protected by role-based access. All sign-in attempts are audit-logged.</p>
      </form>
    </div>
  );
}

export function LockScreen() {
  const { refresh, session } = useApp();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.unlock(password);
      setPassword('');
      await refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.logout();
    await refresh();
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark">{Icons.lock}</div>
          <div>
            <h1 className="auth-title">Locked</h1>
            <p className="auth-sub">{session?.fullName ?? 'Session'} · {session?.roleName ?? ''}</p>
          </div>
        </div>
        <p className="small muted">Dentiva Pro is locked. Patient and financial data is hidden until you unlock.</p>
        <div className="mt-3">
          <Field label="Password" required error={error}>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" invalid={!!error} />
          </Field>
        </div>
        <div className="mt-4">
          <Btn kind="primary" block disabled={busy} type="submit">{busy ? 'Unlocking…' : 'Unlock'}</Btn>
        </div>
        <div className="mt-3">
          <Btn kind="ghost" block onClick={() => void logout()} type="button">Sign in as a different user</Btn>
        </div>
      </form>
    </div>
  );
}
