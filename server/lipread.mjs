// Proxy to the local lip-reading service (lipread/server.py, Python + Auto-AVSR).
// The browser only talks to this origin; the Python process listens on loopback.
import { validVideo } from './cloud.mjs';
import { sendJson } from './api.mjs';

const MAX_BYTES = 12 * 1024 * 1024;

export function createLipreadHandler({ url = 'http://127.0.0.1:5340', fetcher = fetch } = {}) {
  let running = false;
  return async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith('/api/lipread/')) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      sendJson(res, 403, { error: 'origin_denied' });
      return true;
    }
    if (path === '/api/lipread/status' && req.method === 'GET') {
      try {
        const r = await fetcher(`${url}/status`, { signal: AbortSignal.timeout(2000) });
        sendJson(res, 200, { online: true, ...(await r.json()) });
      } catch {
        sendJson(res, 200, { online: false, ready: false });
      }
      return true;
    }
    if (path !== '/api/lipread/recognize' || req.method !== 'POST') {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    const mime = String(req.headers['content-type'] ?? '').split(';')[0];
    if (!['video/webm', 'video/mp4'].includes(mime)) {
      sendJson(res, 400, { error: 'invalid_video' });
      return true;
    }
    if (running) {
      sendJson(res, 429, { error: 'request_busy' });
      return true;
    }
    running = true;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) {
          sendJson(res, 413, { error: 'file_too_large' });
          return true;
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (!validVideo(bytes, mime)) {
        sendJson(res, 400, { error: 'invalid_video' });
        return true;
      }
      let response;
      try {
        response = await fetcher(`${url}/recognize`, {
          method: 'POST',
          headers: { 'Content-Type': mime },
          body: bytes,
          signal: AbortSignal.timeout(120000),
        });
      } catch {
        sendJson(res, 503, { error: 'lipread_offline' });
        return true;
      }
      const body = await response.json().catch(() => ({ error: 'recognition_failed' }));
      if (!res.destroyed) sendJson(res, response.status, body);
    } finally {
      running = false;
    }
    return true;
  };
}
