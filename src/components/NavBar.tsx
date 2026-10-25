import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function NavBar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const path = location.pathname;

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const item = (active: boolean) => `appbar__link${active ? ' appbar__link--active' : ''}`;

  return (
    <nav className="appbar">
      {user ? (
        <>
          <Link to="/" className={item(path === '/')}>Dashboard</Link>
          <Link to="/quote" className={item(path === '/quote')}>Quote</Link>
          <Link to="/inspect" className={item(path === '/inspect')}>Inspect</Link>
        </>
      ) : (
        <Link to="/" className={item(path === '/' || path === '/quote')}>Instant Quote</Link>
      )}
      <div className="appbar__spacer" />
      {user ? (
        <button type="button" onClick={handleLogout} className="appbar__link">
          Logout ({user.name})
        </button>
      ) : (
        <Link to="/login" className={item(path === '/login')}>Login</Link>
      )}
    </nav>
  );
}
