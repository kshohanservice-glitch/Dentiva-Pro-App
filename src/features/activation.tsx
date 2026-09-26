// Dentiva Pro — one-time activation screen.

import { useState } from 'react';
import type React from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Icons } from '../components/icons';
import { Btn, Field, TextInput } from '../components/ui';
import { friendlyError } from '../lib/ipc';

export function ActivationScreen() {
  const { refresh, toast } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{8,32}$/.test(code.trim())) {
      setError('Enter the numeric activation code provided with your product.');
      return;
    }
    setBusy(true);
    try {
      await api.activate(code.trim());
      toast({ kind: 'success', title: 'Activation successful', message: 'Welcome to Dentiva Pro. Please complete the setup wizard.' });
      await refresh();
    } catch (err) {
      setError(friendlyError(err));
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
            <p className="auth-sub">Product activation</p>
          </div>
        </div>
        <p className="small muted">Enter your one-time activation code to unlock this installation. Activation works fully offline and is stored on this device.</p>
        <div className="mt-3">
          <Field label="Activation code" required error={error}>
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 32))}
              placeholder="Enter activation code"
              inputMode="numeric"
              autoFocus
              invalid={!!error}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Btn kind="primary" block disabled={busy} type="submit">{busy ? 'Verifying…' : 'Activate Dentiva Pro'}</Btn>
        </div>
        <p className="small muted mt-3">This code was supplied with your licensed copy. Keep it safe — it is needed only if you reinstall on a fresh database.</p>
      </form>
    </div>
  );
}
