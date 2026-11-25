import React from 'react';

interface RoofSegment {
  areaSqFt: number;
  pitchDegrees: number;
  azimuthDegrees: number;
}

interface RoofData {
  totalAreaSqFt: number;
  segments?: RoofSegment[] | number;
  avgPitch?: number;
  avgPitchDegrees?: number;
  footprintSqFt?: number;
  estimatedPerimeterFt?: number;
  estimatedLength?: number;
  estimatedWidth?: number;
}

interface Analysis {
  roofType?: string;
  estimatedFacets?: number;
  estimatedRidgeLength?: number;
  estimatedEaveLength?: number;
  estimatedRakeLength?: number;
  estimatedValleyLength?: number;
  estimatedStories?: number;
  [key: string]: any;
}

interface Props {
  roofData: RoofData | null;
  analysis: Analysis | null;
}

const NAVY = '#032D59';
const LIGHT = '#E8EDF3';
const SHADES = ['#032D59', '#0A4A8A', '#1565B0', '#2080D0', '#3A9BE0', '#5BB5F0', '#7CCBFF', '#A0DDFF'];

function getSegmentShade(i: number) {
  return SHADES[i % SHADES.length];
}

export function RoofDiagram({ roofData, analysis }: Props) {
  if (!roofData) return null;

  const measuredLength = roofData.estimatedLength && roofData.estimatedLength > 0 ? roofData.estimatedLength : 0;
  const measuredWidth = roofData.estimatedWidth && roofData.estimatedWidth > 0 ? roofData.estimatedWidth : 0;
  // Drawing scale only. These fallbacks are never printed.
  const bLen = measuredLength || 40;
  const bWid = measuredWidth || 30;
  const measuredPitch = roofData.avgPitch ?? roofData.avgPitchDegrees;
  const drawPitch = measuredPitch ?? 20;
  const segments: RoofSegment[] = Array.isArray(roofData.segments) ? roofData.segments : [];
  const measuredStories = analysis?.estimatedStories && analysis.estimatedStories > 0
    ? analysis.estimatedStories
    : 0;
  const wallH = (measuredStories || 1) * 9;

  // ---- ROOF PLAN (Bird's Eye) ----
  const planW = 400;
  const planH = 320;
  const margin = 50;
  const scaleX = (planW - margin * 2) / bLen;
  const scaleY = (planH - margin * 2) / bWid;
  const scale = Math.min(scaleX, scaleY);
  const ox = (planW - bLen * scale) / 2;
  const oy = (planH - bWid * scale) / 2;
  const rw = bLen * scale;
  const rh = bWid * scale;

  // Generate segment polygons based on azimuth — divide footprint into quadrants
  const segsByAz = segments.map((s, i) => ({ ...s, idx: i }));
  // Sort by azimuth for layout
  segsByAz.sort((a, b) => a.azimuthDegrees - b.azimuthDegrees);

  // Simple hip roof layout: 4 triangular segments from center ridge
  const cx = ox + rw / 2;
  const cy = oy + rh / 2;
  const ridgeHalf = rw * 0.3;

  // Ridge line endpoints
  const ridgeL = { x: cx - ridgeHalf, y: cy };
  const ridgeR = { x: cx + ridgeHalf, y: cy };

  // Corners
  const tl = { x: ox, y: oy };
  const tr = { x: ox + rw, y: oy };
  const bl = { x: ox, y: oy + rh };
  const br = { x: ox + rw, y: oy + rh };

  // 4 main facets (front, back, left, right)
  const facetPolygons = [
    { pts: [tl, tr, ridgeR, ridgeL], label: 'Front' },
    { pts: [bl, br, ridgeR, ridgeL], label: 'Back' },
    { pts: [tl, bl, ridgeL], label: 'Left' },
    { pts: [tr, br, ridgeR], label: 'Right' },
  ];

  const planSegments = facetPolygons.map((f, i) => ({ ...f, seg: segments[i] }));

  // ---- ELEVATION VIEWS ----
  const elevW = 180;
  const elevH = 130;
  const elevMargin = 15;

  const elevations = [
    { label: 'Front', wallW: bLen, pitchDeg: drawPitch },
    { label: 'Back', wallW: bLen, pitchDeg: drawPitch },
    { label: 'Left', wallW: bWid, pitchDeg: drawPitch },
    { label: 'Right', wallW: bWid, pitchDeg: drawPitch },
  ];

  return (
    <div className="card hover-section" style={{ pageBreakInside: 'avoid' }}>
      <h2 className="hover-section__title">📐 Roof & Elevation Diagrams</h2>
      <p className="hover-diagram-note">Illustrative — not to scale</p>

      {/* Roof Plan */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ color: NAVY, marginBottom: 8, fontSize: 14 }}>Roof Plan (Bird's Eye View)</h4>
        <svg viewBox={`0 0 ${planW} ${planH}`} width="100%" style={{ maxWidth: 500, display: 'block', margin: '0 auto' }}>
          {/* Footprint outline */}
          <rect x={ox} y={oy} width={rw} height={rh} fill="none" stroke={NAVY} strokeWidth={1} strokeDasharray="4,2" />

          {/* Facet polygons */}
          {planSegments.map((f, i) => {
            const pts = f.pts.map(p => `${p.x},${p.y}`).join(' ');
            const centroid = {
              x: f.pts.reduce((s, p) => s + p.x, 0) / f.pts.length,
              y: f.pts.reduce((s, p) => s + p.y, 0) / f.pts.length,
            };
            return (
              <g key={i}>
                <polygon points={pts} fill={getSegmentShade(i)} fillOpacity={0.35} stroke={NAVY} strokeWidth={1.5} />
                {f.seg ? (
                  <>
                    <text x={centroid.x} y={centroid.y - 6} textAnchor="middle" fontSize={10} fill={NAVY} fontWeight="bold">
                      {Math.round(f.seg.areaSqFt).toLocaleString()} sf
                    </text>
                    <text x={centroid.x} y={centroid.y + 8} textAnchor="middle" fontSize={9} fill={NAVY}>
                      {f.seg.pitchDegrees.toFixed(0)}°
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}

          {/* Ridge line */}
          <line x1={ridgeL.x} y1={ridgeL.y} x2={ridgeR.x} y2={ridgeR.y} stroke={NAVY} strokeWidth={2.5} />
          <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fill={NAVY} fontStyle="italic">ridge</text>

          {/* Total area is the measured roof figure. Plan length and width are not labeled. */}
          {typeof roofData.totalAreaSqFt === 'number' && (
            <text x={cx} y={planH - 6} textAnchor="middle" fontSize={11} fill={NAVY} fontWeight="bold">
              Total: {roofData.totalAreaSqFt.toLocaleString()} sq ft
            </text>
          )}
        </svg>
      </div>

      {/* Elevation Views */}
      <h4 style={{ color: NAVY, marginBottom: 8, fontSize: 14 }}>Elevation Views</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {elevations.map((elev, i) => {
          const wallScale = (elevW - elevMargin * 2) / Math.max(elev.wallW, 1);
          const hScale = (elevH - elevMargin * 2 - 30) / Math.max(wallH + 10, 1);
          const s = Math.min(wallScale, hScale);
          const ew = elev.wallW * s;
          const eh = wallH * s;
          const eox = (elevW - ew) / 2;
          const gableH = Math.min(Math.tan((elev.pitchDeg * Math.PI) / 180) * (ew / 2), 40);
          const baseY = elevH - elevMargin;
          const topY = baseY - eh;

          // Openings: 15% of wall area
          const openingAreaPx = ew * eh * 0.15;
          const doorW = ew * 0.08;
          const doorH = eh * 0.5;
          const winW = ew * 0.1;
          const winH = eh * 0.18;

          return (
            <svg key={i} viewBox={`0 0 ${elevW} ${elevH}`} width="100%" style={{ border: `1px solid ${LIGHT}`, borderRadius: 6, background: '#FAFBFD' }}>
              {/* Wall */}
              <rect x={eox} y={topY} width={ew} height={eh} fill={LIGHT} stroke={NAVY} strokeWidth={1.5} />

              {/* Gable triangle */}
              <polygon
                points={`${eox},${topY} ${eox + ew / 2},${topY - gableH} ${eox + ew},${topY}`}
                fill={LIGHT} stroke={NAVY} strokeWidth={1.5}
              />

              {/* Door */}
              <rect x={eox + ew * 0.45} y={baseY - doorH} width={doorW} height={doorH} fill="white" stroke={NAVY} strokeWidth={0.8} />

              {/* Windows */}
              <rect x={eox + ew * 0.15} y={topY + eh * 0.2} width={winW} height={winH} fill="white" stroke={NAVY} strokeWidth={0.8} />
              <rect x={eox + ew * 0.75} y={topY + eh * 0.2} width={winW} height={winH} fill="white" stroke={NAVY} strokeWidth={0.8} />
              {measuredStories >= 2 && (
                <>
                  <rect x={eox + ew * 0.15} y={topY + eh * 0.55} width={winW} height={winH} fill="white" stroke={NAVY} strokeWidth={0.8} />
                  <rect x={eox + ew * 0.75} y={topY + eh * 0.55} width={winW} height={winH} fill="white" stroke={NAVY} strokeWidth={0.8} />
                </>
              )}

              {/* Labels */}
              <text x={elevW / 2} y={elevMargin - 2} textAnchor="middle" fontSize={10} fill={NAVY} fontWeight="bold">{elev.label}</text>
            </svg>
          );
        })}
      </div>
    </div>
  );
}
