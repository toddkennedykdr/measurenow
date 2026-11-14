import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';

const GENERIC = 'This reset link is invalid or has expired';

export default function ResetPasswordPage() {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<'checking' | 'invalid' | 'ready' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setPhase('invalid');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/auth/reset-password/${encodeURIComponent(token)}`);
        if (!cancelled) setPhase(res.ok ? 'ready' : 'invalid');
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
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
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error('Too many tries, please wait a few minutes');
      if (!res.ok) throw new Error(data.error || 'Could not reset the password');
      setPhase('done');
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
          <p className="login-card__subtitle">Choose a new MeasureNow password</p>
        </div>
        {phase === 'checking' ? (
          <p className="admin-page__sub">Checking this reset link…</p>
        ) : phase === 'invalid' ? (
          <div>
            <div className="error-msg">{GENERIC}</div>
            <Link to="/login" className="btn btn--primary">Sign in</Link>
          </div>
        ) : phase === 'done' ? (
          <div>
            <p className="admin-page__sub">Your password has been updated. Sign in with the new password.</p>
            <Link to="/login" className="btn btn--primary">Sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label htmlFor="new-password">Password</label>
              <input id="new-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm password</label>
              <input id="confirm-password" className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required />
            </div>
            <p className="admin-hint">At least 12 characters.</p>
            <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Update password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
