import { Link, useLocation } from 'react-router-dom';

export function NavBar() {
  const location = useLocation();
  const isQuote = location.pathname === '/';
  const isInspect = location.pathname === '/inspect';

  return (
    <nav style={{
      display: 'flex',
      justifyContent: 'center',
      gap: '0',
      background: '#032D59',
      padding: '0',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <Link
        to="/"
        style={{
          padding: '10px 24px',
          color: isQuote ? '#fff' : 'rgba(255,255,255,0.6)',
          background: isQuote ? '#E2312B' : 'transparent',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '14px',
          letterSpacing: '0.02em',
          transition: 'all 0.2s',
        }}
      >
        ⚡ Instant Quote
      </Link>
      <Link
        to="/inspect"
        style={{
          padding: '10px 24px',
          color: isInspect ? '#fff' : 'rgba(255,255,255,0.6)',
          background: isInspect ? '#E2312B' : 'transparent',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '14px',
          letterSpacing: '0.02em',
          transition: 'all 0.2s',
        }}
      >
        🔍 Inspection Tool
      </Link>
    </nav>
  );
}
