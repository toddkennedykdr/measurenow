import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import { leadRouter } from './routes/lead';
import { authRouter } from './routes/auth';
import { reportsRouter } from './routes/reports';
import { jnRouter, warnIfJobNimbusUnconfigured } from './routes/jobnimbus';
import { mountRoofRoutes } from './mountRoof';
import { malformedJsonHandler } from './middleware/jsonError';
import { registerHealthRoute } from './health';

dotenv.config();

import { initDb, pingDatabase } from './db';

const app = express();
const PORT = process.env.PORT || 3001;

// Railway terminates TLS and forwards the client IP. Trust that one hop
// so per-IP rate limits see the visitor, not the proxy.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(malformedJsonHandler);

// Session signing key is required. No literal fallback.
const sessionSecret = process.env.SESSION_SECRET;
if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') {
  console.error('Fatal: SESSION_SECRET is not set. Refusing to start.');
  process.exit(1);
}

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

// Login is not required. Registered before the shared /api limiter.
registerHealthRoute(app, pingDatabase);

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
mountRoofRoutes(app);
app.use('/api/lead', leadRouter);

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

async function start() {
  warnIfJobNimbusUnconfigured();
  await initDb();
  app.listen(PORT, () => {
    console.log(`MeasureNow server running on port ${PORT}`);
  });
}
start().catch(err => { console.error('Failed to start:', err); process.exit(1); });

export default app;
