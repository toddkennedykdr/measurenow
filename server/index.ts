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
import { reportsRouter } from './routes/reports';
import { jnRouter } from './routes/jobnimbus';
import { requireRoofAccess, roofRateLimit } from './middleware/roofAccess';

dotenv.config();

import { initDb } from './db';

const sessionSecret = process.env.SESSION_SECRET;
if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') {
  console.error('Fatal: SESSION_SECRET is not set. Refusing to start.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Railway terminates TLS and forwards the client IP. Trust that one hop
// so per-IP rate limits see the visitor, not the proxy.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '10mb' }));

// Session
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set true behind HTTPS proxy
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Rate limit: 30 requests per minute per IP
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' },
}));

app.use('/api/auth', authRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/jn', jnRouter);
app.use('/api/roof', roofRateLimit, requireRoofAccess);
app.use('/api/roof', roofRouter);
app.use('/api/roof', inspectRouter);
app.use('/api/lead', leadRouter);

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`MeasureNow server running on port ${PORT}`);
  });
}
start().catch(err => { console.error('Failed to start:', err); process.exit(1); });

export default app;
