import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';

export default function InviteAcceptPage() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the account');
      setUsername(data.username);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <BrandLogo size="login" />
          <p className="login-card__subtitle">Set your MeasureNow password</p>
        </div>
        {username ? (
          <div>
            <p className="admin-page__sub">Account created for <strong>{username}</strong>. Sign in with the password you just chose.</p>
            <Link to="/login" className="btn btn--primary">Sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label htmlFor="new-password">Password</label>
              <input id="new-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm password</label>
              <input id="confirm-password" className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} required />
            </div>
            <p className="admin-hint">At least 12 characters. This does not change anyone else’s password.</p>
            <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Create account'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
