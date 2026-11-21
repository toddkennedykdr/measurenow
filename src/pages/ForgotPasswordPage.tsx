import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';

const GENERIC = 'If an account matches, we sent a reset link.';

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error(data.error || 'Too many reset requests. Please wait and try again.');
      setMessage(GENERIC);
    } catch (err: any) {
      setError(err.message || 'Could not send a reset link');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-card__brand">
          <BrandLogo size="login" />
          <p className="login-card__subtitle">Reset your MeasureNow password</p>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {message && <p className="admin-page__sub" role="status">{message}</p>}
        <div className="form-group">
          <label htmlFor="identifier">Username or email</label>
          <input id="identifier" className="input" value={identifier} onChange={e => setIdentifier(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Sending...' : 'Send reset link'}
        </button>
        <p className="login-forgot"><Link to="/login">Back to sign in</Link></p>
      </form>
    </div>
  );
}
