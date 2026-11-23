import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
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
import { sessionStore } from './sessionStore';
import {
  HARDCODED_EMBED_ORIGINS,
  embedOriginsScript,
  parseEmbedParentOrigins,
} from './embedOrigins';

const app = express();
const PORT = process.env.PORT || 3001;

function safeErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Error';
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  const name = (err as { name?: unknown }).name;
  if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) return name;
  return 'Error';
}

function safeRoute(req: Request): string {
  const pattern = req.route && typeof req.route.path === 'string' ? req.route.path : '';
  const route = `${req.baseUrl || ''}${pattern}`;
  if (!route || route.length > 80 || !/^[A-Za-z0-9_./:-]+$/.test(route)) return 'unmatched';
  return route;
}

process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({ type: 'unhandledRejection', code: safeErrorCode(reason) }));
});

// Railway terminates TLS at one edge proxy hop. Trust exactly that hop so req.ip is the
// real client IP (used by the rate limiters). Never `true` (that would trust spoofed XFF).
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));

// Helmet's default frameguard sends X-Frame-Options: SAMEORIGIN on every response,
// which blocks https://kanddroofingnc.com from embedding the public quote page.
// Only that document is embeddable. Its scripts and styles are same-origin
// subresources of the framed page, so they keep the default framing headers.
// CSP is frame-ancestors only: a full Helmet CSP would change script and style
// loading. Helmet still requires a default-src key, so it is explicitly disabled.
// CORP is cross-origin on that document only. The marketing site's no-cors
// probe of the iframe URL fails when Helmet's default same-origin CORP is set,
// even after the page is embeddable. Other routes keep same-origin.
const embedOrigins = parseEmbedParentOrigins(process.env.EMBED_PARENT_ORIGINS, message => {
  console.warn(message);
});
const QUOTE_FRAME_ANCESTORS = ["'self'", ...embedOrigins];
const extraEmbedOrigins = embedOrigins.length > HARDCODED_EMBED_ORIGINS.length;
const defaultHelmet = helmet({ contentSecurityPolicy: false });
// Email clients load /static/kd-logo.png and the badge from another origin.
// Only that path gets cross-origin CORP. Every other route keeps defaultHelmet.
const staticAssetHelmet = helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});
const quoteEmbedHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
      'frame-ancestors': QUOTE_FRAME_ANCESTORS,
    },
  },
  frameguard: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

function isQuoteDocument(urlPath: string): boolean {
  return urlPath === '/quote' || urlPath === '/quote/';
}

function isStaticAsset(urlPath: string): boolean {
  return urlPath === '/static' || urlPath.startsWith('/static/');
}

app.use((req, res, next) => {
  if (isStaticAsset(req.path)) {
    staticAssetHelmet(req, res, next);
    return;
  }
  if (isQuoteDocument(req.path)) {
    quoteEmbedHelmet(req, res, next);
    return;
  }
  defaultHelmet(req, res, next);
});
// CORS: only our own origins (prod Railway domain, ALLOWED_ORIGINS, localhost in dev).
app.use(cors(corsOptionsDelegate));

// Rate limit: 30 requests per minute per IP (keyed on the real client IP via trust proxy).
// This sits ahead of the JSON parser so a malformed body counts toward the same limit.
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' },
}));

app.use(express.json({ limit: '10mb' }));

// Session
app.use(session({
  store: sessionStore,
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
  const distDir = path.join(__dirname, '..', 'dist');
  const indexFile = path.join(distDir, 'index.html');
  let quoteHtml: string | null = null;
  const staticDir = path.join(distDir, 'static');
  app.use('/static', (req, res, next) => {
    const raw = req.originalUrl.split('?')[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (!decoded.startsWith('/static/') || decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  });
  app.use('/static', express.static(staticDir));
  app.use('/static', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (extraEmbedOrigins && isQuoteDocument(req.path)) {
      if (quoteHtml == null) {
        const shell = fs.readFileSync(indexFile, 'utf8');
        const tag = embedOriginsScript(embedOrigins);
        quoteHtml = shell.includes('<head>') ? shell.replace('<head>', () => `<head>${tag}`) : `${tag}${shell}`;
      }
      res.type('html').send(quoteHtml);
      return;
    }
    res.sendFile(indexFile);
  });
}

function clientStatus(err: unknown): number | null {
  if (err instanceof URIError) return 400;
  if (!err || typeof err !== 'object') return null;
  const raw = (err as { status?: unknown; statusCode?: unknown }).status
    ?? (err as { statusCode?: unknown }).statusCode;
  const status = typeof raw === 'number' ? raw : NaN;
  if (status >= 400 && status < 500) return status;
  return null;
}

function clientMessage(status: number): string {
  if (status === 413) return 'Payload too large';
  if (status === 415) return 'Unsupported media type';
  return 'Bad request';
}

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = clientStatus(err);
  if (status) {
    console.debug(JSON.stringify({ type: 'client-error', method: req.method, status }));
    res.status(status).json({ error: clientMessage(status) });
    return;
  }
  console.error(JSON.stringify({ type: 'request-error', method: req.method, route: safeRoute(req), code: safeErrorCode(err) }));
  res.status(500).json({ error: 'Something went wrong' });
});

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
