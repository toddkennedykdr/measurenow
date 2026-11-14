import { FormEvent, useState } from 'react';
import { AdminShell } from '../components/AdminShell';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    if (password.length > 200) {
      setError('Password is too long');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not change the password');
      setCurrentPassword('');
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell title="Change password" subtitle="Update the password on your MeasureNow account.">
      <div className="admin-card">
        {done ? (
          <form className="account-form">
            <p className="admin-page__sub">Your password has been updated.</p>
          </form>
        ) : (
          <form className="account-form" onSubmit={submit}>
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label htmlFor="current-password">Current password</label>
              <input id="current-password" className="input" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="form-group">
              <label htmlFor="new-password">New password</label>
              <input id="new-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input id="confirm-password" className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required />
            </div>
            <p className="admin-hint">At least 12 characters.</p>
            <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button>
          </form>
        )}
      </div>
    </AdminShell>
  );
}
