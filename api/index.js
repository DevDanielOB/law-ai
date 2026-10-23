import { createApp } from '../dist/api/app.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let appPromise = null;

function getApp() {
  if (!appPromise) {
    let dbPath = process.env.SQLITE_DB_PATH || join(tmpdir(), 'law_ai_vercel.sqlite');
    let app;
    try {
      app = createApp({ dbPath, seed: true });
    } catch {
      app = createApp({ dbPath: ':memory:', seed: true });
    }
    appPromise = app.ready().then(() => app);
  }
  return appPromise;
}

async function readPayload(req) {
  if (req.body !== undefined) return req.body;
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export default async function handler(req, res) {
  const app = await getApp();
  const payload = await readPayload(req);
  const response = await app.inject({
    method: req.method || 'GET',
    url: req.url || '/',
    headers: req.headers,
    payload,
  });

  res.statusCode = response.statusCode;
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  }
  res.end(response.rawPayload);
}
