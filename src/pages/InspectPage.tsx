import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { JNModal } from '../components/JNModal';
import { RoofDiagram } from '../components/RoofDiagram';
import { useAuth } from '../context/AuthContext';

// Types
interface PhotoSlot {
  label: string;
  file: File | null;
  preview: string | null;
}

interface RoofData {
  totalAreaSqFt: number;
  segments: number;
  avgPitchDegrees: number;
  imageryQuality: string;
  footprintSqFt?: number;
  estimatedPerimeterFt?: number;
  estimatedLength?: number;
  estimatedWidth?: number;
}

interface BuildingMeasurements {
  footprintSqFt: number;
  buildingPerimeter: number;
  buildingLength: number;
  buildingWidth: number;
  stories: number;
  wallHeightPerStory: number;
  grossWallArea: number;
  calculatedWallArea: number;
  openingsDeduction: number;
  openingsPercent: number;
  measurementSource: string;
}

interface Quote {
  roofSquares: number;
  totalAreaSqFt: number;
  wasteFactor: number;
  lowEstimate: number;
  highEstimate: number;
  avgPitchDegrees: number;
  pitchOver12: number;
  pitchCategory: string;
  materialNote: string;
}

interface Analysis {
  roofType: string;
  material: { type: string; condition: string };
  features: { type: string; count: number; location: string }[];
  complexity: { rating: number; explanation: string };
  damage: { type: string; severity: string; location: string; description: string }[];
  accessIssues: string[];
  estimatedStories: number;
  overallCondition: { rating: string; notes: string };
  recommendations: string[];
  sidingMaterial: string;
  sidingCondition: { rating: string; notes: string };
  sidingDamage: { type: string; severity: string; location: string; description: string }[];
  estimatedWallArea: number;
  sidingRecommendations: string[];
  estimatedOpeningsArea?: number;
  estimatedTrimLength?: number;
  estimatedRidgeLength?: number;
  estimatedValleyLength?: number;
  estimatedRakeLength?: number;
  estimatedEaveLength?: number;
  estimatedDripEdge?: number;
  estimatedCorners?: { inside: number; outside: number };
  estimatedFacets?: number;
}

type Step = 'address' | 'confirm' | 'satellite' | 'photos' | 'analyzing' | 'report';

const PHOTO_SLOTS: string[] = [
  'Front', 'Left Side', 'Back', 'Right Side',
  'Front-Left Corner', 'Front-Right Corner', 'Back-Left Corner', 'Back-Right Corner',
];

// Resize image file to thumbnail base64 (max 400px wide, JPEG 70%)
function fileToThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 400;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

const COMPLEXITY_MULTIPLIERS: Record<number, number> = { 1: 1.0, 2: 1.05, 3: 1.1, 4: 1.15, 5: 1.3 };

const SIDING_PRICES: Record<string, { low: number; high: number; label: string }> = {
  hardiboard: { low: 500, high: 700, label: 'HardiBoard/Fiber Cement' },
  default: { low: 300, high: 400, label: 'Vinyl/Ascend' },
};

declare global {
  interface Window { google: any; }
}

let mapsLoaded = false;
let mapsLoadPromise: Promise<void> | null = null;
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (mapsLoaded) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;
  mapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => { mapsLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
  return mapsLoadPromise;
}

function formatPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function severityColor(s: string) {
  if (s === 'major') return '#E2312B';
  if (s === 'minor') return '#ca8a04';
  return '#16a34a';
}

function conditionColor(c: string) {
  if (c === 'poor') return '#E2312B';
  if (c === 'fair') return '#ca8a04';
  return '#16a34a';
}

