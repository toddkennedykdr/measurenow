import { Router, Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';

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
    if (!files || files.length < 4) {
      return res.status(400).json({ error: 'Please upload at least 4 photos.' });
    }

    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    const address = req.body.address || '';

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid coordinates.' });
    }

    const imageContents: any[] = [];
    for (const file of files) {
      const resized = await sharp(file.buffer)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const base64 = resized.toString('base64');
      imageContents.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
      });
    }

    const systemPrompt = `You are an expert roofing and siding inspector analyzing photos of a residential property. Analyze ALL provided photos and return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "roofType": "gable|hip|flat|mansard|gambrel|shed|combination|other",
  "material": { "type": "asphalt shingle|metal|tile|slate|wood shake|flat/TPO|other", "condition": "good|fair|poor" },
  "features": [{ "type": "dormer|skylight|chimney|vent|pipe|satellite dish|gutter|valley|hip ridge|ridge", "count": 1, "location": "description" }],
  "complexity": { "rating": 3, "explanation": "reason" },
  "damage": [{ "type": "missing shingles|cracking|moss/algae|sagging|flashing damage|storm damage|wear", "severity": "none|minor|major", "location": "description", "description": "details" }],
  "accessIssues": ["steep slope", "tall building", "trees close to roof", "power lines nearby"],
  "estimatedStories": 2,
  "overallCondition": { "rating": "good|fair|poor", "notes": "summary" },
  "recommendations": ["recommendation 1", "recommendation 2"],
  "sidingMaterial": "vinyl|HardiBoard/fiber cement|wood|brick|stone|stucco|aluminum|mixed|other",
  "sidingCondition": { "rating": "good|fair|poor", "notes": "description of siding condition" },
  "sidingDamage": [{ "type": "cracking|fading|warping|moisture damage|holes|loose panels|rot|peeling paint", "severity": "none|minor|major", "location": "description", "description": "details" }],
  "estimatedWallArea": 2000,
  "sidingRecommendations": ["recommendation 1", "recommendation 2"]
}
For estimatedWallArea, estimate total exterior wall sq ft based on visible walls, number of stories, and approximate building footprint. If the house is ~1500 sq ft footprint and 2 stories, walls are roughly 2400-3000 sq ft. Use your best judgment.
If you cannot determine something, use reasonable defaults. Always provide the full structure.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze these ${files.length} photos of a property at ${address || `${lat}, ${lng}`}. Provide a detailed roofing AND siding inspection analysis.` },
              ...imageContents,
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', errText);
      return res.status(500).json({ error: 'AI analysis failed. Please try again.' });
    }

    const anthropicData = await anthropicRes.json() as any;
    const raw = anthropicData.content?.[0]?.text || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse OpenAI response:', raw);
      return res.status(500).json({ error: 'AI analysis returned invalid format. Please try again.' });
    }

    return res.json({ analysis });
  } catch (err: any) {
    console.error('Photo analysis error:', err.message || err);
    return res.status(500).json({ error: 'Failed to analyze photos. Please try again.' });
  }
});

inspectRouter.post('/send-report', async (req: Request, res: Response) => {
  try {
    const { repEmail, address, roofData, quote, analysis } = req.body;
    if (!address) return res.status(400).json({ error: 'Missing report data.' });

    const recipients = ['todd@kanddroofingnc.com'];
    if (repEmail) recipients.push(repEmail);

    const complexityMultipliers: Record<number, number> = { 1: 1.0, 2: 1.05, 3: 1.1, 4: 1.15, 5: 1.3 };
    const mult = complexityMultipliers[analysis?.complexity?.rating || 3] || 1.1;
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

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#032D59">K&D Roofing — Inspection Report</h1>
        <h2 style="color:#6b7280">📍 ${address}</h2>
        <hr/>
        <h3>Satellite Measurements</h3>
        <ul>
          <li>Roof Area: ${roofData?.totalAreaSqFt?.toLocaleString() || 'N/A'} sq ft</li>
          <li>Squares: ${quote?.roofSquares || 'N/A'}</li>
          <li>Pitch: ${quote?.pitchOver12 || 'N/A'}/12 (${quote?.pitchCategory || ''})</li>
        </ul>
        <h3>🏠 Roof — AI Analysis</h3>
        <p><strong>Roof Type:</strong> ${analysis?.roofType || 'N/A'}</p>
        <p><strong>Material:</strong> ${analysis?.material?.type || 'N/A'} (${analysis?.material?.condition || 'N/A'})</p>
        <p><strong>Overall Condition:</strong> ${analysis?.overallCondition?.rating || 'N/A'} — ${analysis?.overallCondition?.notes || ''}</p>
        <p><strong>Complexity:</strong> ${analysis?.complexity?.rating || 'N/A'}/5 — ${analysis?.complexity?.explanation || ''}</p>
        <p><strong>Stories:</strong> ${analysis?.estimatedStories || 'N/A'}</p>
        <h4>Features</h4><ul>${featuresHtml || '<li>None detected</li>'}</ul>
        <h4>Roof Damage</h4><ul>${damageHtml || '<li>No damage detected</li>'}</ul>
        <h4>Roof Recommendations</h4><ul>${recsHtml || '<li>None</li>'}</ul>
        <hr/>
        <h3>🧱 Siding — AI Analysis</h3>
        <p><strong>Material:</strong> ${analysis?.sidingMaterial || 'N/A'}</p>
        <p><strong>Condition:</strong> ${analysis?.sidingCondition?.rating || 'N/A'} — ${analysis?.sidingCondition?.notes || ''}</p>
        <p><strong>Est. Wall Area:</strong> ~${wallArea.toLocaleString()} sq ft (${wallSquares.toFixed(1)} squares)</p>
        <h4>Siding Damage</h4><ul>${sidingDamageHtml || '<li>No damage detected</li>'}</ul>
        <h4>Siding Recommendations</h4><ul>${sidingRecsHtml || '<li>None</li>'}</ul>
        <hr/>
        <h3 style="color:#032D59">Quote Summary</h3>
        <table style="width:100%;border-collapse:collapse;font-size:16px">
          <tr><td style="padding:8px 0"><strong>Roof Replacement</strong> (${mult}x complexity)</td><td style="text-align:right;font-weight:bold;color:#032D59">$${adjLow.toLocaleString()} – $${adjHigh.toLocaleString()}</td></tr>
          <tr><td style="padding:8px 0"><strong>Siding (${sidingLabel})</strong></td><td style="text-align:right;font-weight:bold;color:#032D59">$${sidingLow.toLocaleString()} – $${sidingHigh.toLocaleString()}</td></tr>
          <tr style="border-top:2px solid #032D59"><td style="padding:12px 0;font-size:18px"><strong>Total (Roof + Siding)</strong></td><td style="text-align:right;font-weight:bold;color:#E2312B;font-size:18px">$${(adjLow + sidingLow).toLocaleString()} – $${(adjHigh + sidingHigh).toLocaleString()}</td></tr>
        </table>
        <hr/>
        <p style="color:#6b7280;font-size:12px">Generated by K&D Roofing MeasureNow Inspection Tool</p>
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
