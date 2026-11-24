import { Router, Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { analyzeInspectionPhotos } from '../services/gemini';
import { getBuildingInsights, calculateWallArea } from '../services/solar';

export const inspectRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed'));
  },
});

inspectRouter.post('/analyze-photos', upload.array('photos', 12), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length < 1) {
      return res.status(400).json({
        error: 'Add at least one photo to run AI analysis, or generate the roof report without photos.',
      });
    }

    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    const address = req.body.address || '';

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid coordinates.' });
    }

    const images: { mimeType: string; dataBase64: string }[] = [];
    for (const file of files) {
      const resized = await sharp(file.buffer)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      images.push({ mimeType: 'image/jpeg', dataBase64: resized.toString('base64') });
    }

    const result = await analyzeInspectionPhotos({ images, address, lat, lng });
    if (!result.ok) {
      return res.status(503).json({ error: result.userMessage });
    }
    const analysis = result.analysis as any;

    // Calculate wall area from Solar API data instead of relying on AI estimate
    let buildingMeasurements: any = null;
    try {
      const building = await getBuildingInsights(lat, lng);
      if (building) {
        const stories = analysis.estimatedStories || 2;
        const wallCalc = calculateWallArea(building, stories);
        buildingMeasurements = {
          footprintSqFt: building.footprintSqFt,
          buildingPerimeter: building.estimatedPerimeterFt,
          buildingLength: building.estimatedLength,
          buildingWidth: building.estimatedWidth,
          stories,
          wallHeightPerStory: 9,
          grossWallArea: wallCalc.grossWallArea,
          calculatedWallArea: wallCalc.netSidingArea,
          openingsDeduction: wallCalc.openingsArea,
          openingsPercent: 18,
          measurementSource: 'satellite',
        };
        // Override AI's wall area estimate with calculated value
        analysis.estimatedWallArea = wallCalc.netSidingArea;
        analysis.estimatedOpeningsArea = wallCalc.openingsArea;
      }
    } catch (err: any) {
      console.error('Solar wall calc error (non-fatal):', err.message);
    }

    return res.json({ analysis, buildingMeasurements });
  } catch (err: any) {
    console.error('Photo analysis error:', err.message || err);
    return res.status(500).json({ error: 'Failed to analyze photos. Please try again.' });
  }
});

