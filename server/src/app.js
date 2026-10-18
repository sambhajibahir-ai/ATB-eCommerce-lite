import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { admin } from './routes/admin.js';
import { store } from './routes/store.js';
import { webhooks } from './routes/webhooks.js';

const app = express();
app.set('trust proxy', 1);

// Flexible CORS to allow local dev, configured CLIENT_URL, and Vercel domains
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      !config.clientUrl ||
      config.clientUrl === '*' ||
      origin === config.clientUrl ||
      origin.endsWith('.vercel.app') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
}));

// Normalize request URL for Vercel Serverless Function rewrites
app.use((req, res, next) => {
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && matchedPath.startsWith('/api')) {
    const queryIndex = req.url.indexOf('?');
    const queryString = queryIndex !== -1 ? req.url.slice(queryIndex) : '';
    req.url = matchedPath + queryString;
  } else if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

// Webhook signatures are computed over the raw bytes, so these routes must be
// mounted BEFORE express.json() and receive a Buffer.
app.use(['/api/webhooks', '/api/inventory/webhook'], express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api', webhooks);

app.use(express.json({ limit: '100kb' }));
app.use('/api', store);
app.use('/api/admin', admin);
app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Serve the built React app in production when running standalone (node src/index.js).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

export { app };
export default app;