export default function InspectPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('address');
  const [address, setAddress] = useState(searchParams.get('address') || '');
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [confirmedLat, setConfirmedLat] = useState(0);
  const [confirmedLng, setConfirmedLng] = useState(0);
  const [pinDragged, setPinDragged] = useState(false);
  const [roofData, setRoofData] = useState<RoofData | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [photos, setPhotos] = useState<PhotoSlot[]>(
    PHOTO_SLOTS.map(label => ({ label, file: null, preview: null }))
  );
  const [extraPhotos, setExtraPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [buildingMeasurements, setBuildingMeasurements] = useState<BuildingMeasurements | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [repEmail, setRepEmail] = useState('');
  const [sendingReport, setSendingReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showJN, setShowJN] = useState(false);
  const [savedReportId, setSavedReportId] = useState<number | null>(null);
  const { user } = useAuth();

  const mapRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Auto-geocode if address param provided
  useEffect(() => {
    const addr = searchParams.get('address');
    if (addr) {
      setAddress(addr);
    }
  }, [searchParams]);

  // Geocode
  const handleGeocode = async () => {
    if (!address.trim()) { setError('Enter an address'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/roof/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAddress(data.address);
      setLat(data.lat);
      setLng(data.lng);
      setConfirmedLat(data.lat);
      setConfirmedLng(data.lng);
      setPinDragged(false);
      setStep('confirm');
    } catch (err: any) {
      setError(err.message || 'Failed to find address');
    } finally {
      setLoading(false);
    }
  };

  // Init map
  const initMap = useCallback(async () => {
    try {
      const res = await fetch('/api/roof/maps-key');
      const { key } = await res.json();
      await loadGoogleMaps(key);
      if (!mapRef.current) return;
      const position = { lat, lng };
      const google = window.google;
      const map = new google.maps.Map(mapRef.current, {
        center: position, zoom: 20, mapTypeId: 'hybrid',
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
      });
      const marker = new google.maps.Marker({ position, map, draggable: true, title: 'Property' });
      marker.addListener('dragend', () => {
        const pos = marker.getPosition();
        if (pos) { setConfirmedLat(pos.lat()); setConfirmedLng(pos.lng()); setPinDragged(true); }
      });
    } catch { /* map optional */ }
  }, [lat, lng]);

  useEffect(() => {
    if (step === 'confirm') initMap();
  }, [step, initMap]);

  // Confirm location → get satellite data
  const handleConfirmLocation = async () => {
    setLoading(true);
    setError('');
    try {
      const useLat = pinDragged ? confirmedLat : lat;
      const useLng = pinDragged ? confirmedLng : lng;
      const res = await fetch('/api/roof/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: useLat, lng: useLng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRoofData(data.roofData);
      setQuote(data.quote);
      if (pinDragged) { setLat(confirmedLat); setLng(confirmedLng); }
      setStep('photos');
    } catch (err: any) {
      setError(err.message || 'Failed to get roof data');
    } finally {
      setLoading(false);
    }
  };

  // Photo handling
  const handlePhotoCapture = (index: number, file: File) => {
    const preview = URL.createObjectURL(file);
    setPhotos(prev => {
      const next = [...prev];
      if (next[index].preview) URL.revokeObjectURL(next[index].preview!);
      next[index] = { ...next[index], file, preview };
      return next;
    });
  };

  const handleExtraPhoto = (file: File) => {
    setExtraPhotos(prev => [...prev, { file, preview: URL.createObjectURL(file) }]);
  };

  const totalPhotos = photos.filter(p => p.file).length + extraPhotos.length;

  // Analyze photos
  const handleAnalyze = async () => {
    if (totalPhotos < 4) { setError('Take at least 4 photos'); return; }
    setStep('analyzing');
    setError('');
    try {
      const formData = new FormData();
      photos.forEach(p => { if (p.file) formData.append('photos', p.file); });
      extraPhotos.forEach(p => formData.append('photos', p.file));
      formData.append('lat', lat.toString());
      formData.append('lng', lng.toString());
      formData.append('address', address);

      const res = await fetch('/api/roof/analyze-photos', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalysis(data.analysis);
      if (data.buildingMeasurements) setBuildingMeasurements(data.buildingMeasurements);
      setStep('report');
      // Auto-save report if logged in (with photo thumbnails)
      try {
        const allFiles = [
          ...photos.filter(p => p.file).map(p => p.file!),
          ...extraPhotos.map(p => p.file),
        ];
        const thumbnails = await Promise.all(allFiles.map(f => fileToThumbnail(f)));
        const saveRes = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ address, lat, lng, roofData, analysis: data.analysis, quote, photos: thumbnails }),
        });
        const saveData = await saveRes.json();
        if (saveData.id) setSavedReportId(saveData.id);
      } catch {}
    } catch (err: any) {
      setError(err.message || 'Analysis failed');
      setStep('photos');
    }
  };

  // Send report
  const handleSendReport = async () => {
    setSendingReport(true);
    try {
      const res = await fetch('/api/roof/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repEmail, address, roofData, quote, analysis, buildingMeasurements }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReportSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send report');
    } finally {
      setSendingReport(false);
    }
  };

  // Download PDF
  const handleDownloadPdf = async () => {
    const el = reportRef.current;
    if (!el) return;
    setPdfBusy(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const shortAddr = address.replace(/,?\s*(USA?|United States)$/i, '').trim().replace(/[^a-zA-Z0-9]+/g, '-');
      await html2pdf().from(el).set({
        margin: 0.4,
        filename: `KD-Roofing-Inspection-${shortAddr}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).save();
    } catch (err) {
      console.error('PDF generation failed', err);
    } finally {
      setPdfBusy(false);
    }
  };

  // Computed values for report
  const complexityRating = analysis?.complexity?.rating || 3;
  const complexityMult = COMPLEXITY_MULTIPLIERS[complexityRating] || 1.1;
  const adjLow = Math.round((quote?.lowEstimate || 0) * complexityMult / 100) * 100;
  const adjHigh = Math.round((quote?.highEstimate || 0) * complexityMult / 100) * 100;

  const wallArea = analysis?.estimatedWallArea || 0;
  const wallSquares = wallArea / 100;
  const sidingKey = (analysis?.sidingMaterial || '').toLowerCase().includes('hardi') || (analysis?.sidingMaterial || '').toLowerCase().includes('fiber cement') ? 'hardiboard' : 'default';
  const sidingPricing = SIDING_PRICES[sidingKey];
  const sidingLow = Math.round(wallSquares * sidingPricing.low / 100) * 100;
  const sidingHigh = Math.round(wallSquares * sidingPricing.high / 100) * 100;

  return (
    <div className="inspect-page">
      <NavBar />
      <header className="inspect-header">
        <div className="inspect-header__top">
          <div className="header__logo">K&amp;D <span>Roofing</span></div>
        </div>
        <div className="inspect-header__title">🔍 Roof & Siding Inspection</div>
      </header>

      {error && <div className="error-msg">{error}</div>}

      {/* STEP: Address */}
      {step === 'address' && (
        <div className="card">
          <h2 className="card__title">Enter Property Address</h2>
          <p className="card__subtitle">Start your on-site inspection</p>
          <div className="form-group">
            <input
              className="input"
              type="text"
              placeholder="123 Main St, Raleigh, NC"
              value={address}
              onChange={e => setAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGeocode()}
              disabled={loading}
            />
          </div>
          <button className="btn btn--primary" onClick={handleGeocode} disabled={loading}>
            {loading && <span className="spinner" />}
            {loading ? 'Finding...' : 'Find Property'}
          </button>
        </div>
      )}

      {/* STEP: Confirm Location */}
      {step === 'confirm' && (
        <div className="card">
          <h2 className="card__title">Confirm Location</h2>
          <p className="card__subtitle">📍 {address}</p>
          <div ref={mapRef} className="inspect-map" />
          {pinDragged && (
            <p className="inspect-pin-note">📌 Pin moved — using updated location</p>
          )}
          <div className="confirm-buttons">
            <button className="btn btn--primary" onClick={handleConfirmLocation} disabled={loading}>
              {loading && <span className="spinner" />}
              {loading ? 'Getting Satellite Data...' : 'Confirm & Get Roof Data'}
            </button>
            <button className="btn btn--outline" onClick={() => { setStep('address'); setError(''); }} disabled={loading}>
              Change Address
            </button>
          </div>
        </div>
      )}

      {/* STEP: Photos */}
      {step === 'photos' && (
        <div className="card">
          {/* Satellite summary mini */}
          {roofData && quote && (
            <div className="inspect-satellite-mini">
              <div className="quote-stats">
                <div className="quote-stat">
                  <span className="quote-stat__value">{roofData.totalAreaSqFt.toLocaleString()}</span>
                  <span className="quote-stat__label">Sq Ft</span>
                </div>
                <div className="quote-stat">
                  <span className="quote-stat__value">{quote.roofSquares}</span>
                  <span className="quote-stat__label">Squares</span>
                </div>
                <div className="quote-stat">
                  <span className="quote-stat__value">{quote.pitchOver12}/12</span>
                  <span className="quote-stat__label">{quote.pitchCategory}</span>
                </div>
              </div>
            </div>
          )}

          <h2 className="card__title">📸 Capture Photos</h2>
          <p className="card__subtitle">
            Take photos from all sides + corners. Min 4, recommend 8+.
          </p>

          <div className="photo-grid">
            {photos.map((slot, i) => (
              <div key={slot.label} className={`photo-slot ${slot.file ? 'photo-slot--filled' : ''}`}>
                <label className="photo-slot__label">
                  {slot.preview ? (
                    <img src={slot.preview} alt={slot.label} className="photo-slot__img" />
                  ) : (
                    <div className="photo-slot__placeholder">
                      <span className="photo-slot__icon">📷</span>
                      <span className="photo-slot__text">{slot.label}</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="photo-slot__input"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handlePhotoCapture(i, f);
                    }}
                  />
                </label>
                {slot.file && <span className="photo-slot__check">✓</span>}
              </div>
            ))}
          </div>

          {/* Extra photos */}
          <div className="photo-extra">
            <label className="btn btn--outline photo-extra__btn">
              + Add More Photos
              <input
                type="file"
                accept="image/*"
                multiple
                className="photo-slot__input"
                onChange={e => {
                  const files = e.target.files;
                  if (files) Array.from(files).forEach(f => handleExtraPhoto(f));
                }}
              />
            </label>
            {extraPhotos.length > 0 && (
              <div className="photo-extra__thumbs">
                {extraPhotos.map((p, i) => (
                  <img key={i} src={p.preview} alt={`Extra ${i + 1}`} className="photo-extra__thumb" />
                ))}
              </div>
            )}
          </div>

          <div className="photo-status">
            <span className={`photo-count ${totalPhotos >= 4 ? 'photo-count--ok' : 'photo-count--low'}`}>
              {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} captured
            </span>
            {totalPhotos < 4 && <span className="photo-count__hint">Need at least 4</span>}
            {totalPhotos >= 4 && totalPhotos < 8 && <span className="photo-count__hint">Good — 8+ recommended</span>}
            {totalPhotos >= 8 && <span className="photo-count__hint">Great coverage! ✓</span>}
          </div>

          <button
            className="btn btn--primary"
            onClick={handleAnalyze}
            disabled={totalPhotos < 4}
          >
            🤖 Analyze Photos with AI
          </button>
        </div>
      )}

      {/* STEP: Analyzing */}
      {step === 'analyzing' && (
        <div className="card inspect-analyzing">
          <div className="inspect-analyzing__spinner" />
          <h2 className="card__title">AI is analyzing your photos...</h2>
          <p className="card__subtitle">
            Examining roof type, materials, damage, siding condition, and complexity.
            This takes 15-30 seconds.
          </p>
          <div className="inspect-analyzing__steps">
            <div className="inspect-analyzing__step">🛰️ Satellite data loaded</div>
            <div className="inspect-analyzing__step inspect-analyzing__step--active">📸 Analyzing {totalPhotos} photos...</div>
            <div className="inspect-analyzing__step inspect-analyzing__step--pending">📋 Generating report</div>
          </div>
        </div>
      )}

      {/* STEP: Report */}
      {step === 'report' && analysis && (() => {
        const roofArea = roofData?.totalAreaSqFt || 0;
        const roofSquares = quote?.roofSquares || 0;
        const facets = analysis.estimatedFacets || roofData?.segments || 0;
        const ridgeLen = analysis.estimatedRidgeLength || 0;
        const valleyLen = analysis.estimatedValleyLength || 0;
        const rakeLen = analysis.estimatedRakeLength || 0;
        const eaveLen = analysis.estimatedEaveLength || 0;
        const dripEdge = analysis.estimatedDripEdge || (rakeLen + eaveLen);
        const openingsArea = analysis.estimatedOpeningsArea || 0;
        const netWallArea = wallArea - openingsArea;
        const ridgeCount = analysis.features.filter(f => f.type.toLowerCase().includes('ridge') || f.type.toLowerCase().includes('hip')).reduce((s, f) => s + f.count, 0);
        const valleyCount = analysis.features.filter(f => f.type.toLowerCase().includes('valley')).reduce((s, f) => s + f.count, 0);
        const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        const roofWaste = [
          { label: 'Zero Waste', pct: 0 },
          { label: '+5%', pct: 0.05 },
          { label: '+10%', pct: 0.10 },
          { label: '+15%', pct: 0.15 },
          { label: '+20%', pct: 0.20 },
        ];
        const sidingWaste = [
          { label: 'Zero Waste', pct: 0 },
          { label: '+10%', pct: 0.10 },
          { label: '+18%', pct: 0.18 },
        ];

        return (
        <div className="inspect-report hover-report" id="printable-report" ref={reportRef}>
          {/* Property Header */}
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

          {/* Report Actions */}
          <div className="hover-actions no-print">
            <button className="btn btn--primary" onClick={handleDownloadPdf} disabled={pdfBusy}>
              {pdfBusy ? '⏳ Generating...' : '📄 Download PDF'}
            </button>
            <button className="btn btn--outline" onClick={() => window.print()}>
              🖨️ Print Report
            </button>
            {user && (
              <button className="btn btn--secondary" onClick={() => setShowJN(true)}>
                📤 Send to JobNimbus
              </button>
            )}
          </div>

          {/* INSPECTION PHOTOS */}
          {totalPhotos > 0 && (
            <div className="card hover-section">
              <h2 className="hover-section__title">📸 Inspection Photos</h2>
              <div className="photo-gallery">
                {photos.filter(p => p.preview).map((p, i) => (
                  <div key={i} className="photo-gallery__item">
                    <img src={p.preview!} alt={p.label} />
                    <span className="photo-gallery__label">{p.label}</span>
                  </div>
                ))}
                {extraPhotos.map((p, i) => (
                  <div key={`extra-${i}`} className="photo-gallery__item">
                    <img src={p.preview} alt={`Extra ${i + 1}`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ROOF & ELEVATION DIAGRAMS */}
          <RoofDiagram roofData={roofData} analysis={analysis} />

          {/* SIDING SUMMARY */}
          <div className="card hover-section">
            <div className="hover-section__header">
              <h2 className="hover-section__title">Siding Summary</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {buildingMeasurements?.measurementSource === 'satellite' && (
                  <span className="hover-section__badge" style={{ background: '#2563eb', fontSize: '10px', padding: '3px 8px' }}>
                    🛰️ SATELLITE MEASURED
                  </span>
                )}
                <span className="hover-section__badge" style={{ background: conditionColor(analysis.sidingCondition.rating) }}>
                  {analysis.sidingCondition.rating.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Building Dimensions (from satellite) */}
            {buildingMeasurements && (
              <div className="hover-measurement-grid" style={{ marginBottom: '12px' }}>
                <div className="hover-measurement">
                  <span className="hover-measurement__value">{buildingMeasurements.buildingLength}' × {buildingMeasurements.buildingWidth}'</span>
                  <span className="hover-measurement__label">Building Dimensions</span>
                </div>
                <div className="hover-measurement">
                  <span className="hover-measurement__value">{buildingMeasurements.footprintSqFt.toLocaleString()}</span>
                  <span className="hover-measurement__label">Footprint (sq ft)</span>
                </div>
                <div className="hover-measurement">
                  <span className="hover-measurement__value">{buildingMeasurements.buildingPerimeter}'</span>
                  <span className="hover-measurement__label">Perimeter</span>
                </div>
                <div className="hover-measurement">
                  <span className="hover-measurement__value">{buildingMeasurements.stories} × {buildingMeasurements.wallHeightPerStory}'</span>
                  <span className="hover-measurement__label">Stories × Wall Height</span>
                </div>
              </div>
            )}

            <div className="hover-measurement-grid">
              <div className="hover-measurement">
                <span className="hover-measurement__value">{(buildingMeasurements?.grossWallArea || wallArea).toLocaleString()}</span>
                <span className="hover-measurement__label">Gross Wall Area (sq ft)</span>
              </div>
              <div className="hover-measurement">
                <span className="hover-measurement__value">{openingsArea.toLocaleString()}</span>
                <span className="hover-measurement__label">Openings ({buildingMeasurements?.openingsPercent || 18}%)</span>
              </div>
              <div className="hover-measurement">
                <span className="hover-measurement__value">{netWallArea.toLocaleString()}</span>
                <span className="hover-measurement__label">Net Siding (sq ft)</span>
              </div>
              <div className="hover-measurement">
                <span className="hover-measurement__value">{analysis.sidingMaterial}</span>
                <span className="hover-measurement__label">Material</span>
              </div>
            </div>

            {analysis.estimatedCorners && (
              <div className="hover-detail-row">
                <span>Corners — Inside: {analysis.estimatedCorners.inside} · Outside: {analysis.estimatedCorners.outside}</span>
                {analysis.estimatedTrimLength ? <span>Trim: ~{analysis.estimatedTrimLength} lin ft</span> : null}
              </div>
            )}

            <p className="hover-condition-note">{analysis.sidingCondition.notes}</p>

            {analysis.sidingDamage.length > 0 && (
              <div className="hover-damage-list">
                {analysis.sidingDamage.map((d, i) => (
                  <div key={i} className="hover-damage-item">
                    <span className="hover-damage-dot" style={{ background: severityColor(d.severity) }} />
                    <div>
                      <strong>{d.type}</strong> <span className="hover-damage-sev" style={{ color: severityColor(d.severity) }}>({d.severity})</span>
                      <div className="hover-damage-desc">{d.description} — {d.location}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Siding Waste Table */}
            <h4 className="hover-table-title">Siding Waste Factor</h4>
            <table className="hover-table">
              <thead>
                <tr><th>Factor</th><th>Area (sq ft)</th><th>Squares</th></tr>
              </thead>
              <tbody>
                {sidingWaste.map(w => {
                  const a = Math.round(netWallArea * (1 + w.pct));
                  return (
                    <tr key={w.label}><td>{w.label}</td><td>{a.toLocaleString()}</td><td>{(a / 100).toFixed(1)}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ROOF SUMMARY */}
          <div className="card hover-section">
            <div className="hover-section__header">
              <h2 className="hover-section__title">Roof Summary</h2>
              <span className="hover-section__badge" style={{ background: conditionColor(analysis.overallCondition.rating) }}>
                {analysis.overallCondition.rating.toUpperCase()}
              </span>
            </div>

            <div className="hover-measurement-grid">
              <div className="hover-measurement">
                <span className="hover-measurement__value">{roofArea.toLocaleString()}</span>
                <span className="hover-measurement__label">Total Roof Area (sq ft)</span>
              </div>
              <div className="hover-measurement">
                <span className="hover-measurement__value">{roofSquares}</span>
                <span className="hover-measurement__label">Squares</span>
              </div>
              <div className="hover-measurement">
                <span className="hover-measurement__value">{facets}</span>
                <span className="hover-measurement__label">Facets</span>
              </div>
              <div className="hover-measurement">
                <span className="hover-measurement__value">{analysis.roofType}</span>
                <span className="hover-measurement__label">Roof Type</span>
              </div>
            </div>

            {/* Line Items */}
            <h4 className="hover-table-title">Roof Components</h4>
            <table className="hover-table">
              <thead>
                <tr><th>Component</th><th>Count</th><th>Est. Length (ft)</th></tr>
              </thead>
              <tbody>
                <tr><td>Ridges / Hips</td><td>{ridgeCount || '—'}</td><td>{ridgeLen || '—'}</td></tr>
                <tr><td>Valleys</td><td>{valleyCount || '—'}</td><td>{valleyLen || '—'}</td></tr>
                <tr><td>Rakes</td><td>—</td><td>{rakeLen || '—'}</td></tr>
                <tr><td>Eaves</td><td>—</td><td>{eaveLen || '—'}</td></tr>
                <tr><td>Drip Edge / Perimeter</td><td>—</td><td>{dripEdge || '—'}</td></tr>
              </tbody>
            </table>

            {/* Pitch */}
            <h4 className="hover-table-title">Pitch</h4>
            <div className="hover-pitch-display">
              <span className="hover-pitch-value">{quote?.pitchOver12 || '—'}/12</span>
              <span className="hover-pitch-label">{quote?.pitchCategory || ''} — {quote?.avgPitchDegrees?.toFixed(1) || '—'}°</span>
            </div>

            {/* Features */}
            {analysis.features.length > 0 && (
              <>
                <h4 className="hover-table-title">Features Detected</h4>
                <div className="hover-badges">
                  {analysis.features.map((f, i) => (
                    <span key={i} className="hover-feature-badge">
                      {f.type} <strong>×{f.count}</strong>
                    </span>
                  ))}
                </div>
              </>
            )}

            {/* Roof Waste Table */}
            <h4 className="hover-table-title">Roof Waste Factor</h4>
            <table className="hover-table">
              <thead>
                <tr><th>Factor</th><th>Area (sq ft)</th><th>Squares</th></tr>
              </thead>
              <tbody>
                {roofWaste.map(w => {
                  const a = Math.round(roofArea * (1 + w.pct));
                  return (
                    <tr key={w.label}><td>{w.label}</td><td>{a.toLocaleString()}</td><td>{(a / 100).toFixed(1)}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* AI INSPECTION NOTES */}
          <div className="card hover-section">
            <h2 className="hover-section__title">AI Inspection Notes</h2>

            {/* Overall Condition */}
            <div className="hover-condition-block">
              <span className="hover-condition-badge" style={{ background: conditionColor(analysis.overallCondition.rating) }}>
                {analysis.overallCondition.rating.toUpperCase()}
              </span>
              <span className="hover-condition-text">{analysis.overallCondition.notes}</span>
            </div>

            {/* Complexity */}
            <div className="hover-complexity">
              <span className="hover-complexity__label">Complexity Rating</span>
              <div className="hover-complexity__bar">
                {[1, 2, 3, 4, 5].map(n => (
                  <div key={n} className={`hover-complexity__segment ${n <= complexityRating ? 'hover-complexity__segment--active' : ''}`}
                    style={{ background: n <= complexityRating ? (complexityRating >= 4 ? '#E2312B' : complexityRating >= 3 ? '#ca8a04' : '#16a34a') : undefined }} />
                ))}
              </div>
              <span className="hover-complexity__text">{complexityRating}/5 — {analysis.complexity.explanation}</span>
            </div>

            {/* Damage Findings */}
            {analysis.damage.length > 0 && (
              <>
                <h4 className="hover-table-title">Roof Damage Findings</h4>
                <div className="hover-damage-list">
                  {analysis.damage.map((d, i) => (
                    <div key={i} className="hover-damage-item">
                      <span className="hover-damage-dot" style={{ background: severityColor(d.severity) }} />
                      <div>
                        <strong>{d.type}</strong> <span className="hover-damage-sev" style={{ color: severityColor(d.severity) }}>({d.severity})</span>
                        <div className="hover-damage-desc">{d.description} — {d.location}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Access Issues */}
            {analysis.accessIssues.length > 0 && (
              <>
                <h4 className="hover-table-title">⚠️ Access Issues</h4>
                <div className="hover-badges">
                  {analysis.accessIssues.map((a, i) => (
                    <span key={i} className="hover-feature-badge hover-feature-badge--warn">{a}</span>
                  ))}
                </div>
              </>
            )}

            {/* Recommendations */}
            {analysis.recommendations.length > 0 && (
              <>
                <h4 className="hover-table-title">Recommendations</h4>
                <ul className="hover-recs">
                  {analysis.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </>
            )}

            {analysis.sidingRecommendations.length > 0 && (
              <>
                <h4 className="hover-table-title">Siding Recommendations</h4>
                <ul className="hover-recs">
                  {analysis.sidingRecommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </>
            )}
          </div>

          {/* QUOTE SUMMARY */}
          <div className="card hover-section hover-quote-section">
            <h2 className="hover-section__title">Quote Summary</h2>
            <div className="hover-quote-table">
              <div className="hover-quote-row">
                <span>Roof Replacement <small>({analysis.material.type} · {complexityRating}/5 complexity)</small></span>
                <strong>{formatPrice(adjLow)} – {formatPrice(adjHigh)}</strong>
              </div>
              {wallArea > 0 && (
                <div className="hover-quote-row">
                  <span>Siding <small>({sidingPricing.label})</small></span>
                  <strong>{formatPrice(sidingLow)} – {formatPrice(sidingHigh)}</strong>
                </div>
              )}
              <div className="hover-quote-total">
                <span>Total Estimated</span>
                <strong>{formatPrice(adjLow + sidingLow)} – {formatPrice(adjHigh + sidingHigh)}</strong>
              </div>
            </div>
            <p className="hover-quote-disclaimer">*Estimates based on satellite data + AI photo analysis. Final pricing subject to on-site confirmation.</p>
          </div>

          {/* Send Report */}
          <div className="card hover-section no-print">
            <h3 className="hover-section__title">📧 Send Report</h3>
            {reportSent ? (
              <div className="inspect-report-sent">
                <span className="inspect-report-sent__icon">✅</span>
                <p>Report sent to todd@kanddroofingnc.com{repEmail ? ` and ${repEmail}` : ''}</p>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="repEmail">Your Email (optional)</label>
                  <input
                    id="repEmail"
                    className="input"
                    type="email"
                    placeholder="rep@kanddroofingnc.com"
                    value={repEmail}
                    onChange={e => setRepEmail(e.target.value)}
                  />
                </div>
                <button className="btn btn--secondary" onClick={handleSendReport} disabled={sendingReport}>
                  {sendingReport && <span className="spinner" />}
                  {sendingReport ? 'Sending...' : 'Save & Send Report'}
                </button>
              </>
            )}
          </div>

          {/* Start New */}
          <div className="no-print" style={{ textAlign: 'center', padding: '16px 0' }}>
            <button className="btn btn--outline" onClick={() => window.location.reload()}>
              Start New Inspection
            </button>
          </div>
        </div>
        );
      })()}

      {showJN && <JNModal address={address} reportRef={reportRef} onClose={() => setShowJN(false)} />}

      <footer className="footer">
        © {new Date().getFullYear()}{' '}
        <a href="https://kanddroofingnc.com" target="_blank" rel="noopener">K&amp;D Roofing NC</a>
        {' '}· Licensed &amp; Insured
      </footer>
    </div>
  );
}
