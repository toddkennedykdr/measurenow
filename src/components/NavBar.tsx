import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function NavBar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const path = location.pathname;

  const linkStyle = (active: boolean) => ({
    padding: '10px 20px',
    color: active ? '#fff' : 'rgba(255,255,255,0.6)',
    background: active ? '#E2312B' : 'transparent',
    textDecoration: 'none' as const,
    fontWeight: 600 as const,
    fontSize: '13px',
    letterSpacing: '0.02em',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap' as const,
  });

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <nav style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 0,
      background: '#032D59',
      padding: 0,
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <Link to="/" style={linkStyle(path === '/')}>⚡ Quote</Link>
      <Link to="/inspect" style={linkStyle(path === '/inspect')}>🔍 Inspect</Link>
      {user && <Link to="/reports" style={linkStyle(path.startsWith('/reports'))}>📋 Reports</Link>}
      <div style={{ flex: 1 }} />
      {user ? (
        <button onClick={handleLogout} style={{ ...linkStyle(false), border: 'none', cursor: 'pointer', background: 'transparent', fontSize: '12px', opacity: 0.7 }}>
          Logout ({user.name})
        </button>
      ) : (
        <Link to="/login" style={{ ...linkStyle(path === '/login'), fontSize: '12px' }}>Login</Link>
      )}
    </nav>
  );
}
