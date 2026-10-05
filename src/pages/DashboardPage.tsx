import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { conditionColor } from '../statusColors';

interface Report {
  id: number;
  address: string;
  customerName?: string;
  createdAt: string;
  analysis: any;
  roofData: any;
}

export default function DashboardPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports', { credentials: 'include' })
      .then(r => r.json())
      .then(setReports)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
    <NavBar />
    <div className="inspect-page">
      <header className="inspect-header" style={{ paddingBottom: 8 }}>
        <div className="inspect-header__title" style={{ fontSize: 20 }}>Dashboard</div>
      </header>

      <div className="action-grid">
        <Link to="/quote" className="action-card action-card--navy">
          <div className="action-card__icon">⚡</div>
          <div className="action-card__title">Instant Quote</div>
          <div className="action-card__text">Get a roof replacement estimate in seconds</div>
        </Link>

        <Link to="/inspect" className="action-card action-card--blue">
          <div className="action-card__icon">🔍</div>
          <div className="action-card__title">Inspection Tool</div>
          <div className="action-card__text">Run a full AI-powered roof inspection</div>
        </Link>
      </div>

      {/* My Reports */}
      <div style={{ padding: '0 0 24px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--navy)' }}>📋 My Reports</h2>
          {!loading && (
            <span style={{
              background: '#e6eaf1',
              color: 'var(--navy)',
              padding: '2px 10px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 600,
            }}>{reports.length}</span>
          )}
        </div>

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading reports...</div>
        ) : reports.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
            <p style={{ fontSize: 16, color: 'var(--muted)', margin: '0 0 16px' }}>No reports yet. Run your first inspection!</p>
            <Link to="/inspect" className="btn btn--primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
              🔍 Start Inspection
            </Link>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}>
            {reports.map(r => {
              const analysis = typeof r.analysis === 'string' ? JSON.parse(r.analysis) : r.analysis;
              const condition = analysis?.overallCondition?.rating || 'N/A';
              const date = new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const displayName = r.customerName || r.address;
              return (
                <Link key={r.id} to={`/reports/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="card" style={{
                    cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    padding: 16,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)', lineHeight: 1.3 }}>{displayName}</div>
                      <span style={{
                        background: conditionColor(condition),
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        marginLeft: 8,
                        textTransform: 'uppercase',
                      }}>{condition}</span>
                    </div>
                    {r.customerName && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>{r.address}</div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{date}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <footer className="footer">
        © {new Date().getFullYear()}{' '}
        <a href="https://kanddroofingnc.com" target="_blank" rel="noopener">K&amp;D Roofing NC</a>{' '}
        · Licensed &amp; Insured
      </footer>
    </div>
    </>
  );
}
