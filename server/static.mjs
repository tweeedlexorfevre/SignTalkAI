// Static files of the built web app (web/dist).
//
// The ML files (MediaPipe and onnxruntime WASM, the .task and .onnx models) are
// ~50 MB and are fetched every time live translation starts in a call, so:
//  - every response carries a content-hash ETag, and a matching If-None-Match
//    gets 304: the second call loads the models from the browser cache;
//  - web/scripts/precompress.mjs writes .br / .gz copies at build time, served
//    here when the browser accepts them (the WASM runtimes shrink ~6x);
//  - files are streamed, not read into memory whole.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.task': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Precompressed variants, best first, with the file suffix precompress.mjs writes. */
const ENCODINGS = [
  { name: 'br', suffix: '.br' },
  { name: 'gzip', suffix: '.gz' },
];

/** True when an Accept-Encoding header allows `name` (a q=0 entry refuses it). */
export function acceptsEncoding(header, name) {
  if (!header) return false;
  for (const part of String(header).split(',')) {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    if (token !== name && token !== '*') continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  }
  return false;
}

/** True when If-None-Match lists `etag` (weak or strong) or is `*`. */
function matchesEtag(header, etag) {
  if (!header) return false;
  return String(header)
    .split(',')
    .some((t) => {
      const tag = t.trim().replace(/^W\//, '');
      return tag === '*' || tag === etag;
    });
}

async function fileInfo(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

export function createStaticHandler(staticRoot, securityHeaders = {}) {
  const root = resolve(staticRoot);
  /** file -> { key, hash }: content hashes, recomputed only when size/mtime change. */
  const hashes = new Map();

  async function contentHash(file, info) {
    const key = `${info.size}:${info.mtimeMs}`;
    const hit = hashes.get(file);
    if (hit?.key === key) return hit.hash;
    const hash = createHash('sha1');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const digest = hash.digest('base64url');
    hashes.set(file, { key, hash: digest });
    return digest;
  }

  return async function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, securityHeaders);
      res.end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400, securityHeaders);
      res.end();
      return;
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403, securityHeaders);
      res.end();
      return;
    }
    const info = await fileInfo(file);
    if (!info) {
      res.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    // A precompressed copy the browser accepts, if the build wrote one.
    let body = { path: file, size: info.size, encoding: null };
    for (const { name, suffix } of ENCODINGS) {
      if (!acceptsEncoding(req.headers['accept-encoding'], name)) continue;
      const variant = await fileInfo(file + suffix);
      if (variant) {
        body = { path: file + suffix, size: variant.size, encoding: name };
        break;
      }
    }

    const hash = await contentHash(file, info);
    const etag = `"${hash}${body.encoding ? '-' + body.encoding : ''}"`;
    // Vite's hashed bundles never change; everything else (the models included) is
    // revalidated on every use, which costs one 304 while it is unchanged.
    const hashed = path.startsWith('/assets/');
    const headers = {
      ...securityHeaders,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: etag,
      'Last-Modified': info.mtime.toUTCString(),
      Vary: 'Accept-Encoding',
    };

    if (matchesEtag(req.headers['if-none-match'], etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    res.writeHead(200, {
      ...headers,
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.size,
      ...(body.encoding ? { 'Content-Encoding': body.encoding } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    try {
      await pipeline(createReadStream(body.path), res);
    } catch {
      // The client went away mid-download, or the file vanished: the headers are sent.
      res.destroy();
    }
  };
}
