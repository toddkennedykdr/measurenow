import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from './BrandLogo';

export function NavBar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const path = location.pathname;

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const item = (to: string, label: string, active: boolean) => (
    <Link to={to} className={`appbar__link${active ? ' appbar__link--active' : ''}`}>{label}</Link>
  );

  return (
    <nav className="appbar">
      <Link to="/" className="appbar__brand">
        <BrandLogo size="header" />
      </Link>
      <div className="appbar__links">
        {user ? (
          <>
            {item('/', 'Dashboard', path === '/')}
            {item('/quote', 'Quote', path === '/quote')}
            {item('/inspect', 'Inspect', path === '/inspect')}
            {user.role === 'admin' && item('/admin/users', 'Users', path.startsWith('/admin/users'))}
            {user.role === 'admin' && item('/admin/invites', 'Invites', path.startsWith('/admin/invites'))}
            {user.role === 'admin' && item('/admin/orders', 'Orders', path.startsWith('/admin/orders'))}
          </>
        ) : (
          <>
            {item('/', 'Instant Quote', path === '/' || path === '/quote')}
            {item('/inspect', 'Inspection Tool', path === '/inspect')}
          </>
        )}
        {user ? (
          <button type="button" className="appbar__link" onClick={handleLogout}>
            Logout ({user.name})
          </button>
        ) : (
          item('/login', 'Login', path === '/login')
        )}
      </div>
    </nav>
  );
}
