import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import { roofRouter } from './routes/roof';
import { leadRouter } from './routes/lead';
import { inspectRouter } from './routes/inspect';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { reportsRouter } from './routes/reports';
import { jnRouter } from './routes/jobnimbus';

dotenv.config();

import { initDb } from './db';
import { corsOptionsDelegate, blockForeignOrigins } from './middleware/security';

const app = express();
const PORT = process.env.PORT || 3001;

// Railway terminates TLS at one edge proxy hop. Trust exactly that hop so req.ip is the
// real client IP (used by the rate limiters). Never `true` (that would trust spoofed XFF).
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));

app.use(helmet({ contentSecurityPolicy: false }));
// CORS: only our own origins (prod Railway domain, ALLOWED_ORIGINS, localhost in dev).
app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: '10mb' }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'kd-measurenow-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set true behind HTTPS proxy
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Browser requests from foreign origins are refused outright.
app.use('/api', blockForeignOrigins);

// Rate limit: 30 requests per minute per IP (now keyed on the real client IP via trust proxy)
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' },
}));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/jn', jnRouter);
app.use('/api/roof', roofRouter);
app.use('/api/roof', inspectRouter);
app.use('/api/lead', leadRouter);

// Unknown API paths: JSON 404 (never the SPA shell)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

async function start() {
  if (process.env.SKIP_DB_INIT === '1') {
    // Local smoke tests only: boot without Postgres.
    app.listen(PORT, () => console.log(`MeasureNow server (no DB) running on port ${PORT}`));
    return;
  }
  await initDb();
  app.listen(PORT, () => {
    console.log(`MeasureNow server running on port ${PORT}`);
  });
}
start().catch(err => { console.error('Failed to start:', err); process.exit(1); });

export default app;
