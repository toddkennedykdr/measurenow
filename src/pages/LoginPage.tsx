import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from '../components/BrandLogo';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/inspect');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-card__brand">
          <BrandLogo size="login" />
          <p className="login-card__subtitle">MeasureNow inspector login</p>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input id="username" className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
