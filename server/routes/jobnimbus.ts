import { Router, Request, Response } from 'express';

export const jnRouter = Router();

const JN_BASE = 'https://app.jobnimbus.com/api1';
const JN_TOKEN = process.env.JOBNIMBUS_API_KEY || 'mlfiyztya8bjzm92';

function requireAuth(req: Request, res: Response, next: any) {
  if (!(req.session as any)?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Search jobs
jnRouter.get('/jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    const keyword = req.query.keyword as string || '';
    const url = `${JN_BASE}/jobs?keyword=${encodeURIComponent(keyword)}`;
    const jnRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${JN_TOKEN}` },
    });
    if (!jnRes.ok) {
      const text = await jnRes.text();
      console.error('JN search error:', text);
      return res.status(jnRes.status).json({ error: 'JobNimbus search failed' });
    }
    const data = await jnRes.json();
    return res.json(data);
  } catch (err: any) {
    console.error('JN search error:', err.message);
    return res.status(500).json({ error: 'Failed to search JobNimbus' });
  }
});

// Upload file to JobNimbus
jnRouter.post('/upload', requireAuth, async (req: Request, res: Response) => {
  try {
    const { jobId, jobName, reportHtml, address } = req.body;
    if (!jobId || !reportHtml) return res.status(400).json({ error: 'Missing jobId or report data' });

    // Create a simple HTML file for the report
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inspection Report - ${address}</title>
    <style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#374151}</style>
    </head><body>${reportHtml}</body></html>`;
    
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const filename = `KD-Inspection-${(address || 'Report').replace(/[^a-zA-Z0-9]+/g, '-')}.html`;

    // Try uploading as a document attachment
    const formData = new FormData();
    formData.append('file', blob, filename);

    // First, try the /files endpoint
    const uploadRes = await fetch(`${JN_BASE}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${JN_TOKEN}` },
      body: formData,
    });

    if (uploadRes.ok) {
      const uploadData = await uploadRes.json() as any;
      // Now attach to job via activity/note
      const noteRes = await fetch(`${JN_BASE}/activities`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${JN_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'note',
          primary: { id: jobId, type: 'job' },
          note: `K&D Roofing Inspection Report for ${address}. File: ${filename}`,
          record_type_name: 'Note',
        }),
      });

      return res.json({ success: true, jobName, fileId: uploadData?.id || uploadData?.jnid });
    }

    // Fallback: create a note with report content
    const noteRes = await fetch(`${JN_BASE}/activities`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'note',
        primary: { id: jobId, type: 'job' },
        note: `K&D Roofing Inspection Report\nAddress: ${address}\n\nFull report available in MeasureNow app.`,
        record_type_name: 'Note',
      }),
    });

    if (!noteRes.ok) {
      const errText = await noteRes.text();
      console.error('JN note error:', errText);
      return res.status(500).json({ error: 'Failed to create note in JobNimbus' });
    }

    return res.json({ success: true, jobName, method: 'note' });
  } catch (err: any) {
    console.error('JN upload error:', err.message);
    return res.status(500).json({ error: 'Failed to send to JobNimbus' });
  }
});
