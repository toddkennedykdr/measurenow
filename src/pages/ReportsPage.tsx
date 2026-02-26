import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { useAuth } from '../context/AuthContext';

interface Report {
  id: number;
  address: string;
  createdAt: string;
  analysis: any;
  roofData: any;
}

function conditionColor(c: string) {
  if (c === 'poor') return '#E2312B';
  if (c === 'fair') return '#ca8a04';
  return '#16a34a';
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetch('/api/reports', { credentials: 'include' })
      .then(r => r.json())
      .then(setReports)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user, navigate]);

  return (
    <div className="inspect-page">
      <NavBar />
      <header className="inspect-header">
        <div className="inspect-header__top"><div className="header__logo">K&amp;D <span>Roofing</span></div></div>
        <div className="inspect-header__title">📋 My Reports</div>
      </header>
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>Loading reports...</div>
      ) : reports.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ fontSize: 16, color: '#6b7280' }}>No reports yet.</p>
          <Link to="/inspect" className="btn btn--primary" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>Start an Inspection</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, padding: '0 16px 16px' }}>
          {reports.map(r => {
            const analysis = typeof r.analysis === 'string' ? JSON.parse(r.analysis) : r.analysis;
            const condition = analysis?.overallCondition?.rating || 'N/A';
            const date = new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const roofData = typeof r.roofData === 'string' ? JSON.parse(r.roofData) : r.roofData;
            const sqft = roofData?.totalAreaSqFt;
            return (
              <Link key={r.id} to={`/reports/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={{ cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', padding: 16 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#032D59', lineHeight: 1.3 }}>{r.address}</div>
                    <span style={{ background: conditionColor(condition), color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 8 }}>
                      {condition.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {date}{sqft ? ` · ${sqft.toLocaleString()} sq ft` : ''}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <footer className="footer">© {new Date().getFullYear()} <a href="https://kanddroofingnc.com" target="_blank" rel="noopener">K&amp;D Roofing NC</a> · Licensed &amp; Insured</footer>
    </div>
  );
}