inspectRouter.post('/send-report', async (req: Request, res: Response) => {
  try {
    const { repEmail, address, roofData, quote, analysis, buildingMeasurements } = req.body;
    if (!address) return res.status(400).json({ error: 'Missing report data.' });

    const recipients = ['todd@kanddroofingnc.com'];
    if (repEmail) recipients.push(repEmail);

    const complexityMultipliers: Record<number, number> = { 1: 1.0, 2: 1.05, 3: 1.1, 4: 1.15, 5: 1.3 };
    const hasAnalysis = !!analysis;
    const complexityRating = hasAnalysis ? (analysis?.complexity?.rating || 3) : 0;
    const mult = hasAnalysis ? (complexityMultipliers[complexityRating] || 1.1) : 1;
    const adjLow = Math.round((quote?.lowEstimate || 0) * mult / 100) * 100;
    const adjHigh = Math.round((quote?.highEstimate || 0) * mult / 100) * 100;

    // Siding quote
    const wallArea = analysis?.estimatedWallArea || 0;
    const wallSquares = wallArea / 100;
    const sidingMat = (analysis?.sidingMaterial || '').toLowerCase();
    let sidingLow = 0, sidingHigh = 0, sidingLabel = '';
    if (sidingMat.includes('hardi') || sidingMat.includes('fiber cement')) {
      sidingLow = Math.round(wallSquares * 500 / 100) * 100;
      sidingHigh = Math.round(wallSquares * 700 / 100) * 100;
      sidingLabel = 'HardiBoard/Fiber Cement';
    } else {
      sidingLow = Math.round(wallSquares * 300 / 100) * 100;
      sidingHigh = Math.round(wallSquares * 400 / 100) * 100;
      sidingLabel = 'Vinyl/Ascend';
    }

    const featuresHtml = (analysis?.features || [])
      .map((f: any) => `<li>${f.type} (×${f.count}) — ${f.location}</li>`)
      .join('');
    const damageHtml = (analysis?.damage || [])
      .map((d: any) => `<li><strong style="color:${d.severity === 'major' ? '#E2312B' : d.severity === 'minor' ? '#ca8a04' : '#16a34a'}">${d.severity}</strong>: ${d.type} — ${d.description} (${d.location})</li>`)
      .join('');
    const recsHtml = (analysis?.recommendations || [])
      .map((r: string) => `<li>${r}</li>`)
      .join('');
    const sidingDamageHtml = (analysis?.sidingDamage || [])
      .map((d: any) => `<li><strong style="color:${d.severity === 'major' ? '#E2312B' : d.severity === 'minor' ? '#ca8a04' : '#16a34a'}">${d.severity}</strong>: ${d.type} — ${d.description} (${d.location})</li>`)
      .join('');
    const sidingRecsHtml = (analysis?.sidingRecommendations || [])
      .map((r: string) => `<li>${r}</li>`)
      .join('');

    const roofArea = roofData?.totalAreaSqFt || 0;
    const roofSquares = quote?.roofSquares || 0;
    const openingsArea = analysis?.estimatedOpeningsArea || 0;
    const netWallArea = wallArea - openingsArea;
    const ridgeLen = analysis?.estimatedRidgeLength || 0;
    const valleyLen = analysis?.estimatedValleyLength || 0;
    const rakeLen = analysis?.estimatedRakeLength || 0;
    const eaveLen = analysis?.estimatedEaveLength || 0;
    const dripEdge = analysis?.estimatedDripEdge || (rakeLen + eaveLen);
    const facets = analysis?.estimatedFacets || roofData?.segments || 0;
    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const thStyle = 'background:#032D59;color:white;padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase';
    const tdStyle = 'padding:8px 12px;border-bottom:1px solid #e5e7eb';

    const roofWasteRows = [0, 0.05, 0.10, 0.15, 0.20].map(pct => {
      const a = Math.round(roofArea * (1 + pct));
      const label = pct === 0 ? 'Zero Waste' : `+${Math.round(pct * 100)}%`;
      return `<tr><td style="${tdStyle}">${label}</td><td style="${tdStyle}">${a.toLocaleString()}</td><td style="${tdStyle}">${(a / 100).toFixed(1)}</td></tr>`;
    }).join('');

    const sidingWasteRows = [0, 0.10, 0.18].map(pct => {
      const a = Math.round(netWallArea * (1 + pct));
      const label = pct === 0 ? 'Zero Waste' : `+${Math.round(pct * 100)}%`;
      return `<tr><td style="${tdStyle}">${label}</td><td style="${tdStyle}">${a.toLocaleString()}</td><td style="${tdStyle}">${(a / 100).toFixed(1)}</td></tr>`;
    }).join('');

    const condColor = (r: string) => r === 'poor' ? '#E2312B' : r === 'fair' ? '#ca8a04' : '#16a34a';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#374151">
        <!-- HEADER -->
        <div style="background:#032D59;color:white;padding:24px;border-radius:8px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-size:24px;font-weight:800">K&D <span style="color:#E2312B">Roofing</span></div>
              <div style="font-size:14px;opacity:0.8">Complete Property Measurements</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:15px;font-weight:600">${address}</div>
              <div style="font-size:13px;opacity:0.7">${reportDate}</div>
            </div>
          </div>
        </div>

        ${hasAnalysis ? `<!-- SIDING SUMMARY -->
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2 style="color:#032D59;margin:0;font-size:18px;border-bottom:2px solid #032D59;padding-bottom:4px">Siding Summary</h2>
            <span style="background:${condColor(analysis?.sidingCondition?.rating || 'fair')};color:white;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">${(analysis?.sidingCondition?.rating || 'N/A').toUpperCase()}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
            <tr><td style="padding:6px 0;width:50%"><strong>Total Facade:</strong> ${wallArea.toLocaleString()} sq ft</td><td><strong>Openings:</strong> ${openingsArea.toLocaleString()} sq ft</td></tr>
            <tr><td style="padding:6px 0"><strong>Net Siding:</strong> ${netWallArea.toLocaleString()} sq ft</td><td><strong>Material:</strong> ${analysis?.sidingMaterial || 'N/A'}</td></tr>
          </table>
          ${analysis?.estimatedCorners ? `<p style="font-size:13px;color:#6b7280;margin:4px 0">Corners — Inside: ${analysis.estimatedCorners.inside} · Outside: ${analysis.estimatedCorners.outside}${analysis?.estimatedTrimLength ? ` · Trim: ~${analysis.estimatedTrimLength} lin ft` : ''}</p>` : ''}
          <p style="font-size:14px;background:#f9fafb;border-left:3px solid #d1d5db;padding:8px 12px;border-radius:4px">${analysis?.sidingCondition?.notes || ''}</p>
          ${sidingDamageHtml ? `<h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:12px 0 6px">Siding Damage</h4><ul style="margin:0;padding-left:20px;font-size:14px">${sidingDamageHtml}</ul>` : ''}
          <h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:16px 0 6px">Waste Factor</h4>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><th style="${thStyle}">Factor</th><th style="${thStyle}">Area (sq ft)</th><th style="${thStyle}">Squares</th></tr>
            ${sidingWasteRows}
          </table>
        </div>` : ''}

        <!-- ROOF SUMMARY -->
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2 style="color:#032D59;margin:0;font-size:18px;border-bottom:2px solid #032D59;padding-bottom:4px">Roof Summary</h2>
            <span style="background:${hasAnalysis ? condColor(analysis?.overallCondition?.rating || 'fair') : '#2563eb'};color:white;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">${hasAnalysis ? (analysis?.overallCondition?.rating || 'N/A').toUpperCase() : 'SATELLITE'}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
            <tr><td style="padding:6px 0;width:33%"><strong>Area:</strong> ${roofArea.toLocaleString()} sq ft</td><td style="width:33%"><strong>Squares:</strong> ${roofSquares}</td><td><strong>Facets:</strong> ${facets}</td></tr>
            <tr><td style="padding:6px 0"><strong>Type:</strong> ${analysis?.roofType || '—'}</td><td><strong>Material:</strong> ${analysis?.material?.type || '—'}</td><td><strong>Pitch:</strong> ${quote?.pitchOver12 || 'N/A'}/12</td></tr>
          </table>

          <h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:12px 0 6px">Roof Components</h4>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><th style="${thStyle}">Component</th><th style="${thStyle}">Est. Length (ft)</th></tr>
            <tr><td style="${tdStyle}">Ridges / Hips</td><td style="${tdStyle}">${ridgeLen || '—'}</td></tr>
            <tr><td style="${tdStyle}">Valleys</td><td style="${tdStyle}">${valleyLen || '—'}</td></tr>
            <tr><td style="${tdStyle}">Rakes</td><td style="${tdStyle}">${rakeLen || '—'}</td></tr>
            <tr><td style="${tdStyle}">Eaves</td><td style="${tdStyle}">${eaveLen || '—'}</td></tr>
            <tr><td style="${tdStyle}">Drip Edge / Perimeter</td><td style="${tdStyle}">${dripEdge || '—'}</td></tr>
          </table>

          ${featuresHtml ? `<h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:12px 0 6px">Features</h4><ul style="margin:0;padding-left:20px;font-size:14px">${featuresHtml}</ul>` : ''}

          <h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:16px 0 6px">Waste Factor</h4>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><th style="${thStyle}">Factor</th><th style="${thStyle}">Area (sq ft)</th><th style="${thStyle}">Squares</th></tr>
            ${roofWasteRows}
          </table>
        </div>

        ${hasAnalysis ? `<!-- AI INSPECTION NOTES -->
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:16px">
          <h2 style="color:#032D59;font-size:18px;border-bottom:2px solid #032D59;padding-bottom:4px;margin-bottom:12px">AI Inspection Notes</h2>
          <div style="background:#f9fafb;padding:12px;border-radius:8px;display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <span style="background:${condColor(analysis?.overallCondition?.rating || 'fair')};color:white;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:700">${(analysis?.overallCondition?.rating || 'N/A').toUpperCase()}</span>
            <span style="font-size:14px">${analysis?.overallCondition?.notes || ''}</span>
          </div>
          <p style="font-size:14px"><strong>Complexity:</strong> ${analysis?.complexity?.rating || 'N/A'}/5 — ${analysis?.complexity?.explanation || ''}</p>
          ${damageHtml ? `<h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:12px 0 6px">Damage Findings</h4><ul style="margin:0;padding-left:20px;font-size:14px">${damageHtml}</ul>` : ''}
          ${recsHtml ? `<h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:12px 0 6px">Recommendations</h4><ul style="margin:0;padding-left:20px;font-size:14px">${recsHtml}</ul>` : ''}
          ${sidingRecsHtml ? `<h4 style="color:#032D59;font-size:13px;text-transform:uppercase;margin:12px 0 6px">Siding Recommendations</h4><ul style="margin:0;padding-left:20px;font-size:14px">${sidingRecsHtml}</ul>` : ''}
        </div>` : `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;font-size:14px">This report uses satellite roof data for the address. No inspection photos were included.</div>`}

        <!-- QUOTE SUMMARY -->
        <div style="background:white;border:2px solid #032D59;border-radius:8px;padding:20px;margin-bottom:16px">
          <h2 style="color:#032D59;font-size:18px;border-bottom:2px solid #032D59;padding-bottom:4px;margin-bottom:12px">Quote Summary</h2>
          <table style="width:100%;border-collapse:collapse;font-size:16px">
            <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb"><strong>Roof Replacement</strong> <span style="color:#6b7280;font-size:12px">${hasAnalysis ? `(${analysis?.material?.type || ''} · ${mult}x complexity)` : '(satellite measurement)'}</span></td><td style="text-align:right;font-weight:bold;color:#032D59;border-bottom:1px solid #e5e7eb">$${adjLow.toLocaleString()} – $${adjHigh.toLocaleString()}</td></tr>
            ${wallArea > 0 ? `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb"><strong>Siding</strong> <span style="color:#6b7280;font-size:12px">(${sidingLabel})</span></td><td style="text-align:right;font-weight:bold;color:#032D59;border-bottom:1px solid #e5e7eb">$${sidingLow.toLocaleString()} – $${sidingHigh.toLocaleString()}</td></tr>` : ''}
            <tr style="border-top:2px solid #032D59"><td style="padding:14px 0;font-size:18px;font-weight:700;color:#032D59">Total Estimated</td><td style="text-align:right;font-weight:800;color:#E2312B;font-size:22px">$${(adjLow + sidingLow).toLocaleString()} – $${(adjHigh + sidingHigh).toLocaleString()}</td></tr>
          </table>
          <p style="font-size:12px;color:#6b7280;font-style:italic;margin:8px 0 0">${hasAnalysis
            ? '*Estimates based on satellite data + AI photo analysis. Final pricing subject to on-site confirmation.'
            : '*Estimate based on satellite roof data for this address. No inspection photos were included. Final pricing subject to on-site confirmation.'}</p>
        </div>

        <p style="color:#6b7280;font-size:12px;text-align:center">Generated by K&D Roofing MeasureNow Inspection Tool · ${reportDate}</p>
      </div>
    `;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'K&D Roofing <admin@kanddroofingnc.com>',
        to: recipients,
        subject: `Roof & Siding Inspection — ${address}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend error:', errText);
      return res.status(500).json({ error: 'Failed to send email.' });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Send report error:', err.message || err);
    return res.status(500).json({ error: 'Failed to send report.' });
  }
});
