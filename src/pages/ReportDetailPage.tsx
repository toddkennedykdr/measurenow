import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { JNModal } from '../components/JNModal';
import { RoofDiagram } from '../components/RoofDiagram';
import { useAuth } from '../context/AuthContext';

function formatPrice(n: number) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); }
function severityColor(s: string) { return s === 'major' ? '#E2312B' : s === 'minor' ? '#ca8a04' : '#16a34a'; }
function conditionColor(c: string) { return c === 'poor' ? '#E2312B' : c === 'fair' ? '#ca8a04' : '#16a34a'; }

const COMPLEXITY_MULTIPLIERS: Record<number, number> = { 1: 1.0, 2: 1.05, 3: 1.1, 4: 1.15, 5: 1.3 };
const SIDING_PRICES: Record<string, { low: number; high: number; label: string }> = {
  hardiboard: { low: 500, high: 700, label: 'HardiBoard/Fiber Cement' },
  default: { low: 300, high: 400, label: 'Vinyl/Ascend' },
};

export default function ReportDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showJN, setShowJN] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetch(`/api/reports/${id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject('Not found'))
      .then(setReport)
      .catch(() => navigate('/reports'))
      .finally(() => setLoading(false));
  }, [id, user, navigate]);

  if (loading) return <div className="inspect-page"><NavBar /><div className="card" style={{ textAlign: 'center', padding: 40 }}>Loading...</div></div>;
  if (!report) return null;

  const analysis = typeof report.analysis === 'string' ? JSON.parse(report.analysis) : report.analysis;
  const roofData = typeof report.roofData === 'string' ? JSON.parse(report.roofData) : report.roofData;
  const quote = typeof report.quote === 'string' ? JSON.parse(report.quote) : report.quote;
  const reportPhotos: string[] = (typeof report.photos === 'string' ? JSON.parse(report.photos) : report.photos) || [];
  const address = report.address;

  const complexityRating = analysis?.complexity?.rating || 3;
  const complexityMult = COMPLEXITY_MULTIPLIERS[complexityRating] || 1.1;
  const adjLow = Math.round((quote?.lowEstimate || 0) * complexityMult / 100) * 100;
  const adjHigh = Math.round((quote?.highEstimate || 0) * complexityMult / 100) * 100;
  const wallArea = analysis?.estimatedWallArea || 0;
  const wallSquares = wallArea / 100;
  const sidingKey = ((analysis?.sidingMaterial || '').toLowerCase().includes('hardi') || (analysis?.sidingMaterial || '').toLowerCase().includes('fiber cement')) ? 'hardiboard' : 'default';
  const sidingPricing = SIDING_PRICES[sidingKey];
  const sidingLow = Math.round(wallSquares * sidingPricing.low / 100) * 100;
  const sidingHigh = Math.round(wallSquares * sidingPricing.high / 100) * 100;
  const roofArea = roofData?.totalAreaSqFt || 0;
  const roofSquares = quote?.roofSquares || 0;
  const reportDate = new Date(report.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const handleDownloadPdf = async () => {
    const el = reportRef.current;
    if (!el) return;
    setPdfBusy(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const shortAddr = address.replace(/,?\s*(USA?|United States)$/i, '').trim().replace(/[^a-zA-Z0-9]+/g, '-');
      await html2pdf().from(el).set({
        margin: 0.4, filename: `KD-Inspection-${shortAddr}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      }).save();
    } catch (err) { console.error('PDF error', err); }
    finally { setPdfBusy(false); }
  };

  return (
    <div className="inspect-page">
      <NavBar />
      <div className="inspect-report hover-report" ref={reportRef}>
        <div className="hover-header">
          <div className="hover-header__brand">
            <div className="hover-header__logo">K&D <span>Roofing</span></div>
            <div className="hover-header__tagline">Complete Property Measurements</div>
          </div>
          <div className="hover-header__meta">
            <div className="hover-header__address">{address}</div>
            <div className="hover-header__date">{reportDate}</div>
          </div>
        </div>

        <div className="hover-actions no-print">
          <button className="btn btn--primary" onClick={handleDownloadPdf} disabled={pdfBusy}>
            {pdfBusy ? '⏳ Generating...' : '📄 Download PDF'}
          </button>
          <button className="btn btn--outline" onClick={() => window.print()}>🖨️ Print</button>
          <button className="btn btn--secondary" onClick={() => setShowJN(true)}>📤 Send to JobNimbus</button>
        </div>

        {/* Inspection Photos */}
        {reportPhotos.length > 0 && (
          <div className="card hover-section">
            <h2 className="hover-section__title">📸 Inspection Photos</h2>
            <div className="photo-gallery">
              {reportPhotos.map((src, i) => (
                <div key={i} className="photo-gallery__item">
                  <img src={src} alt={`Inspection photo ${i + 1}`} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Roof & Elevation Diagrams */}
        <RoofDiagram roofData={roofData} analysis={analysis} />

        {/* Roof Summary */}
        <div className="card hover-section">
          <div className="hover-section__header">
            <h2 className="hover-section__title">Roof Summary</h2>
            <span className="hover-section__badge" style={{ background: conditionColor(analysis?.overallCondition?.rating || 'fair') }}>
              {(analysis?.overallCondition?.rating || 'N/A').toUpperCase()}
            </span>
          </div>
          <div className="hover-measurement-grid">
            <div className="hover-measurement"><span className="hover-measurement__value">{roofArea.toLocaleString()}</span><span className="hover-measurement__label">Total Area (sq ft)</span></div>
            <div className="hover-measurement"><span className="hover-measurement__value">{roofSquares}</span><span className="hover-measurement__label">Squares</span></div>
            <div className="hover-measurement"><span className="hover-measurement__value">{quote?.pitchOver12 || '—'}/12</span><span className="hover-measurement__label">Pitch</span></div>
            <div className="hover-measurement"><span className="hover-measurement__value">{analysis?.roofType || 'N/A'}</span><span className="hover-measurement__label">Type</span></div>
          </div>
          <p className="hover-condition-note">{analysis?.overallCondition?.notes || ''}</p>
          {(analysis?.damage || []).length > 0 && (
            <div className="hover-damage-list">
              {analysis.damage.map((d: any, i: number) => (
                <div key={i} className="hover-damage-item">
                  <span className="hover-damage-dot" style={{ background: severityColor(d.severity) }} />
                  <div><strong>{d.type}</strong> <span style={{ color: severityColor(d.severity) }}>({d.severity})</span><div className="hover-damage-desc">{d.description}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Siding Summary */}
        {wallArea > 0 && (
          <div className="card hover-section">
            <div className="hover-section__header">
              <h2 className="hover-section__title">Siding Summary</h2>
              <span className="hover-section__badge" style={{ background: conditionColor(analysis?.sidingCondition?.rating || 'fair') }}>
                {(analysis?.sidingCondition?.rating || 'N/A').toUpperCase()}
              </span>
            </div>
            <div className="hover-measurement-grid">
              <div className="hover-measurement"><span className="hover-measurement__value">{wallArea.toLocaleString()}</span><span className="hover-measurement__label">Wall Area (sq ft)</span></div>
              <div className="hover-measurement"><span className="hover-measurement__value">{analysis?.sidingMaterial || 'N/A'}</span><span className="hover-measurement__label">Material</span></div>
            </div>
          </div>
        )}

        {/* Quote Summary */}
        <div className="card hover-section hover-quote-section">
          <h2 className="hover-section__title">Quote Summary</h2>
          <div className="hover-quote-table">
            <div className="hover-quote-row">
              <span>Roof Replacement</span>
              <strong>{formatPrice(adjLow)} – {formatPrice(adjHigh)}</strong>
            </div>
            {wallArea > 0 && (
              <div className="hover-quote-row">
                <span>Siding ({sidingPricing.label})</span>
                <strong>{formatPrice(sidingLow)} – {formatPrice(sidingHigh)}</strong>
              </div>
            )}
            <div className="hover-quote-total">
              <span>Total Estimated</span>
              <strong>{formatPrice(adjLow + sidingLow)} – {formatPrice(adjHigh + sidingHigh)}</strong>
            </div>
          </div>
        </div>

        {/* Recommendations */}
        {(analysis?.recommendations || []).length > 0 && (
          <div className="card hover-section">
            <h2 className="hover-section__title">Recommendations</h2>
            <ul className="hover-recs">{analysis.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="no-print" style={{ textAlign: 'center', padding: 16 }}>
        <button className="btn btn--outline" onClick={() => navigate('/reports')}>← Back to Reports</button>
      </div>

      {showJN && <JNModal address={address} reportRef={reportRef} onClose={() => setShowJN(false)} />}

      <footer className="footer">© {new Date().getFullYear()} <a href="https://kanddroofingnc.com" target="_blank" rel="noopener">K&amp;D Roofing NC</a> · Licensed &amp; Insured</footer>
    </div>
  );
}
